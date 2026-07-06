import { VideoStatus } from '@speedora/database';
import { QueueName, TranscriptionProvider } from '@speedora/shared';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const detectClipsQueueAdd = jest.fn();
jest.mock('../queues', () => ({
  detectClipsQueue: { add: (...args: unknown[]) => detectClipsQueueAdd(...args) },
  renderClipQueue: { add: jest.fn() },
}));

const getObjectStreamMock = jest.fn();
jest.mock('@speedora/storage', () => ({
  getObjectStream: (...args: unknown[]) => getObjectStreamMock(...args),
}));

// Unique path per call - each chunk of a long video reserves its own audio
// scratch file, and the tests assert distinct paths get cleaned up.
let scratchCounter = 0;
const reserveScratchPathMock = jest.fn(
  (prefix: string, ext: string) => `/scratch/${prefix}-${scratchCounter++}${ext}`,
);
const cleanupTempFileMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../storage', () => ({
  reserveScratchPath: (...args: [string, string]) => reserveScratchPathMock(...args),
  cleanupTempFile: (...args: unknown[]) => cleanupTempFileMock(...args),
}));

const extractAudioMock = jest.fn().mockResolvedValue(undefined);
const getMediaDurationSecondsMock = jest.fn();
jest.mock('../ffmpeg', () => ({
  extractAudio: (...args: unknown[]) => extractAudioMock(...args),
  getMediaDurationSeconds: (...args: unknown[]) => getMediaDurationSecondsMock(...args),
}));

const diarizeSpeakersMock = jest.fn();
const assignSpeakerLabelsMock = jest.fn();
jest.mock('../diarization', () => ({
  diarizeSpeakers: (...args: unknown[]) => diarizeSpeakersMock(...args),
  assignSpeakerLabels: (...args: unknown[]) => assignSpeakerLabelsMock(...args),
}));

const detectVocalEmotionsMock = jest.fn();
jest.mock('../vocalEmotion', () => ({
  detectVocalEmotions: (...args: unknown[]) => detectVocalEmotionsMock(...args),
}));

const createReadStreamMock = jest.fn((p: string) => ({ readStreamFor: p }));
jest.mock('node:fs', () => ({
  createReadStream: (...args: [string]) => createReadStreamMock(...args),
  createWriteStream: jest.fn(() => ({ fake: 'writable' })),
}));

const pipelineMock = jest.fn().mockResolvedValue(undefined);
jest.mock('node:stream/promises', () => ({
  pipeline: (...args: unknown[]) => pipelineMock(...args),
}));

const openaiTranscriptionsCreateMock = jest.fn();
jest.mock('../openai', () => ({
  openai: {
    audio: {
      transcriptions: { create: (...args: unknown[]) => openaiTranscriptionsCreateMock(...args) },
    },
  },
  OPENAI_WHISPER_MODEL: 'whisper-1',
}));

const groqTranscriptionsCreateMock = jest.fn();
jest.mock('../groq', () => ({
  groq: {
    audio: {
      transcriptions: { create: (...args: unknown[]) => groqTranscriptionsCreateMock(...args) },
    },
  },
  GROQ_WHISPER_MODEL: 'whisper-large-v3-turbo',
}));

const transcriptSegmentCreateManyMock = jest.fn();
const videoUpdateMock = jest.fn();
const videoStatusEventCreateMock = jest.fn();
const transactionMock = jest.fn((ops: Promise<unknown>[]) => Promise.all(ops));
jest.mock('../prisma', () => ({
  prisma: {
    transcriptSegment: {
      createMany: (...args: unknown[]) => transcriptSegmentCreateManyMock(...args),
    },
    video: { update: (...args: unknown[]) => videoUpdateMock(...args) },
    // Fase 3 (DB+JSON-contract roadmap) - written alongside video.update()
    // in the same $transaction (both the success-path inline transaction
    // and updateVideoStatus()'s own, for the FAILED case).
    videoStatusEvent: { create: (...args: unknown[]) => videoStatusEventCreateMock(...args) },
    $transaction: (...args: [Promise<unknown>[]]) => transactionMock(...args),
  },
}));

