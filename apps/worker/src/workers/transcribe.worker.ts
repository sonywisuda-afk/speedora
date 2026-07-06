import { createReadStream, createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as Sentry from '@sentry/node';
import { updateVideoStatus, VideoStatus } from '@speedora/database';
import {
  QueueName,
  TranscriptionProvider,
  type TranscribeJobData,
  type TranscribeJobResult,
} from '@speedora/shared';
import { getObjectStream } from '@speedora/storage';
import { Worker, type Job } from 'bullmq';
import type OpenAI from 'openai';
import { assignSpeakerLabels, diarizeSpeakers, type SpeakerTurn } from '../diarization';
import { type AudioWindow, extractAudio, getMediaDurationSeconds } from '../ffmpeg';
import { groq, GROQ_WHISPER_MODEL } from '../groq';
import { openai, OPENAI_WHISPER_MODEL } from '../openai';
import { prisma } from '../prisma';
import { detectClipsQueue } from '../queues';
import { createRedisConnection } from '../redis';
import { cleanupTempFile, reserveScratchPath } from '../storage';
import { detectVocalEmotions } from '../vocalEmotion';

// Picks the Whisper client + model for a video's chosen provider, and fails
// clearly (rather than letting the SDK call fail confusingly deep inside a
// 401) if the relevant API key was never configured - GROQ_API_KEY is
// required at boot (see env.ts, it's the default/free tier everyone hits),
// but OPENAI_API_KEY is optional (only the paid "premium" tier needs it),
// so an admin who hasn't set it up yet gets a clear per-job failure here
// instead of the worker refusing to start for everyone.
// Writes real progress checkpoints to Postgres (see schema.prisma's comment
// on Video.transcribeProgress) - never a fabricated/interpolated animation,
// only points this job actually reached. Postgres, not BullMQ's own
// job.updateProgress(), is the sink: apps/api already reads every other
// piece of a video's state from Postgres (see CLAUDE.md's "PostgreSQL as
// source of truth" principle), so GET /videos/:id picks this up for free
// with no new plumbing to read BullMQ job state from apps/api.
async function reportProgress(videoId: string, percent: number): Promise<void> {
  await prisma.video.update({ where: { id: videoId }, data: { transcribeProgress: percent } });
}

function resolveWhisperClient(provider: TranscriptionProvider): {
  client: OpenAI;
  model: string;
} {
  if (provider === TranscriptionProvider.OPENAI) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        'OPENAI_API_KEY is not configured - premium (OpenAI Whisper) transcription is unavailable',
      );
    }
    return { client: openai, model: OPENAI_WHISPER_MODEL };
  }
  return { client: groq, model: GROQ_WHISPER_MODEL };
}

// Longest slice of audio sent to Whisper in a single request. At the
// 16 kHz mono / 64 kbps mp3 extractAudio() produces (~8 KB/s), 50 minutes is
// ~24 MB - safely under Whisper's hard 25 MB (26,214,400 byte) upload limit,
// with room for mp3 container overhead. A source longer than this is split
// into <=50-minute windows, each transcribed on its own (see
// planTranscriptionChunks) and stitched back together with its timestamps
// re-offset to absolute video time.
const MAX_TRANSCRIBE_SECONDS = 50 * 60;

// Fase 18 (Seamless Long-Video Chunking) - each chunk's audio EXTRACTION
// (see computeChunkExtractionWindow) is widened by this much on both sides
// beyond its own nominal boundary, clamped to the source's actual bounds.
// No single spoken word/phrase runs anywhere close to this long, so
// whichever chunk ends up transcribing the audio around a 50-minute
// boundary always has full surrounding context - never a hard, sample-
// accurate cut that could land mid-word - regardless of which chunk's
// version of that moment is ultimately kept (see the nominal-ownership
// filter in createTranscribeWorker's processor).
const CHUNK_OVERLAP_SECONDS = 15;

export interface TranscriptionChunk {
  startSeconds: number;
  durationSeconds: number;
}

