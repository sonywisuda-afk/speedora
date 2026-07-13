import { createReadStream, createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as Sentry from '@sentry/node';
import {
  analyzeAudioLoudness,
  computeSpeakingRate,
  deriveVoiceActivityFeatures,
  detectVoiceActivity,
} from '@speedora/audio-intelligence';
import { Prisma, updateVideoStatus, VideoStatus } from '@speedora/database';
import { deriveDiarizationFeatures } from '@speedora/speaker-diarization';
import {
  QueueName,
  TranscriptionProvider,
  type TranscribeJobData,
  type TranscribeJobResult,
} from '@speedora/shared';
import { getObjectStream, uploadObject } from '@speedora/storage';
import { Worker, type Job } from 'bullmq';
import type OpenAI from 'openai';
import { audioIntelligenceDeps } from '../audioIntelligenceDeps';
import {
  assignSpeakerLabels,
  diarizeSpeakers,
  toFriendlySpeakerTurns,
  type SpeakerTurn,
} from '../diarization';
import {
  type AudioWindow,
  extractAudio,
  extractBlurPlaceholder,
  extractThumbnail,
  getMediaDurationSeconds,
} from '../ffmpeg';
import { groq, GROQ_WHISPER_MODEL } from '../groq';
import { withJobTimeout } from '../jobTimeout';
import { forStage } from '../logger';
import { openai, OPENAI_WHISPER_MODEL } from '../openai';
import { prisma } from '../prisma';
import { detectClipsQueue } from '../queues';
import { createRedisConnection } from '../redis';
import { cleanupTempFile, reserveScratchPath } from '../storage';
import { detectVocalEmotions } from '../vocalEmotion';
import { voiceActivityDeps } from '../voiceActivityDeps';

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

// Defense-in-depth outer bound (see jobTimeout.ts) - generous enough for a
// very long source split into several 50-min Whisper chunks (each itself
// bounded by the OpenAI SDK's own ~10 min default request timeout) plus
// diarization/vocal-emotion's own 5-min timeouts and loudness/VAD overhead,
// while still failing an actually-hung job instead of never returning.
const TRANSCRIBE_JOB_TIMEOUT_MS = 60 * 60 * 1000;

// Phase 3 (Hover Preview/Storyboard roadmap) - evenly spaced, excluding the
// very start/end (often black/transition frames) - same "5 frames" choice for
// Video and Clip storyboards.
const STORYBOARD_FRAME_FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

const logger = forStage('transcribe');

export function createTranscribeWorker(): Worker<TranscribeJobData, TranscribeJobResult> {
  return new Worker<TranscribeJobData, TranscribeJobResult>(
    QueueName.TRANSCRIBE,
    (job: Job<TranscribeJobData>) =>
      withJobTimeout(
        async () => {
          const { videoId, sourceUrl, provider } = job.data;

          // A video can be deleted (VideosService.remove) while its transcribe
          // job is still sitting in the queue - deletion doesn't reach into
          // BullMQ to cancel it. Without this check, a stale job like that would
          // still burn a real Whisper API call and then blow up on the very
          // first prisma.video.update() (P2025, no such row) - checked here,
          // before any of that work starts, rather than discovered expensively
          // partway through.
          const existingVideo = await prisma.video.findUnique({
            where: { id: videoId },
            select: { status: true },
          });
          if (!existingVideo) {
            logger.info('video was deleted - skipping orphaned job', { videoId });
            return { videoId, segments: [] };
          }

          // Idempotency guard: BullMQ's own stalled-job recovery (see docs/queue.md) can re-queue and
          // re-run THIS SAME job a second time if the first attempt's lock isn't renewed in time (e.g.
          // a slow but not-yet-fixed downstream step hanging past the lock TTL) - observed for real
          // during Phase 1 timeout work, where a stalled transcribe job got reprocessed and burned a
          // full second pass of Whisper API calls for a video that had already finished transcribing,
          // duplicating both the cost and (at the time) the TranscriptSegment rows. UPLOADED is this
          // job's own precondition (see reportProgress(0) below and VideosService.upload/retry, the
          // only two callers that enqueue this job) - status having moved past it already means some
          // execution of this same job already completed the real work, so re-doing it here would only
          // waste a paid transcription-API call, not produce a different or more-correct result.
          if (existingVideo.status !== VideoStatus.UPLOADED) {
            logger.info(
              'video is already past UPLOADED - skipping to avoid a duplicate Whisper API pass ' +
                '(see BullMQ stalled-job re-processing note above)',
              { videoId, status: existingVideo.status },
            );
            return { videoId, segments: [] };
          }

          logger.info('processing video', { videoId, sourceUrl, provider });

          let sourcePath: string | null = null;
          let thumbPath: string | null = null;
          let blurPath: string | null = null;
          const audioPaths: string[] = [];
          const storyboardPaths: string[] = [];

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
            sourcePath = await reserveScratchPath(
              'transcribe-src',
              path.extname(sourceUrl) || '.mp4',
            );
            const sourceStream = await getObjectStream(sourceUrl);
            await pipeline(sourceStream, createWriteStream(sourcePath));
            await reportProgress(videoId, 5);

            // Product Experience roadmap - a Video's dashboard-card thumbnail.
            // Best-effort, same "optional signal, never fails the job" idiom as
            // diarization/vocal-emotion below - a failed extraction just leaves
            // Video.thumbnailUrl null (the dashboard already has an honest
            // placeholder for that case), it never fails transcription itself.
            // Extracted here (not in import-youtube.worker.ts) since this is the
            // one stage guaranteed to run for every video regardless of upload
            // path (youtube-import vs. direct upload both reach here with
            // sourcePath already a real local file).
            try {
              thumbPath = await reserveScratchPath('thumbnail', '.webp');
              await extractThumbnail(sourcePath, thumbPath, 1);
              const thumbnailKey = `thumbnails/${videoId}.webp`;
              await uploadObject(thumbnailKey, createReadStream(thumbPath), 'image/webp');

              // Phase 2 (image optimization roadmap) - a tiny inline blur
              // placeholder alongside the real thumbnail, same best-effort
              // block (a failed blur extraction shouldn't undo an otherwise-
              // successful thumbnail, so it's caught on its own rather than
              // aborting the block above).
              let thumbnailBlurDataUrl: string | null = null;
              try {
                blurPath = await reserveScratchPath('thumbnail-blur', '.webp');
                await extractBlurPlaceholder(sourcePath, blurPath, 1);
                const blurBuffer = await readFile(blurPath);
                thumbnailBlurDataUrl = `data:image/webp;base64,${blurBuffer.toString('base64')}`;
              } catch (error) {
                logger.warn(
                  'blur placeholder extraction failed, continuing without one',
                  { videoId },
                  error,
                );
              }

              await prisma.video.update({
                where: { id: videoId },
                data: { thumbnailUrl: thumbnailKey, thumbnailBlurDataUrl },
              });
            } catch (error) {
              logger.warn('thumbnail extraction failed, continuing without one', { videoId }, error);
            }

            // Decide up front whether the audio fits in one Whisper request or
            // has to be split - a source longer than ~50 min would otherwise
            // extract to an audio file that's still over the 25 MB limit.
            const durationSeconds = await getMediaDurationSeconds(sourcePath);

            // Phase 3 (Hover Preview/Storyboard roadmap) - N evenly-spaced
            // frames for a scrubber-style preview, reusing extractThumbnail()
            // unchanged (just called multiple times at different offsets).
            // Each frame is its own independent best-effort extraction - one
            // failing (e.g. a NaN durationSeconds for a container with no
            // reported duration) doesn't block the others; storyboardKeys
            // ends up with however many actually succeeded, written as a real
            // (possibly empty, never fabricated) array either way.
            try {
              const storyboardKeys: string[] = [];
              for (let i = 0; i < STORYBOARD_FRAME_FRACTIONS.length; i++) {
                try {
                  const framePath = await reserveScratchPath(`storyboard-${i}`, '.webp');
                  storyboardPaths.push(framePath);
                  await extractThumbnail(sourcePath, framePath, durationSeconds * STORYBOARD_FRAME_FRACTIONS[i]);
                  const frameKey = `storyboards/${videoId}-${i}.webp`;
                  await uploadObject(frameKey, createReadStream(framePath), 'image/webp');
                  storyboardKeys.push(frameKey);
                } catch (error) {
                  logger.warn(
                    'storyboard frame extraction failed, skipping this frame',
                    { videoId, frameIndex: i },
                    error,
                  );
                }
              }
              await prisma.video.update({
                where: { id: videoId },
                data: { storyboardFrameUrls: storyboardKeys },
              });
            } catch (error) {
              logger.warn('storyboard extraction failed, continuing without one', { videoId }, error);
            }
            const chunks = planTranscriptionChunks(durationSeconds);
            const singleRequest = chunks.length === 1;
            if (!singleRequest) {
              logger.info('splitting a long video into chunks', {
                videoId,
                approxMinutes: Math.round(durationSeconds / 60),
                chunkCount: chunks.length,
              });
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
              logger.info('diarization found speakers', {
                videoId,
                speakerCount,
                turnCount: speakerTurns.length,
              });
            } catch (error) {
              logger.warn(
                'speaker diarization failed, continuing without speaker labels',
                { videoId },
                error,
              );
            }
            const speakerLabels = assignSpeakerLabels(mergedSegments, speakerTurns);
            // Speaker Intelligence roadmap, Milestone B (Turn/Silence/Overlap
            // Detection) - relabels the raw turns diarizeSpeakers() returned
            // with the SAME friendly labels just assigned to segments above,
            // then derives speakerCount/segments/durations/turnCount/
            // switchCount/overlappingSpeech/silences from them. Null (not an
            // all-zero object) when diarization found no turns at all - same
            // "optional signal, nothing fabricated" convention as every other
            // detector in this block.
            const diarizationFeatures =
              speakerTurns.length > 0
                ? deriveDiarizationFeatures(toFriendlySpeakerTurns(mergedSegments, speakerTurns))
                : null;

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
              logger.warn(
                'vocal emotion detection failed, continuing without emotion labels',
                { videoId },
                error,
              );
            }

            // Audio Intelligence (Fase 25, Phase A of the AI Fusion roadmap) -
            // per-segment loudness, reusing the SAME full-track audio file
            // diarization/vocal-emotion already extracted above. Never fails
            // the job, same "optional signal" pattern as diarization/emotion -
            // a failed analysis just leaves every segment's rmsDb/peakDb unset.
            let loudnessResults: Array<{ rmsDb: number | null; peakDb: number | null }> = [];
            try {
              const { segments: loudness } = await analyzeAudioLoudness(
                { audioPath: diarizeAudioPath, segments: mergedSegments },
                audioIntelligenceDeps,
              );
              loudnessResults = loudness;
            } catch (error) {
              logger.warn(
                'audio loudness analysis failed, continuing without loudness data',
                { videoId },
                error,
              );
            }

            // Speaker Intelligence roadmap, Milestone A (Voice Activity
            // Detection) - reuses the SAME full-track audio file diarization/
            // vocal-emotion/loudness already extracted above. Unlike those,
            // its output doesn't map onto TranscriptSegment rows at all (see
            // schema.prisma's Video.voiceActivitySegments comment) - persisted
            // directly on Video below. Never fails the job, same "optional
            // signal" pattern as every other detector in this block.
            let voiceActivitySegments: Awaited<ReturnType<typeof detectVoiceActivity>> | null =
              null;
            try {
              voiceActivitySegments = await detectVoiceActivity(
                { audioPath: diarizeAudioPath, durationSeconds },
                voiceActivityDeps,
              );
            } catch (error) {
              logger.warn(
                'voice activity detection failed, continuing without VAD data',
                { videoId },
                error,
              );
            }
            const voiceActivityFeatures = deriveVoiceActivityFeatures(
              voiceActivitySegments ?? [],
              durationSeconds,
            );

            // Whisper returns words as one flat, per-chunk array rather than
            // nested per segment - bucket each word into the segment whose
            // [start, end) it falls in so render-clip's karaoke caption preset
            // can access a segment's words alongside its text.
            const segments = mergedSegments.map((segment, i) => {
              const words = mergedWords
                .filter((word) => word.start >= segment.start && word.start < segment.end)
                .map((word) => ({ word: word.word, start: word.start, end: word.end }));

              return {
                start: segment.start,
                end: segment.end,
                text: segment.text.trim(),
                speaker: speakerLabels[i],
                emotion: emotionResults[i]?.emotion,
                words,
                rmsDb: loudnessResults[i]?.rmsDb ?? undefined,
                peakDb: loudnessResults[i]?.peakDb ?? undefined,
                speakingRateWordsPerSecond: computeSpeakingRate({
                  segmentStart: segment.start,
                  segmentEnd: segment.end,
                  wordCount: words.length,
                }).wordsPerSecond,
              };
            });

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
                data: {
                  status: VideoStatus.TRANSCRIBED,
                  transcribeProgress: null,
                  voiceActivitySegments: voiceActivitySegments ?? Prisma.JsonNull,
                  voiceActivityFeatures,
                  diarizationFeatures: diarizationFeatures ?? Prisma.JsonNull,
                },
              }),
              prisma.videoStatusEvent.create({
                data: { videoId, toStatus: VideoStatus.TRANSCRIBED, errorMessage: null },
              }),
            ]);

            logger.info('video transcribed', { videoId, segmentCount: segments.length });

            await detectClipsQueue.add(QueueName.DETECT_CLIPS, { videoId, segments });

            return { videoId, segments };
          } catch (error) {
            logger.error('video failed', { videoId }, error);
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
            if (thumbPath) await cleanupTempFile(thumbPath);
            if (blurPath) await cleanupTempFile(blurPath);
            for (const storyboardPath of storyboardPaths) await cleanupTempFile(storyboardPath);
            for (const audioPath of audioPaths) await cleanupTempFile(audioPath);
          }
        },
        TRANSCRIBE_JOB_TIMEOUT_MS,
        `transcribe:${job.data.videoId}`,
      ),
    {
      connection: createRedisConnection(),
      // Explicit, not the implicit default - one video transcribes at a
      // time per worker process. Raising this needs a real capacity-
      // planning decision (CPU/memory headroom for concurrent Whisper
      // uploads + diarization/emotion/loudness/VAD subprocesses), not an
      // accidental default.
      concurrency: 1,
      // Comfortably above this job's worst-case real duration (multi-chunk
      // Whisper calls + diarization + vocal emotion, each independently
      // timeout-bounded but stackable) - BullMQ's default 30s lock/stall
      // window is far shorter than that, which is why a legitimately-still-
      // running job got mistaken for stalled and reprocessed for real
      // tonight, duplicating a paid Whisper API pass (see the idempotency
      // guard above, which is the other half of this fix).
      lockDuration: 20 * 60 * 1000,
    },
  );
}