import {
  computeChunkExtractionWindow,
  createTranscribeWorker,
  planTranscriptionChunks,
} from './transcribe.worker';

function getProcessor() {
  createTranscribeWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: {
    data: { videoId: string; sourceUrl: string; provider: TranscriptionProvider };
  }) => Promise<unknown>;
}

describe('transcribe worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    scratchCounter = 0;
    transactionMock.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    transcriptSegmentCreateManyMock.mockResolvedValue({ count: 2 });
    videoUpdateMock.mockResolvedValue({});
    videoStatusEventCreateMock.mockResolvedValue({});
    detectClipsQueueAdd.mockResolvedValue(undefined);
    // Short enough for a single Whisper request unless a test overrides it.
    getMediaDurationSecondsMock.mockResolvedValue(120);
    process.env.OPENAI_API_KEY = 'sk-test';
    // No speaker labels by default - individual tests override this to
    // exercise the diarization-succeeds path.
    diarizeSpeakersMock.mockResolvedValue([]);
    assignSpeakerLabelsMock.mockReturnValue([]);
    // No emotion labels by default - individual tests override this to
    // exercise the emotion-detection-succeeds path.
    detectVocalEmotionsMock.mockResolvedValue([]);
  });

  it('extracts audio from the source video and enqueues detect-clips on success (GROQ, the default provider)', async () => {
    const fakeStream = { fake: 'stream' };
    getObjectStreamMock.mockResolvedValue(fakeStream);
    groqTranscriptionsCreateMock.mockResolvedValue({
      segments: [
        { start: 0, end: 2, text: '  hi  ' },
        { start: 2, end: 4, text: 'there' },
      ],
      words: [
        { start: 0, end: 0.8, word: 'hi' },
        { start: 2, end: 2.5, word: 'there' },
      ],
    });

    const processor = getProcessor();
    const result = await processor({
      data: {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        provider: TranscriptionProvider.GROQ,
      },
    });

    // Source is downloaded to scratch, then audio is extracted from it -
    // the video itself is never sent to Whisper (25 MB limit). A short video
    // is a single Whisper request: full extraction (no window arg).
    expect(getObjectStreamMock).toHaveBeenCalledWith('videos/abc.mp4');
    expect(pipelineMock).toHaveBeenCalledWith(fakeStream, expect.anything());
    // Two extractions: the Whisper chunk's own audio, plus one dedicated
    // full-track extraction for diarization (see transcribe.worker.ts's
    // comment - decoupled from Whisper's own chunking on purpose).
    expect(extractAudioMock).toHaveBeenCalledTimes(2);
    expect(extractAudioMock).toHaveBeenCalledWith(
      '/scratch/transcribe-src-0.mp4',
      '/scratch/transcribe-audio-1.mp3',
      undefined,
    );
    expect(extractAudioMock).toHaveBeenCalledWith(
      '/scratch/transcribe-src-0.mp4',
      '/scratch/diarize-audio-2.mp3',
    );
    expect(diarizeSpeakersMock).toHaveBeenCalledWith('/scratch/diarize-audio-2.mp3');
    expect(groqTranscriptionsCreateMock).toHaveBeenCalledWith({
      file: { readStreamFor: '/scratch/transcribe-audio-1.mp3' },
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });
    expect(openaiTranscriptionsCreateMock).not.toHaveBeenCalled();
    // All scratch files are cleaned up regardless of outcome.
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-src-0.mp4');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-audio-1.mp3');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/diarize-audio-2.mp3');

    const segments = [
      { start: 0, end: 2, text: 'hi', words: [{ start: 0, end: 0.8, word: 'hi' }] },
      { start: 2, end: 4, text: 'there', words: [{ start: 2, end: 2.5, word: 'there' }] },
    ];
    expect(transcriptSegmentCreateManyMock).toHaveBeenCalledWith({
      data: segments.map((s) => ({ videoId: 'video-1', ...s })),
    });
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.TRANSCRIBED, transcribeProgress: null },
    });
    expect(detectClipsQueueAdd).toHaveBeenCalledWith(QueueName.DETECT_CLIPS, {
      videoId: 'video-1',
      segments,
    });
    expect(result).toEqual({ videoId: 'video-1', segments });
  });

  it('reports real progress checkpoints (never fabricated) to Video.transcribeProgress', async () => {
    getObjectStreamMock.mockResolvedValue({});
    groqTranscriptionsCreateMock.mockResolvedValue({
      segments: [{ start: 0, end: 2, text: 'hi' }],
      words: [{ start: 0, end: 0.8, word: 'hi' }],
    });

    const processor = getProcessor();
    await processor({
      data: {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        provider: TranscriptionProvider.GROQ,
      },
    });

    // Reset to 0 before any work starts (so a retry never shows a stale
    // value from a previous failed attempt), 5 once the source is
    // downloaded, then 90 once the (single, in this short-video case)
    // Whisper call returns - there's no finer signal available mid-call.
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { transcribeProgress: 0 },
    });
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { transcribeProgress: 5 },
    });
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { transcribeProgress: 90 },
    });
  });

  it('reports one progress checkpoint per chunk for a long video', async () => {
    getObjectStreamMock.mockResolvedValue({});
    getMediaDurationSecondsMock.mockResolvedValue(7000);
    groqTranscriptionsCreateMock
      .mockResolvedValueOnce({ segments: [{ start: 0, end: 2, text: 'a' }], words: [] })
      .mockResolvedValueOnce({ segments: [{ start: 0, end: 2, text: 'b' }], words: [] })
      .mockResolvedValueOnce({ segments: [{ start: 0, end: 2, text: 'c' }], words: [] });

    const processor = getProcessor();
    await processor({
      data: {
        videoId: 'video-1',
        sourceUrl: 'videos/long.mp4',
        provider: TranscriptionProvider.GROQ,
      },
    });

    // 3 chunks: 10 + round((i/3) * 80) for i in 1..3 -> 37, 63, 90.
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { transcribeProgress: 37 },
    });
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { transcribeProgress: 63 },
    });
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { transcribeProgress: 90 },
    });
  });

  it('buckets each word into the segment whose range contains its start time', async () => {
    getObjectStreamMock.mockResolvedValue({});
    groqTranscriptionsCreateMock.mockResolvedValue({
      segments: [
        { start: 0, end: 2, text: 'hi there' },
        { start: 5, end: 7, text: 'unrelated' },
      ],
      // 'gap' starts before any segment and belongs to none - dropped, not
      // mis-assigned to the nearest one.
      words: [
        { start: -1, end: -0.5, word: 'gap' },
        { start: 0, end: 0.4, word: 'hi' },
        { start: 0.5, end: 0.9, word: 'there' },
      ],
    });

    const processor = getProcessor();
    await processor({
      data: {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        provider: TranscriptionProvider.GROQ,
      },
    });

    expect(transcriptSegmentCreateManyMock).toHaveBeenCalledWith({
      data: [
        {
          videoId: 'video-1',
          start: 0,
          end: 2,
          text: 'hi there',
          words: [
            { start: 0, end: 0.4, word: 'hi' },
            { start: 0.5, end: 0.9, word: 'there' },
          ],
        },
        { videoId: 'video-1', start: 5, end: 7, text: 'unrelated', words: [] },
      ],
    });
  });

  it('marks the video FAILED and rethrows when transcription fails', async () => {
    getObjectStreamMock.mockResolvedValue({});
    groqTranscriptionsCreateMock.mockRejectedValue(new Error('whisper is down'));

    const processor = getProcessor();

    await expect(
      processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.GROQ,
        },
      }),
    ).rejects.toThrow('whisper is down');

    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.FAILED },
    });
    expect(detectClipsQueueAdd).not.toHaveBeenCalled();
    // Scratch files still cleaned up on the failure path.
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-src-0.mp4');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-audio-1.mp3');
  });

  it('reports the failure to Sentry tagged with videoId only (no transcript content)', async () => {
    getObjectStreamMock.mockResolvedValue({});
    const error = new Error('whisper is down');
    groqTranscriptionsCreateMock.mockRejectedValue(error);

    const processor = getProcessor();

    await expect(
      processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.GROQ,
        },
      }),
    ).rejects.toThrow('whisper is down');

    expect(captureExceptionMock).toHaveBeenCalledWith(error, { tags: { videoId: 'video-1' } });
  });

  it('splits a long video into OVERLAPPING extraction windows and re-offsets each chunk onto the absolute timeline', async () => {
    getObjectStreamMock.mockResolvedValue({});
    // ~117 min -> 3 nominal chunks of 50/50/~16.7 min (boundaries at 0,
    // 3000, 6000, 7000s) - but each is actually EXTRACTED 15s wider on
    // each side (see computeChunkExtractionWindow), clamped to [0, 7000].
    getMediaDurationSecondsMock.mockResolvedValue(7000);
    groqTranscriptionsCreateMock
      // Chunk 0's extraction is [0, 3015) - "a" is real content near the
      // start; "ghost-a" is what this chunk transcribed from ITS OWN
      // trailing overlap fringe (past its nominal end at 3000) - the exact
      // same moment chunk 1 also hears (with leading context this time),
      // so it must be dropped from chunk 0's contribution to avoid a
      // duplicate.
      .mockResolvedValueOnce({
        segments: [
          { start: 0, end: 2, text: 'a' },
          { start: 3005, end: 3007, text: 'ghost-a' },
        ],
        words: [
          { start: 0, end: 1, word: 'a' },
          { start: 3005, end: 3006, word: 'ghost-a' },
        ],
      })
      // Chunk 1's extraction is [2985, 6015) - "ghost-b" is this chunk's
      // own LEADING overlap fringe (before its nominal start at 3000,
      // absolute 2986) and must be dropped (chunk 0 owns that moment);
      // "b" (relative 16 -> absolute 3001) is real content inside chunk
      // 1's own nominal window and is kept.
      .mockResolvedValueOnce({
        segments: [
          { start: 1, end: 3, text: 'ghost-b' },
          { start: 16, end: 18, text: 'b' },
        ],
        words: [
          { start: 1, end: 2, word: 'ghost-b' },
          { start: 16, end: 17, word: 'b' },
        ],
      })
      // Chunk 2's extraction is [5985, 7000) - same shape as chunk 1: a
      // leading-fringe ghost dropped, then real content ("c", relative 15
      // -> absolute 6000, exactly the nominal boundary) kept.
      .mockResolvedValueOnce({
        segments: [
          { start: 1, end: 2, text: 'ghost-c' },
          { start: 15, end: 16, text: 'c' },
        ],
        words: [
          { start: 1, end: 1.5, word: 'ghost-c' },
          { start: 15, end: 15.5, word: 'c' },
        ],
      });

    const processor = getProcessor();
    await processor({
      data: {
        videoId: 'video-1',
        sourceUrl: 'videos/long.mp4',
        provider: TranscriptionProvider.GROQ,
      },
    });

    // One extraction per chunk, each widened by CHUNK_OVERLAP_SECONDS (15s)
    // on both sides and clamped to [0, 7000] - the first chunk has no
    // leading overlap (clamped to 0) and the last has no trailing overlap
    // (clamped to the real duration) - plus one final full-track
    // extraction for diarization (no window).
    expect(extractAudioMock).toHaveBeenCalledTimes(4);
    expect(extractAudioMock).toHaveBeenNthCalledWith(
      1,
      '/scratch/transcribe-src-0.mp4',
      '/scratch/transcribe-audio-1.mp3',
      {
        startSeconds: 0,
        durationSeconds: 3015,
      },
    );
    expect(extractAudioMock).toHaveBeenNthCalledWith(
      2,
      '/scratch/transcribe-src-0.mp4',
      '/scratch/transcribe-audio-2.mp3',
      {
        startSeconds: 2985,
        durationSeconds: 3030,
      },
    );
    expect(extractAudioMock).toHaveBeenNthCalledWith(
      3,
      '/scratch/transcribe-src-0.mp4',
      '/scratch/transcribe-audio-3.mp3',
      {
        startSeconds: 5985,
        durationSeconds: 1015,
      },
    );
    expect(extractAudioMock).toHaveBeenNthCalledWith(
      4,
      '/scratch/transcribe-src-0.mp4',
      '/scratch/diarize-audio-4.mp3',
    );
    expect(groqTranscriptionsCreateMock).toHaveBeenCalledTimes(3);

    // Each chunk's 0-based timestamps are shifted by its EXTRACTION start
    // (not its nominal start) before being merged, and anything outside
    // that chunk's own nominal ownership window is dropped - so the
    // "ghost" duplicates from the overlap fringes never appear, and the
    // real content lands at the correct absolute time with no gap or
    // double-count at either boundary.
    expect(transcriptSegmentCreateManyMock).toHaveBeenCalledWith({
      data: [
        {
          videoId: 'video-1',
          start: 0,
          end: 2,
          text: 'a',
          words: [{ start: 0, end: 1, word: 'a' }],
        },
        {
          videoId: 'video-1',
          start: 3001,
          end: 3003,
          text: 'b',
          words: [{ start: 3001, end: 3002, word: 'b' }],
        },
        {
          videoId: 'video-1',
          start: 6000,
          end: 6001,
          text: 'c',
          words: [{ start: 6000, end: 6000.5, word: 'c' }],
        },
      ],
    });

    // Source, all three chunk audio files, and the diarization audio file
    // are all cleaned up.
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-src-0.mp4');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-audio-1.mp3');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-audio-2.mp3');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-audio-3.mp3');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/diarize-audio-4.mp3');
  });

  it('uses the OpenAI Whisper client/model when provider is OPENAI (premium tier)', async () => {
    getObjectStreamMock.mockResolvedValue({});
    openaiTranscriptionsCreateMock.mockResolvedValue({
      segments: [{ start: 0, end: 2, text: 'hi' }],
      words: [{ start: 0, end: 0.8, word: 'hi' }],
    });

    const processor = getProcessor();
    await processor({
      data: {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        provider: TranscriptionProvider.OPENAI,
      },
    });

    expect(openaiTranscriptionsCreateMock).toHaveBeenCalledWith({
      file: { readStreamFor: '/scratch/transcribe-audio-1.mp3' },
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });
    expect(groqTranscriptionsCreateMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.TRANSCRIBED, transcribeProgress: null },
    });
  });

  it('marks the video FAILED without calling either Whisper client when OPENAI is requested but OPENAI_API_KEY is unset', async () => {
    delete process.env.OPENAI_API_KEY;
    getObjectStreamMock.mockResolvedValue({});

    const processor = getProcessor();

    await expect(
      processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.OPENAI,
        },
      }),
    ).rejects.toThrow(
      'OPENAI_API_KEY is not configured - premium (OpenAI Whisper) transcription is unavailable',
    );

    expect(openaiTranscriptionsCreateMock).not.toHaveBeenCalled();
    expect(groqTranscriptionsCreateMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.FAILED },
    });
  });

  describe('speaker diarization (Fase 12)', () => {
    it('attaches speaker labels to segments when diarization succeeds', async () => {
      getObjectStreamMock.mockResolvedValue({});
      groqTranscriptionsCreateMock.mockResolvedValue({
        segments: [
          { start: 0, end: 2, text: 'hi' },
          { start: 2, end: 4, text: 'there' },
        ],
        words: [
          { start: 0, end: 0.8, word: 'hi' },
          { start: 2, end: 2.5, word: 'there' },
        ],
      });
      const turns = [
        { start: 0, end: 2, speaker: 'SPEAKER_00' },
        { start: 2, end: 4, speaker: 'SPEAKER_01' },
      ];
      diarizeSpeakersMock.mockResolvedValue(turns);
      assignSpeakerLabelsMock.mockReturnValue(['Speaker A', 'Speaker B']);

      const processor = getProcessor();
      await processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.GROQ,
        },
      });

      expect(diarizeSpeakersMock).toHaveBeenCalledWith('/scratch/diarize-audio-2.mp3');
      expect(assignSpeakerLabelsMock).toHaveBeenCalledWith(
        [
          { start: 0, end: 2, text: 'hi' },
          { start: 2, end: 4, text: 'there' },
        ],
        turns,
      );
      expect(transcriptSegmentCreateManyMock).toHaveBeenCalledWith({
        data: [
          {
            videoId: 'video-1',
            start: 0,
            end: 2,
            text: 'hi',
            speaker: 'Speaker A',
            words: [{ start: 0, end: 0.8, word: 'hi' }],
          },
          {
            videoId: 'video-1',
            start: 2,
            end: 4,
            text: 'there',
            speaker: 'Speaker B',
            words: [{ start: 2, end: 2.5, word: 'there' }],
          },
        ],
      });
    });

    it('continues without speaker labels (does not fail the job) when diarization throws', async () => {
      getObjectStreamMock.mockResolvedValue({});
      groqTranscriptionsCreateMock.mockResolvedValue({
        segments: [{ start: 0, end: 2, text: 'hi' }],
        words: [{ start: 0, end: 0.8, word: 'hi' }],
      });
      diarizeSpeakersMock.mockRejectedValue(new Error('HUGGINGFACE_TOKEN is not set'));

      const processor = getProcessor();
      const result = await processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.GROQ,
        },
      });

      // assignSpeakerLabels still runs (with turns=[]) - the mock's default
      // return ([]) means every segment's speaker stays undefined, same as
      // if diarization had simply found nothing.
      expect(assignSpeakerLabelsMock).toHaveBeenCalledWith([{ start: 0, end: 2, text: 'hi' }], []);
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({
        videoId: 'video-1',
        segments: [{ start: 0, end: 2, text: 'hi', words: [{ start: 0, end: 0.8, word: 'hi' }] }],
      });
    });
  });

  describe('vocal emotion detection (Fase 13)', () => {
    it('attaches emotion labels to segments when detection succeeds, reusing the diarization audio file', async () => {
      getObjectStreamMock.mockResolvedValue({});
      groqTranscriptionsCreateMock.mockResolvedValue({
        segments: [
          { start: 0, end: 2, text: 'hi' },
          { start: 2, end: 4, text: 'there' },
        ],
        words: [
          { start: 0, end: 0.8, word: 'hi' },
          { start: 2, end: 2.5, word: 'there' },
        ],
      });
      detectVocalEmotionsMock.mockResolvedValue([{ emotion: 'hap', score: 0.83 }, null]);

      const processor = getProcessor();
      await processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.GROQ,
        },
      });

      // Same diarize-audio-2.mp3 file diarization itself uses - no second
      // full-track extraction for emotion detection.
      expect(detectVocalEmotionsMock).toHaveBeenCalledWith('/scratch/diarize-audio-2.mp3', [
        { start: 0, end: 2, text: 'hi' },
        { start: 2, end: 4, text: 'there' },
      ]);
      expect(transcriptSegmentCreateManyMock).toHaveBeenCalledWith({
        data: [
          {
            videoId: 'video-1',
            start: 0,
            end: 2,
            text: 'hi',
            emotion: 'hap',
            words: [{ start: 0, end: 0.8, word: 'hi' }],
          },
          {
            videoId: 'video-1',
            start: 2,
            end: 4,
            text: 'there',
            emotion: undefined,
            words: [{ start: 2, end: 2.5, word: 'there' }],
          },
        ],
      });
    });

    it('continues without emotion labels (does not fail the job) when detection throws', async () => {
      getObjectStreamMock.mockResolvedValue({});
      groqTranscriptionsCreateMock.mockResolvedValue({
        segments: [{ start: 0, end: 2, text: 'hi' }],
        words: [{ start: 0, end: 0.8, word: 'hi' }],
      });
      detectVocalEmotionsMock.mockRejectedValue(new Error('model download failed'));

      const processor = getProcessor();
      const result = await processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.GROQ,
        },
      });

      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({
        videoId: 'video-1',
        segments: [{ start: 0, end: 2, text: 'hi', words: [{ start: 0, end: 0.8, word: 'hi' }] }],
      });
    });
  });
});