// Splits a source of the given duration into transcription windows that each
// stay under Whisper's size limit. A source at or under the limit (or one
// whose duration couldn't be probed - NaN) yields a single full-length
// window, keeping the common case a single Whisper request.
//
// These are NOMINAL (non-overlapping, contiguous, gap-free) windows - they
// still decide exactly which chunk "owns" any given moment of the video
// once every chunk's transcript is merged (see createTranscribeWorker's
// processor). The actual ffmpeg EXTRACTION for a chunk is wider than this
// (see computeChunkExtractionWindow below) - the two are deliberately
// different things serving different purposes.
export function planTranscriptionChunks(durationSeconds: number): TranscriptionChunk[] {
  const total = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  if (total <= MAX_TRANSCRIBE_SECONDS) {
    return [{ startSeconds: 0, durationSeconds: total }];
  }

  const chunks: TranscriptionChunk[] = [];
  for (let start = 0; start < total; start += MAX_TRANSCRIBE_SECONDS) {
    chunks.push({
      startSeconds: start,
      durationSeconds: Math.min(MAX_TRANSCRIBE_SECONDS, total - start),
    });
  }
  return chunks;
}

// Widens a chunk's own nominal window by CHUNK_OVERLAP_SECONDS on each
// side, clamped to [0, totalDurationSeconds] - this is the window that
// actually gets extracted and sent to Whisper for THIS chunk. The first
// chunk naturally gets no leading overlap (clamped to 0) and the last
// chunk naturally gets no trailing overlap (clamped to the real
// duration) - no special-casing "first"/"last" needed, the clamp alone
// handles it.
export function computeChunkExtractionWindow(
  chunk: TranscriptionChunk,
  totalDurationSeconds: number,
): AudioWindow {
  const startSeconds = Math.max(0, chunk.startSeconds - CHUNK_OVERLAP_SECONDS);
  const endSeconds = Math.min(
    totalDurationSeconds,
    chunk.startSeconds + chunk.durationSeconds + CHUNK_OVERLAP_SECONDS,
  );
  return { startSeconds, durationSeconds: endSeconds - startSeconds };
}

