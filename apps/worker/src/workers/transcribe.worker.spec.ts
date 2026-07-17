import { Prisma, VideoStatus } from '@speedora/database';
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
const uploadObjectMock = jest.fn().mockResolvedValue('etag');
jest.mock('@speedora/storage', () => ({
  getObjectStream: (...args: unknown[]) => getObjectStreamMock(...args),
  uploadObject: (...args: unknown[]) => uploadObjectMock(...args),
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
const extractThumbnailMock = jest.fn().mockResolvedValue(undefined);
const extractBlurPlaceholderMock = jest.fn().mockResolvedValue(undefined);
const extractAnimatedPreviewMock = jest.fn().mockResolvedValue(undefined);
const getMediaDurationSecondsMock = jest.fn();
jest.mock('../ffmpeg', () => ({
  extractAudio: (...args: unknown[]) => extractAudioMock(...args),
  extractThumbnail: (...args: unknown[]) => extractThumbnailMock(...args),
  extractBlurPlaceholder: (...args: unknown[]) => extractBlurPlaceholderMock(...args),
  extractAnimatedPreview: (...args: unknown[]) => extractAnimatedPreviewMock(...args),
  getMediaDurationSeconds: (...args: unknown[]) => getMediaDurationSecondsMock(...args),
}));

const diarizeSpeakersMock = jest.fn();
const assignSpeakerLabelsMock = jest.fn();
const toFriendlySpeakerTurnsMock = jest.fn();
jest.mock('../diarization', () => ({
  diarizeSpeakers: (...args: unknown[]) => diarizeSpeakersMock(...args),
  assignSpeakerLabels: (...args: unknown[]) => assignSpeakerLabelsMock(...args),
  toFriendlySpeakerTurns: (...args: unknown[]) => toFriendlySpeakerTurnsMock(...args),
}));

const detectVocalEmotionsMock = jest.fn();
jest.mock('../vocalEmotion', () => ({
  detectVocalEmotions: (...args: unknown[]) => detectVocalEmotionsMock(...args),
}));

// Only analyzeAudioLoudness/detectVoiceActivity (the subprocess-backed
// halves) are mocked - computeSpeakingRate/deriveVoiceActivityFeatures are
// pure/deterministic and run for real, same precedent as
// render-clip.worker.spec.ts leaving @speedora/cutlist's pure functions
// unmocked to verify real integration math.
const analyzeAudioLoudnessMock = jest.fn();
const detectVoiceActivityMock = jest.fn().mockResolvedValue([]);
jest.mock('@speedora/audio-intelligence', () => ({
  ...jest.requireActual('@speedora/audio-intelligence'),
  analyzeAudioLoudness: (...args: unknown[]) => analyzeAudioLoudnessMock(...args),
  detectVoiceActivity: (...args: unknown[]) => detectVoiceActivityMock(...args),
}));

jest.mock('../voiceActivityDeps', () => ({ voiceActivityDeps: {} }));

const createReadStreamMock = jest.fn((p: string) => ({ readStreamFor: p }));
jest.mock('node:fs', () => ({
  createReadStream: (...args: [string]) => createReadStreamMock(...args),
  createWriteStream: jest.fn(() => ({ fake: 'writable' })),
}));

const readFileMock = jest.fn().mockResolvedValue(Buffer.from('fake-blur-bytes'));
jest.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
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
const videoFindUniqueMock = jest.fn();
const videoStatusEventCreateMock = jest.fn();
const notificationCreateMock = jest.fn();
const notificationPreferenceFindUniqueMock = jest.fn();
const transactionMock = jest.fn((ops: Promise<unknown>[]) => Promise.all(ops));
jest.mock('../prisma', () => ({
  prisma: {
    transcriptSegment: {
      createMany: (...args: unknown[]) => transcriptSegmentCreateManyMock(...args),
    },
    video: {
      update: (...args: unknown[]) => videoUpdateMock(...args),
      findUnique: (...args: unknown[]) => videoFindUniqueMock(...args),
    },
    // Fase 3 (DB+JSON-contract roadmap) - written alongside video.update()
    // in the same $transaction (both the success-path inline transaction
    // and updateVideoStatus()'s own, for the FAILED case).
    videoStatusEvent: { create: (...args: unknown[]) => videoStatusEventCreateMock(...args) },
    // Notification Center Sprint 4A/4B - updateVideoStatus()'s RENDER_FAILED
    // write on this stage's own failure path.
    notification: { create: (...args: unknown[]) => notificationCreateMock(...args) },
    notificationPreference: {
      findUnique: (...args: unknown[]) => notificationPreferenceFindUniqueMock(...args),
    },
    $transaction: (...args: [Promise<unknown>[]]) => transactionMock(...args),
  },
}));

// Milestone 04c - see render-clip.worker.spec.ts's own comment on why this
// worker-local adapter (not @speedora/database itself) is mocked.
const publishNotificationMock = jest.fn();
jest.mock('../notificationPublisher', () => ({
  publishNotification: (...args: unknown[]) => publishNotificationMock(...args),
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
    // Video exists and is at its precondition status (UPLOADED) by default -
    // individual tests override this to exercise the orphaned-job
    // (deleted-video) and already-processed (idempotency) skip paths.
    videoFindUniqueMock.mockResolvedValue({ status: VideoStatus.UPLOADED });
    videoStatusEventCreateMock.mockResolvedValue({});
    notificationCreateMock.mockResolvedValue({ id: 'notif-1' });
    notificationPreferenceFindUniqueMock.mockResolvedValue(null);
    publishNotificationMock.mockResolvedValue(undefined);
    detectClipsQueueAdd.mockResolvedValue(undefined);
    // Short enough for a single Whisper request unless a test overrides it.
    getMediaDurationSecondsMock.mockResolvedValue(120);
    process.env.OPENAI_API_KEY = 'sk-test';
    // No speaker labels by default - individual tests override this to
    // exercise the diarization-succeeds path.
    diarizeSpeakersMock.mockResolvedValue([]);
    assignSpeakerLabelsMock.mockReturnValue([]);
    toFriendlySpeakerTurnsMock.mockReturnValue([]);
    // No emotion labels by default - individual tests override this to
    // exercise the emotion-detection-succeeds path.
    detectVocalEmotionsMock.mockResolvedValue([]);
    // No loudness readings by default (empty array -> every segment's
    // rmsDb/peakDb end up undefined via the adapter's `?? undefined`) -
    // individual tests can override this to exercise the analysis-succeeds
    // path.
    analyzeAudioLoudnessMock.mockResolvedValue({ segments: [] });
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
      '/scratch/transcribe-audio-10.mp3',
      undefined,
    );
    expect(extractAudioMock).toHaveBeenCalledWith(
      '/scratch/transcribe-src-0.mp4',
      '/scratch/diarize-audio-11.mp3',
    );
    expect(diarizeSpeakersMock).toHaveBeenCalledWith('/scratch/diarize-audio-11.mp3');
    expect(groqTranscriptionsCreateMock).toHaveBeenCalledWith({
      file: { readStreamFor: '/scratch/transcribe-audio-10.mp3' },
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });
    expect(openaiTranscriptionsCreateMock).not.toHaveBeenCalled();
    // All scratch files are cleaned up regardless of outcome.
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-src-0.mp4');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-audio-10.mp3');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/diarize-audio-11.mp3');

    const segments = [
      {
        start: 0,
        end: 2,
        text: 'hi',
        words: [{ start: 0, end: 0.8, word: 'hi' }],
        speakingRateWordsPerSecond: 0.5,
      },
      {
        start: 2,
        end: 4,
        text: 'there',
        words: [{ start: 2, end: 2.5, word: 'there' }],
        speakingRateWordsPerSecond: 0.5,
      },
    ];
    expect(transcriptSegmentCreateManyMock).toHaveBeenCalledWith({
      data: segments.map((s) => ({ videoId: 'video-1', ...s })),
    });
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: {
        status: VideoStatus.TRANSCRIBED,
        transcribeProgress: null,
        voiceActivitySegments: [],
        voiceActivityFeatures: {
          speechRatio: null,
          silenceRatio: null,
          silenceSegmentCount: null,
          longestSilenceSeconds: null,
        },
        diarizationFeatures: Prisma.JsonNull,
      },
    });
    expect(detectClipsQueueAdd).toHaveBeenCalledWith(QueueName.DETECT_CLIPS, {
      videoId: 'video-1',
      segments,
    });
    expect(result).toEqual({ videoId: 'video-1', segments });
  });

  it('extracts a thumbnail from the downloaded source, uploads it, and records the key', async () => {
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

    expect(extractThumbnailMock).toHaveBeenCalledWith(
      '/scratch/transcribe-src-0.mp4',
      '/scratch/thumbnail-1.webp',
      1,
    );
    expect(uploadObjectMock).toHaveBeenCalledWith(
      'thumbnails/video-1.webp',
      { readStreamFor: '/scratch/thumbnail-1.webp' },
      'image/webp',
    );
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/thumbnail-1.webp');
  });

  it('also extracts a tiny blur placeholder alongside the thumbnail and inlines it as a data URL', async () => {
    getObjectStreamMock.mockResolvedValue({});
    groqTranscriptionsCreateMock.mockResolvedValue({
      segments: [{ start: 0, end: 2, text: 'hi' }],
      words: [{ start: 0, end: 0.8, word: 'hi' }],
    });
    readFileMock.mockResolvedValue(Buffer.from('tiny-webp-bytes'));

    const processor = getProcessor();
    await processor({
      data: {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        provider: TranscriptionProvider.GROQ,
      },
    });

    expect(extractBlurPlaceholderMock).toHaveBeenCalledWith(
      '/scratch/transcribe-src-0.mp4',
      '/scratch/thumbnail-blur-2.webp',
      1,
    );
    expect(readFileMock).toHaveBeenCalledWith('/scratch/thumbnail-blur-2.webp');
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: {
        thumbnailUrl: 'thumbnails/video-1.webp',
        thumbnailBlurDataUrl: `data:image/webp;base64,${Buffer.from('tiny-webp-bytes').toString('base64')}`,
      },
    });
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/thumbnail-blur-2.webp');
  });

  it('keeps the real thumbnail even when only the blur placeholder extraction fails', async () => {
    getObjectStreamMock.mockResolvedValue({});
    groqTranscriptionsCreateMock.mockResolvedValue({
      segments: [{ start: 0, end: 2, text: 'hi' }],
      words: [{ start: 0, end: 0.8, word: 'hi' }],
    });
    extractBlurPlaceholderMock.mockRejectedValueOnce(new Error('ffmpeg exited with code 1'));

    const processor = getProcessor();
    await processor({
      data: {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        provider: TranscriptionProvider.GROQ,
      },
    });

    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { thumbnailUrl: 'thumbnails/video-1.webp', thumbnailBlurDataUrl: null },
    });
  });

  describe('storyboard extraction (Phase 3, Hover Preview/Storyboard roadmap)', () => {
    it('extracts 5 evenly-spaced frames and records the keys that succeeded', async () => {
      getObjectStreamMock.mockResolvedValue({});
      groqTranscriptionsCreateMock.mockResolvedValue({
        segments: [{ start: 0, end: 2, text: 'hi' }],
        words: [{ start: 0, end: 0.8, word: 'hi' }],
      });
      getMediaDurationSecondsMock.mockResolvedValue(100);

      const processor = getProcessor();
      await processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.GROQ,
        },
      });

      expect(extractThumbnailMock).toHaveBeenCalledWith(
        '/scratch/transcribe-src-0.mp4',
        '/scratch/storyboard-0-3.webp',
        10,
      );
      expect(extractThumbnailMock).toHaveBeenCalledWith(
        '/scratch/transcribe-src-0.mp4',
        '/scratch/storyboard-2-5.webp',
        50,
      );
      expect(extractThumbnailMock).toHaveBeenCalledWith(
        '/scratch/transcribe-src-0.mp4',
        '/scratch/storyboard-4-7.webp',
        90,
      );
      expect(uploadObjectMock).toHaveBeenCalledWith(
        'storyboards/video-1-0.webp',
        { readStreamFor: '/scratch/storyboard-0-3.webp' },
        'image/webp',
      );
      expect(videoUpdateMock).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: {
          storyboardFrameUrls: [
            'storyboards/video-1-0.webp',
            'storyboards/video-1-1.webp',
            'storyboards/video-1-2.webp',
            'storyboards/video-1-3.webp',
            'storyboards/video-1-4.webp',
          ],
        },
      });
      expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/storyboard-0-3.webp');
    });

    it('records only the frames that succeeded when some extractions fail, never fabricating a fixed count', async () => {
      getObjectStreamMock.mockResolvedValue({});
      groqTranscriptionsCreateMock.mockResolvedValue({
        segments: [{ start: 0, end: 2, text: 'hi' }],
        words: [{ start: 0, end: 0.8, word: 'hi' }],
      });
      getMediaDurationSecondsMock.mockResolvedValue(100);
      // Fails frame index 1 (the 2nd storyboard call) only.
      extractThumbnailMock.mockImplementation(async (input, output) => {
        if (output === '/scratch/storyboard-1-4.webp') {
          throw new Error('ffmpeg exited with code 1');
        }
      });

      const processor = getProcessor();
      await processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.GROQ,
        },
      });

      expect(videoUpdateMock).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: {
          storyboardFrameUrls: [
            'storyboards/video-1-0.webp',
            'storyboards/video-1-2.webp',
            'storyboards/video-1-3.webp',
            'storyboards/video-1-4.webp',
          ],
        },
      });
    });
  });

  describe('animated thumbnail extraction (Phase 3, Animated Thumbnail roadmap)', () => {
    it('extracts a short looping WebP and records the key', async () => {
      getObjectStreamMock.mockResolvedValue({});
      groqTranscriptionsCreateMock.mockResolvedValue({
        segments: [{ start: 0, end: 2, text: 'hi' }],
        words: [{ start: 0, end: 0.8, word: 'hi' }],
      });
      getMediaDurationSecondsMock.mockResolvedValue(100);

      const processor = getProcessor();
      await processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.GROQ,
        },
      });

      expect(extractAnimatedPreviewMock).toHaveBeenCalledWith(
        '/scratch/transcribe-src-0.mp4',
        '/scratch/animated-thumbnail-8.webp',
        1,
        { durationSeconds: 1.5, fps: 6, width: 480 },
      );
      expect(uploadObjectMock).toHaveBeenCalledWith(
        'animated-thumbnails/video-1.webp',
        { readStreamFor: '/scratch/animated-thumbnail-8.webp' },
        'image/webp',
      );
      expect(videoUpdateMock).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { animatedThumbnailUrl: 'animated-thumbnails/video-1.webp' },
      });
      expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/animated-thumbnail-8.webp');
    });

    it('never fails the transcribe job when animated thumbnail extraction fails, and never writes the field', async () => {
      getObjectStreamMock.mockResolvedValue({});
      groqTranscriptionsCreateMock.mockResolvedValue({
        segments: [{ start: 0, end: 2, text: 'hi' }],
        words: [{ start: 0, end: 0.8, word: 'hi' }],
      });
      getMediaDurationSecondsMock.mockResolvedValue(100);
      extractAnimatedPreviewMock.mockRejectedValueOnce(new Error('ffmpeg exited with code 1'));

      const processor = getProcessor();
      await processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.GROQ,
        },
      });

      expect(uploadObjectMock).not.toHaveBeenCalledWith(
        'animated-thumbnails/video-1.webp',
        expect.anything(),
        expect.anything(),
      );
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ animatedThumbnailUrl: expect.anything() }),
        }),
      );
      // Still transitions to TRANSCRIBED - an animated-thumbnail failure is invisible to the job's own outcome.
      expect(videoUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: VideoStatus.TRANSCRIBED }),
        }),
      );
    });
  });

  describe('hover preview extraction (Phase 3, Hover Preview roadmap)', () => {
    it('extracts a longer/smoother looping WebP and records the key', async () => {
      getObjectStreamMock.mockResolvedValue({});
      groqTranscriptionsCreateMock.mockResolvedValue({
        segments: [{ start: 0, end: 2, text: 'hi' }],
        words: [{ start: 0, end: 0.8, word: 'hi' }],
      });
      getMediaDurationSecondsMock.mockResolvedValue(100);

      const processor = getProcessor();
      await processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.GROQ,
        },
      });

      expect(extractAnimatedPreviewMock).toHaveBeenCalledWith(
        '/scratch/transcribe-src-0.mp4',
        '/scratch/hover-preview-9.webp',
        1,
        { durationSeconds: 3, fps: 12, width: 320 },
      );
      expect(uploadObjectMock).toHaveBeenCalledWith(
        'hover-previews/video-1.webp',
        { readStreamFor: '/scratch/hover-preview-9.webp' },
        'image/webp',
      );
      expect(videoUpdateMock).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { hoverPreviewUrl: 'hover-previews/video-1.webp' },
      });
      expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/hover-preview-9.webp');
    });

    it('never fails the transcribe job when hover preview extraction fails, and never writes the field', async () => {
      getObjectStreamMock.mockResolvedValue({});
      groqTranscriptionsCreateMock.mockResolvedValue({
        segments: [{ start: 0, end: 2, text: 'hi' }],
        words: [{ start: 0, end: 0.8, word: 'hi' }],
      });
      getMediaDurationSecondsMock.mockResolvedValue(100);
      // Fails only the hover-preview call, not the animated-thumbnail one
      // that runs right before it (same distinguish-by-output-path
      // technique as the storyboard tests, since both share one mock).
      extractAnimatedPreviewMock.mockImplementation(async (_input, output: string) => {
        if (output.includes('hover-preview')) {
          throw new Error('ffmpeg exited with code 1');
        }
      });

      const processor = getProcessor();
      await processor({
        data: {
          videoId: 'video-1',
          sourceUrl: 'videos/abc.mp4',
          provider: TranscriptionProvider.GROQ,
        },
      });

      expect(uploadObjectMock).not.toHaveBeenCalledWith(
        'hover-previews/video-1.webp',
        expect.anything(),
        expect.anything(),
      );
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hoverPreviewUrl: expect.anything() }),
        }),
      );
      // Still transitions to TRANSCRIBED - a hover-preview failure is invisible to the job's own outcome.
      expect(videoUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: VideoStatus.TRANSCRIBED }),
        }),
      );
    });
  });

  it('never fails the transcribe job when thumbnail extraction fails', async () => {
    getObjectStreamMock.mockResolvedValue({});
    groqTranscriptionsCreateMock.mockResolvedValue({
      segments: [{ start: 0, end: 2, text: 'hi' }],
      words: [{ start: 0, end: 0.8, word: 'hi' }],
    });
    extractThumbnailMock.mockRejectedValueOnce(new Error('ffmpeg exited with code 1'));

    const processor = getProcessor();
    const result = await processor({
      data: {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        provider: TranscriptionProvider.GROQ,
      },
    });

    expect(result).toEqual({
      videoId: 'video-1',
      segments: [
        {
          start: 0,
          end: 2,
          text: 'hi',
          words: [{ start: 0, end: 0.8, word: 'hi' }],
          speakingRateWordsPerSecond: 0.5,
        },
      ],
    });
    expect(uploadObjectMock).not.toHaveBeenCalledWith(
      'thumbnails/video-1.webp',
      expect.anything(),
      'image/webp',
    );
    expect(videoUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ thumbnailUrl: expect.anything() }),
      }),
    );
    // Storyboard extraction is a fully independent best-effort block - a
    // thumbnail failure (mockRejectedValueOnce only rejects that one call)
    // doesn't block it, same reasoning as the blur placeholder's own
    // independence within the thumbnail block.
    expect(uploadObjectMock).toHaveBeenCalledWith(
      'storyboards/video-1-0.webp',
      expect.anything(),
      'image/webp',
    );
    // Still transitions to TRANSCRIBED - a thumbnail failure is invisible to the job's own outcome.
    expect(videoUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: VideoStatus.TRANSCRIBED }),
      }),
    );
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
          speakingRateWordsPerSecond: 1,
        },
        {
          videoId: 'video-1',
          start: 5,
          end: 7,
          text: 'unrelated',
          words: [],
          speakingRateWordsPerSecond: 0,
        },
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
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-audio-10.mp3');
    // Milestone 04c - deps.publish wired through to updateVideoStatus.
    expect(publishNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RENDER_FAILED' }),
    );
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
      '/scratch/transcribe-audio-10.mp3',
      {
        startSeconds: 0,
        durationSeconds: 3015,
      },
    );
    expect(extractAudioMock).toHaveBeenNthCalledWith(
      2,
      '/scratch/transcribe-src-0.mp4',
      '/scratch/transcribe-audio-11.mp3',
      {
        startSeconds: 2985,
        durationSeconds: 3030,
      },
    );
    expect(extractAudioMock).toHaveBeenNthCalledWith(
      3,
      '/scratch/transcribe-src-0.mp4',
      '/scratch/transcribe-audio-12.mp3',
      {
        startSeconds: 5985,
        durationSeconds: 1015,
      },
    );
    expect(extractAudioMock).toHaveBeenNthCalledWith(
      4,
      '/scratch/transcribe-src-0.mp4',
      '/scratch/diarize-audio-13.mp3',
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
          speakingRateWordsPerSecond: 0.5,
        },
        {
          videoId: 'video-1',
          start: 3001,
          end: 3003,
          text: 'b',
          words: [{ start: 3001, end: 3002, word: 'b' }],
          speakingRateWordsPerSecond: 0.5,
        },
        {
          videoId: 'video-1',
          start: 6000,
          end: 6001,
          text: 'c',
          words: [{ start: 6000, end: 6000.5, word: 'c' }],
          speakingRateWordsPerSecond: 1,
        },
      ],
    });

    // Source, all three chunk audio files, and the diarization audio file
    // are all cleaned up.
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-src-0.mp4');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-audio-10.mp3');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-audio-11.mp3');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/transcribe-audio-12.mp3');
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/diarize-audio-13.mp3');
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
      file: { readStreamFor: '/scratch/transcribe-audio-10.mp3' },
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });
    expect(groqTranscriptionsCreateMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: {
        status: VideoStatus.TRANSCRIBED,
        transcribeProgress: null,
        voiceActivitySegments: [],
        voiceActivityFeatures: {
          speechRatio: null,
          silenceRatio: null,
          silenceSegmentCount: null,
          longestSilenceSeconds: null,
        },
        diarizationFeatures: Prisma.JsonNull,
      },
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

  it('skips an orphaned job for a video that was deleted while queued, without doing any work', async () => {
    videoFindUniqueMock.mockResolvedValue(null);

    const processor = getProcessor();
    const result = await processor({
      data: {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        provider: TranscriptionProvider.GROQ,
      },
    });

    expect(result).toEqual({ videoId: 'video-1', segments: [] });
    // No Whisper call, no download, no progress/status writes, no
    // downstream enqueue - the job is a pure no-op once the video is gone.
    expect(getObjectStreamMock).not.toHaveBeenCalled();
    expect(groqTranscriptionsCreateMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalled();
    expect(detectClipsQueueAdd).not.toHaveBeenCalled();
  });

  it('skips a job for a video already past UPLOADED, without a duplicate Whisper API call (BullMQ stalled-job re-processing guard)', async () => {
    videoFindUniqueMock.mockResolvedValue({ status: VideoStatus.TRANSCRIBED });

    const processor = getProcessor();
    const result = await processor({
      data: {
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        provider: TranscriptionProvider.GROQ,
      },
    });

    expect(result).toEqual({ videoId: 'video-1', segments: [] });
    expect(getObjectStreamMock).not.toHaveBeenCalled();
    expect(groqTranscriptionsCreateMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalled();
    expect(detectClipsQueueAdd).not.toHaveBeenCalled();
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

      expect(diarizeSpeakersMock).toHaveBeenCalledWith('/scratch/diarize-audio-11.mp3');
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
            speakingRateWordsPerSecond: 0.5,
          },
          {
            videoId: 'video-1',
            start: 2,
            end: 4,
            text: 'there',
            speaker: 'Speaker B',
            words: [{ start: 2, end: 2.5, word: 'there' }],
            speakingRateWordsPerSecond: 0.5,
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
        segments: [
          {
            start: 0,
            end: 2,
            text: 'hi',
            words: [{ start: 0, end: 0.8, word: 'hi' }],
            speakingRateWordsPerSecond: 0.5,
          },
        ],
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
      expect(detectVocalEmotionsMock).toHaveBeenCalledWith('/scratch/diarize-audio-11.mp3', [
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
            speakingRateWordsPerSecond: 0.5,
          },
          {
            videoId: 'video-1',
            start: 2,
            end: 4,
            text: 'there',
            emotion: undefined,
            words: [{ start: 2, end: 2.5, word: 'there' }],
            speakingRateWordsPerSecond: 0.5,
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
        segments: [
          {
            start: 0,
            end: 2,
            text: 'hi',
            words: [{ start: 0, end: 0.8, word: 'hi' }],
            speakingRateWordsPerSecond: 0.5,
          },
        ],
      });
    });
  });

  describe('Audio Intelligence (Fase 25)', () => {
    it("analyzes loudness reusing the SAME diarize-audio file, and persists each segment's reading", async () => {
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
      analyzeAudioLoudnessMock.mockResolvedValue({
        segments: [
          { rmsDb: -20, peakDb: -3 },
          { rmsDb: -14.5, peakDb: -1.2 },
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

      // Same diarize-audio-2.mp3 file diarization/emotion detection already
      // use - no third full-track extraction just for loudness.
      expect(analyzeAudioLoudnessMock).toHaveBeenCalledWith(
        {
          audioPath: '/scratch/diarize-audio-11.mp3',
          segments: [
            { start: 0, end: 2, text: 'hi' },
            { start: 2, end: 4, text: 'there' },
          ],
        },
        expect.objectContaining({ ffmpegPath: expect.any(String) }),
      );
      expect(transcriptSegmentCreateManyMock).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ rmsDb: -20, peakDb: -3 }),
          expect.objectContaining({ rmsDb: -14.5, peakDb: -1.2 }),
        ],
      });
    });

    it('continues without loudness data (does not fail the job) when analysis throws', async () => {
      getObjectStreamMock.mockResolvedValue({});
      groqTranscriptionsCreateMock.mockResolvedValue({
        segments: [{ start: 0, end: 2, text: 'hi' }],
        words: [{ start: 0, end: 0.8, word: 'hi' }],
      });
      analyzeAudioLoudnessMock.mockRejectedValue(new Error('ffmpeg not found'));

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
        segments: [
          {
            start: 0,
            end: 2,
            text: 'hi',
            words: [{ start: 0, end: 0.8, word: 'hi' }],
            speakingRateWordsPerSecond: 0.5,
          },
        ],
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