describe('planTranscriptionChunks', () => {
  it('returns a single full-length window for a source at or under the limit', () => {
    expect(planTranscriptionChunks(120)).toEqual([{ startSeconds: 0, durationSeconds: 120 }]);
    // Exactly 50 min still fits in one request.
    expect(planTranscriptionChunks(50 * 60)).toEqual([
      { startSeconds: 0, durationSeconds: 50 * 60 },
    ]);
  });

  it('treats an unprobed (NaN) or zero duration as a single window', () => {
    expect(planTranscriptionChunks(Number.NaN)).toEqual([{ startSeconds: 0, durationSeconds: 0 }]);
    expect(planTranscriptionChunks(0)).toEqual([{ startSeconds: 0, durationSeconds: 0 }]);
  });

  it('splits a longer source into 50-minute windows with a shorter final chunk', () => {
    expect(planTranscriptionChunks(7000)).toEqual([
      { startSeconds: 0, durationSeconds: 3000 },
      { startSeconds: 3000, durationSeconds: 3000 },
      { startSeconds: 6000, durationSeconds: 1000 },
    ]);
  });

  it('splits an exact multiple of the limit into equal windows with no empty tail', () => {
    expect(planTranscriptionChunks(6000)).toEqual([
      { startSeconds: 0, durationSeconds: 3000 },
      { startSeconds: 3000, durationSeconds: 3000 },
    ]);
  });
});