export function createTranscribeWorker(): Worker<TranscribeJobData, TranscribeJobResult> {
  return new Worker<TranscribeJobData, TranscribeJobResult>(
    QueueName.TRANSCRIBE,
    async (job: Job<TranscribeJobData>) => {
      const { videoId, sourceUrl, provider } = job.data;
      console.log(`[transcribe] processing video ${videoId} from ${sourceUrl} via ${provider}`);

      let sourcePath: string | null = null;
      const audioPaths: string[] = [];

      try {
        // Reset before anything else - a retry re-runs this same job from
        // scratch, and without this a failed attempt's last-reached
        // checkpoint would otherwise linger and read as "still that far
        // along" until the first checkpoint below overwrites it.
        await reportProgress(videoId, 0);

        const { client: whisperClient, model: whisperModel } = resolveWhisperClient(provider);

        // Whisper's API rejects any upload over 25 MB and a full-length
        // video exceeds that within a couple of minutes, so we never send
        // the video itself. Download it to scratch, extract a compressed
        // mono audio track (ffmpeg needs a real local file to read), and
        // transcribe that instead - a tiny fraction of the size, same
        // timeline. See extractAudio() in ffmpeg.ts for the size math.
        sourcePath = await reserveScratchPath('transcribe-src', path.extname(sourceUrl) || '.mp4');
        const sourceStream = await getObjectStream(sourceUrl);
        await pipeline(sourceStream, createWriteStream(sourcePath));
        await reportProgress(videoId, 5);

        // Decide up front whether the audio fits in one Whisper request or
        // has to be split - a source longer than ~50 min would otherwise
        // extract to an audio file that's still over the 25 MB limit.
        const durationSeconds = await getMediaDurationSeconds(sourcePath);
        const chunks = planTranscriptionChunks(durationSeconds);
        const singleRequest = chunks.length === 1;
        if (!singleRequest) {
          console.log(
            `[transcribe] video ${videoId} is ~${Math.round(durationSeconds / 60)} min - ` +
              `splitting into ${chunks.length} chunks`,
          );
        }

        // Whisper timestamps are 0-based within each audio file it's given,
        // so each chunk's segments and words are shifted by that chunk's
        // EXTRACTION start (not its nominal start - see
        // computeChunkExtractionWindow) back onto the absolute video
        // timeline, then merged.
        //
        // Fase 18 (Seamless Long-Video Chunking): each chunk's audio
        // extraction is widened with CHUNK_OVERLAP_SECONDS of extra context
        // on both sides, so a word right at a 50-minute boundary is never
        // handed to Whisper as a hard, sample-accurate cut - both
        // neighboring chunks hear it with full surrounding context. That
        // means the SAME real moment gets transcribed twice (once by each
        // chunk); the nominal-ownership filter below (absStart falling
        // within THIS chunk's own non-overlapping planTranscriptionChunks
        // window) deterministically keeps exactly one copy - whichever
        // chunk's nominal window that absolute moment falls in - and drops
        // the other, so the merged transcript has neither a gap nor a
        // duplicate at any boundary. Skipped entirely for the common
        // single-request case (nothing to stitch, and chunk.durationSeconds
        // there is deliberately the FULL track length, not a real per-chunk
        // boundary to filter against).
        const mergedSegments: { start: number; end: number; text: string }[] = [];
        const mergedWords: { word: string; start: number; end: number }[] = [];

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const audioPath = await reserveScratchPath('transcribe-audio', '.mp3');
          audioPaths.push(audioPath);
          // A single full-length pass extracts the whole track (no window),
          // keeping the common-case ffmpeg command identical to before.
          const window: AudioWindow | undefined = singleRequest
            ? undefined
            : computeChunkExtractionWindow(chunk, durationSeconds);
          await extractAudio(sourcePath, audioPath, window);

          const transcription = await whisperClient.audio.transcriptions.create({
            file: createReadStream(audioPath),
            model: whisperModel,
            response_format: 'verbose_json',
            timestamp_granularities: ['word', 'segment'],
          });

          const offset = window ? window.startSeconds : 0;
          const nominalStart = chunk.startSeconds;
          const nominalEnd = chunk.startSeconds + chunk.durationSeconds;
          for (const segment of transcription.segments ?? []) {
            const start = segment.start + offset;
            if (!singleRequest && (start < nominalStart || start >= nominalEnd)) continue;
            mergedSegments.push({ start, end: segment.end + offset, text: segment.text });
          }
          for (const word of transcription.words ?? []) {
            const start = word.start + offset;
            if (!singleRequest && (start < nominalStart || start >= nominalEnd)) continue;
            mergedWords.push({ word: word.word, start, end: word.end + offset });
          }

          // 10-90% spread across chunks (5% for the download above, the
          // remaining ~5% is segment-merge + the DB write below) - the
          // common single-chunk case jumps straight to 90% once its one
          // Whisper call returns, since a single API round-trip has no
          // finer-grained signal to report mid-call.
          await reportProgress(videoId, 10 + Math.round(((i + 1) / chunks.length) * 80));
        }

        // Speaker diarization runs ONCE on the whole video's audio, not per
        // Whisper chunk - pyannote needs full context for consistent
        // speaker continuity across the video, and only needs to run once
        // regardless of how many chunks the transcript itself was split
        // into. A dedicated extraction (rather than reusing a chunk's own
        // audio file) keeps this decoupled from Whisper's own chunking -
        // the common single-chunk case duplicates one cheap ffmpeg
        // extraction, a trade-off accepted for simplicity (diarization
        // itself dominates runtime, not this).
        //
        // Never fails the job: a missing/unaccepted HUGGINGFACE_TOKEN (see
        // diarization.ts) or any other diarization error just means every
        // segment's speaker stays unset - same "optional signal" fallback
        // as detectFaces's caller in render-clip.worker.ts.
        const diarizeAudioPath = await reserveScratchPath('diarize-audio', '.mp3');
        audioPaths.push(diarizeAudioPath);
        await extractAudio(sourcePath, diarizeAudioPath);

        let speakerTurns: SpeakerTurn[] = [];
        try {
          speakerTurns = await diarizeSpeakers(diarizeAudioPath);
          const speakerCount = new Set(speakerTurns.map((turn) => turn.speaker)).size;
          console.log(
            `[transcribe] video ${videoId}: diarization found ${speakerCount} speaker(s) ` +
              `across ${speakerTurns.length} turn(s)`,
          );
        } catch (error) {
          console.warn(
            `[transcribe] speaker diarization failed for video ${videoId}, continuing without ` +
              'speaker labels:',
            error,
          );
        }
        const speakerLabels = assignSpeakerLabels(mergedSegments, speakerTurns);

        // Vocal emotion detection reuses the SAME full-track audio file
        // diarization just extracted above (no reason to extract it twice -
        // this needs no diarization-specific processing of its own, just a
        // full audio file and a list of segment ranges to slice). Also
        // never fails the job, same "optional signal" pattern as
        // diarization above - a classifier error just means every
        // segment's emotion stays unset.
        let emotionResults: Array<{ emotion: string; score: number } | null> = [];
        try {
          emotionResults = await detectVocalEmotions(diarizeAudioPath, mergedSegments);
        } catch (error) {
          console.warn(
            `[transcribe] vocal emotion detection failed for video ${videoId}, continuing ` +
              'without emotion labels:',
            error,
          );
        }

        // Whisper returns words as one flat, per-chunk array rather than
        // nested per segment - bucket each word into the segment whose
        // [start, end) it falls in so render-clip's karaoke caption preset
        // can access a segment's words alongside its text.
        const segments = mergedSegments.map((segment, i) => ({
          start: segment.start,
          end: segment.end,
          text: segment.text.trim(),
          speaker: speakerLabels[i],
          emotion: emotionResults[i]?.emotion,
          words: mergedWords
            .filter((word) => word.start >= segment.start && word.start < segment.end)
            .map((word) => ({ word: word.word, start: word.start, end: word.end })),
        }));

        // The status-event write is inlined here (rather than calling
        // updateVideoStatus()) so it joins the SAME $transaction as the
        // segment insert and progress reset, instead of being a separate,
        // merely-adjacent transaction - see ARCHITECTURE.md's Fase 3 section.
        await prisma.$transaction([
          prisma.transcriptSegment.createMany({
            data: segments.map((segment) => ({ videoId, ...segment })),
          }),
          prisma.video.update({
            where: { id: videoId },
            data: { status: VideoStatus.TRANSCRIBED, transcribeProgress: null },
          }),
          prisma.videoStatusEvent.create({
            data: { videoId, toStatus: VideoStatus.TRANSCRIBED, errorMessage: null },
          }),
        ]);

        console.log(`[transcribe] video ${videoId} -> ${segments.length} segments`);

        await detectClipsQueue.add(QueueName.DETECT_CLIPS, { videoId, segments });

        return { videoId, segments };
      } catch (error) {
        console.error(`[transcribe] video ${videoId} failed:`, error);
        // Tags only - never the transcript text/audio or OPENAI_API_KEY.
        Sentry.captureException(error, { tags: { videoId } });
        await updateVideoStatus(prisma, videoId, VideoStatus.FAILED, {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        // Scratch files only - the persisted source lives in object storage.
        // Cleaned up whether the job succeeded or failed (same as render-clip).
        if (sourcePath) await cleanupTempFile(sourcePath);
        for (const audioPath of audioPaths) await cleanupTempFile(audioPath);
      }
    },
    { connection: createRedisConnection() },
  );
}