describe('computeChunkExtractionWindow (Fase 18 - Seamless Long-Video Chunking)', () => {
  it('widens a middle chunk by 15s on both sides', () => {
    const window = computeChunkExtractionWindow(
      { startSeconds: 3000, durationSeconds: 3000 },
      7000,
    );
    expect(window).toEqual({ startSeconds: 2985, durationSeconds: 3030 });
  });

  it('clamps the leading overlap at 0 for the first chunk (no leading fringe)', () => {
    const window = computeChunkExtractionWindow({ startSeconds: 0, durationSeconds: 3000 }, 7000);
    expect(window).toEqual({ startSeconds: 0, durationSeconds: 3015 });
  });

  it('clamps the trailing overlap at the real duration for the last chunk (no trailing fringe)', () => {
    const window = computeChunkExtractionWindow(
      { startSeconds: 6000, durationSeconds: 1000 },
      7000,
    );
    expect(window).toEqual({ startSeconds: 5985, durationSeconds: 1015 });
  });

  it('clamps both sides at once for a single chunk spanning the whole (short) video', () => {
    const window = computeChunkExtractionWindow({ startSeconds: 0, durationSeconds: 120 }, 120);
    expect(window).toEqual({ startSeconds: 0, durationSeconds: 120 });
  });
});
