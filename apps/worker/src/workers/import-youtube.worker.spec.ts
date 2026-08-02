import { VideoStatus } from '@speedora/database';
import { QueueName, TranscriptionProvider } from '@speedora/shared';
import { Worker } from 'bullmq';

// UnrecoverableError is left real (via requireActual) - only Worker itself
// is mocked, same "mock the seam, leave real classes/pure functions real"
// convention as the video-import-engine mock below.
jest.mock('bullmq', () => ({
  ...jest.requireActual('bullmq'),
  Worker: jest.fn(),
}));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const probeVideoQueueAdd = jest.fn();
jest.mock('../queues', () => ({
  probeVideoQueue: { add: (...args: unknown[]) => probeVideoQueueAdd(...args) },
}));

const uploadObjectMock = jest.fn();
jest.mock('@speedora/storage', () => ({
  uploadObject: (...args: unknown[]) => uploadObjectMock(...args),
}));

// Mocks only the "which engine" seam (per docs/testing.md's adapter-test
// convention) - VideoImportError, loadVideoImportEngineConfig, and the pure
// toSuccessMetricEvent/toFailureMetricEvent translators are left real via
// requireActual, same as an adapter test leaving a pure derive function real.
const resolveEngineMock = jest.fn();
jest.mock('@speedora/video-import-engine', () => ({
  ...jest.requireActual('@speedora/video-import-engine'),
  resolveEngine: (...args: unknown[]) => resolveEngineMock(...args),
}));

const recordVideoImportOutcomeMock = jest.fn();
jest.mock('@speedora/shared', () => ({
  ...jest.requireActual('@speedora/shared'),
  recordVideoImportOutcome: (...args: unknown[]) => recordVideoImportOutcomeMock(...args),
}));

const statMock = jest.fn();
jest.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => statMock(...args),
  mkdir: jest.fn(),
  unlink: jest.fn(),
}));

const cleanupTempFileMock = jest.fn();
jest.mock('../storage', () => ({
  cleanupTempFile: (...args: unknown[]) => cleanupTempFileMock(...args),
}));

const createReadStreamMock = jest.fn();
jest.mock('node:fs', () => ({
  createReadStream: (...args: unknown[]) => createReadStreamMock(...args),
}));

const videoUpdateMock = jest.fn();
const videoFindUniqueMock = jest.fn();
const videoStatusEventCreateMock = jest.fn();
const notificationCreateMock = jest.fn();
const notificationPreferenceFindUniqueMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: {
    video: {
      update: (...args: unknown[]) => videoUpdateMock(...args),
      findUnique: (...args: unknown[]) => videoFindUniqueMock(...args),
    },
    // Fase 3 (DB+JSON-contract roadmap) - updateVideoStatus() writes here
    // too, atomically alongside video.update() via $transaction.
    videoStatusEvent: { create: (...args: unknown[]) => videoStatusEventCreateMock(...args) },
    // Notification Center Sprint 4A/4B - updateVideoStatus()'s RENDER_FAILED
    // write on this stage's own failure path.
    notification: { create: (...args: unknown[]) => notificationCreateMock(...args) },
    notificationPreference: {
      findUnique: (...args: unknown[]) => notificationPreferenceFindUniqueMock(...args),
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

// Milestone 04c - see render-clip.worker.spec.ts's own comment on why this
// worker-local adapter (not @speedora/database itself) is mocked.
const publishNotificationMock = jest.fn();
jest.mock('../notificationPublisher', () => ({
  publishNotification: (...args: unknown[]) => publishNotificationMock(...args),
}));

import { createImportYoutubeWorker } from './import-youtube.worker';

type FakeJob = {
  data: { videoId: string; url: string; provider: TranscriptionProvider };
  attemptsMade: number;
  opts: { attempts?: number };
};

function getProcessor() {
  createImportYoutubeWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: FakeJob) => Promise<unknown>;
}

// Every existing (pre-Download-Reliability-Framework) test exercises a
// single-attempt job (attemptsMade: 0, opts.attempts: 1) - the retry/
// UnrecoverableError/health-gate tests below override these explicitly to
// exercise multi-attempt behavior.
function fakeJob(
  data: FakeJob['data'],
  overrides: Partial<Pick<FakeJob, 'attemptsMade' | 'opts'>> = {},
): FakeJob {
  return { data, attemptsMade: 0, opts: { attempts: 1 }, ...overrides };
}

function createFakeEngine(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    name: 'yt-dlp',
    fetchMetadata: jest.fn().mockResolvedValue({ title: 'My YouTube Video' }),
    download: jest.fn().mockResolvedValue({
      outputPath: '/tmp/youtube-import-abc.mp4',
      durationMs: 1234,
      retries: 0,
    }),
    checkVersion: jest
      .fn()
      .mockResolvedValue({ engineName: 'yt-dlp', engineVersion: '2025.06.30', status: 'healthy' }),
    ...overrides,
  };
}

describe('import-youtube worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveEngineMock.mockReturnValue(createFakeEngine());
    statMock.mockResolvedValue({ size: 123456 });
    createReadStreamMock.mockReturnValue('fake-read-stream');
    uploadObjectMock.mockResolvedValue(undefined);
    videoUpdateMock.mockResolvedValue({});
    notificationCreateMock.mockResolvedValue({ id: 'notif-1' });
    notificationPreferenceFindUniqueMock.mockResolvedValue(null);
    publishNotificationMock.mockResolvedValue(undefined);
    // Video exists and is IMPORTING by default - individual tests override
    // this to exercise the orphaned-job (deleted-video) and
    // already-past-IMPORTING skip paths.
    videoFindUniqueMock.mockResolvedValue({ status: VideoStatus.IMPORTING });
    videoStatusEventCreateMock.mockResolvedValue({});
    probeVideoQueueAdd.mockResolvedValue(undefined);
    cleanupTempFileMock.mockResolvedValue(undefined);
    recordVideoImportOutcomeMock.mockResolvedValue(undefined);
  });

  it('resolves an engine for the url, downloads, uploads to storage, marks UPLOADED, and enqueues probe-video on success', async () => {
    const processor = getProcessor();
    const result = await processor(
      fakeJob({
        videoId: 'video-1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        provider: TranscriptionProvider.OPENAI,
      }),
    );

    expect(resolveEngineMock).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      expect.any(Object),
    );
    const engine = resolveEngineMock.mock.results[0].value;
    expect(engine.download).toHaveBeenCalledWith(
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      expect.any(Object),
      expect.objectContaining({ onProgress: expect.any(Function), signal: expect.any(Object) }),
    );
    expect(createReadStreamMock).toHaveBeenCalledWith('/tmp/youtube-import-abc.mp4');
    expect(uploadObjectMock).toHaveBeenCalledWith(
      'videos/video-1.mp4',
      'fake-read-stream',
      'video/mp4',
    );
    // Reset to 0 before the download starts...
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { importProgress: 0 },
    });
    // ...and cleared back to null once UPLOADED.
    expect(statMock).toHaveBeenCalledWith('/tmp/youtube-import-abc.mp4');
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: {
        sourceUrl: 'videos/video-1.mp4',
        importProgress: null,
        title: 'My YouTube Video',
        sourceSizeBytes: 123456,
        status: VideoStatus.UPLOADED,
      },
    });
    expect(probeVideoQueueAdd).toHaveBeenCalledWith(QueueName.PROBE_VIDEO, {
      videoId: 'video-1',
      sourceUrl: 'videos/video-1.mp4',
    });
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/tmp/youtube-import-abc.mp4');
    expect(recordVideoImportOutcomeMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        outcome: 'success',
        engineName: 'yt-dlp',
        engineVersion: '2025.06.30',
        engineHealthStatus: 'healthy',
      }),
    );
    expect(result).toEqual({ videoId: 'video-1', sourceUrl: 'videos/video-1.mp4' });
  });

  it('reports each real download percentage from the engine to Video.importProgress', async () => {
    const engine = createFakeEngine();
    engine.download.mockImplementation(async (_input, _deps, options) => {
      options.onProgress(12.7);
      options.onProgress(88.4);
      return { outputPath: '/tmp/youtube-import-abc.mp4', durationMs: 1000, retries: 0 };
    });
    resolveEngineMock.mockReturnValue(engine);

    const processor = getProcessor();
    await processor(
      fakeJob({
        videoId: 'video-1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        provider: TranscriptionProvider.GROQ,
      }),
    );

    // Rounded to the nearest integer - Video.importProgress is an Int
    // column, the engine's own percentages are fractional.
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { importProgress: 13 },
    });
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { importProgress: 88 },
    });
  });

  it('skips an orphaned job for a video that was deleted while queued, without doing any work', async () => {
    videoFindUniqueMock.mockResolvedValue(null);

    const processor = getProcessor();
    const result = await processor(
      fakeJob({
        videoId: 'video-1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        provider: TranscriptionProvider.GROQ,
      }),
    );

    expect(result).toEqual({ videoId: 'video-1', sourceUrl: '' });
    expect(resolveEngineMock).not.toHaveBeenCalled();
    expect(uploadObjectMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalled();
    expect(probeVideoQueueAdd).not.toHaveBeenCalled();
  });

  it('skips a job for a video already past IMPORTING, to avoid a duplicate download', async () => {
    videoFindUniqueMock.mockResolvedValue({ status: VideoStatus.UPLOADED });

    const processor = getProcessor();
    const result = await processor(
      fakeJob({
        videoId: 'video-1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        provider: TranscriptionProvider.GROQ,
      }),
    );

    expect(result).toEqual({ videoId: 'video-1', sourceUrl: '' });
    expect(resolveEngineMock).not.toHaveBeenCalled();
    expect(uploadObjectMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalled();
    expect(probeVideoQueueAdd).not.toHaveBeenCalled();
  });

  it('marks the video FAILED, reports to Sentry, records failure metrics, and still cleans up the scratch file when the download fails', async () => {
    const { VideoImportError } = jest.requireActual('@speedora/video-import-engine');
    const error = new VideoImportError('yt-dlp exited with code 1', {
      category: 'network',
      engineName: 'yt-dlp',
      exitCode: 1,
    });
    const engine = createFakeEngine();
    engine.download.mockRejectedValue(error);
    resolveEngineMock.mockReturnValue(engine);

    const processor = getProcessor();

    await expect(
      processor(
        fakeJob({
          videoId: 'video-1',
          url: 'https://youtu.be/dQw4w9WgXcQ',
          provider: TranscriptionProvider.GROQ,
        }),
      ),
    ).rejects.toThrow('yt-dlp exited with code 1');

    expect(captureExceptionMock).toHaveBeenCalledWith(error, { tags: { videoId: 'video-1' } });
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.FAILED },
    });
    expect(probeVideoQueueAdd).not.toHaveBeenCalled();
    // download() never resolved, so there is no outputPath to clean up -
    // the engine itself already cleaned up its own per-attempt scratch file.
    expect(cleanupTempFileMock).not.toHaveBeenCalled();
    expect(recordVideoImportOutcomeMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ outcome: 'failure', category: 'network', engineName: 'yt-dlp' }),
    );
    // Milestone 04c - deps.publish wired through to updateVideoStatus.
    expect(publishNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RENDER_FAILED' }),
    );
  });

  it('rejects a non-allowlisted URL before ever calling any engine method, as an UnrecoverableError so BullMQ does not retry it', async () => {
    const { VideoImportError } = jest.requireActual('@speedora/video-import-engine');
    const { UnrecoverableError } = jest.requireActual('bullmq');
    const error = new VideoImportError('"vimeo.com" is not a supported import domain', {
      category: 'unsupported',
      engineName: 'yt-dlp',
      retryable: false,
    });
    resolveEngineMock.mockImplementation(() => {
      throw error;
    });

    const processor = getProcessor();
    // 2 attempts configured, but this category is non-retryable - the
    // thrown error must be an UnrecoverableError so BullMQ skips the
    // remaining attempt instead of scheduling a doomed retry.
    let caught: unknown;
    try {
      await processor(
        fakeJob(
          {
            videoId: 'video-1',
            url: 'https://vimeo.com/123',
            provider: TranscriptionProvider.GROQ,
          },
          { attemptsMade: 0, opts: { attempts: 2 } },
        ),
      );
    } catch (thrown) {
      caught = thrown;
    }

    expect(caught).toBeInstanceOf(UnrecoverableError);
    expect((caught as Error).message).toContain('not a supported import domain');
    // Still the terminal FAILED write despite 1 attempt remaining.
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.FAILED },
    });
    expect(uploadObjectMock).not.toHaveBeenCalled();
    expect(recordVideoImportOutcomeMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        outcome: 'failure',
        category: 'unsupported',
        engineName: 'yt-dlp',
      }),
    );
  });

  it('aborts the engine via AbortSignal when the job-level timeout fires', async () => {
    let capturedSignal: AbortSignal | undefined;
    const engine = createFakeEngine();
    engine.download.mockImplementation(
      async (_input: unknown, _deps: unknown, options: { signal: AbortSignal }) => {
        capturedSignal = options.signal;
        return new Promise(() => {
          // Never resolves - simulates a hung download so the outer
          // withJobTimeout wins the race.
        });
      },
    );
    resolveEngineMock.mockReturnValue(engine);

    jest.useFakeTimers();
    try {
      const processor = getProcessor();
      const resultPromise = processor(
        fakeJob({
          videoId: 'video-1',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          provider: TranscriptionProvider.GROQ,
        }),
      );

      // Let the orphan/idempotency-guard queries and resolveEngine/
      // fetchMetadata microtasks resolve before advancing timers.
      for (let i = 0; i < 15; i += 1) {
        await Promise.resolve();
      }

      jest.advanceTimersByTime(75 * 60 * 1000);
      await expect(resultPromise).rejects.toThrow('exceeded');
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('job-level retry (Download Reliability Framework)', () => {
    it('leaves Video.status at IMPORTING and does not notify on a non-final retryable failure, but still records metrics', async () => {
      const { VideoImportError } = jest.requireActual('@speedora/video-import-engine');
      const error = new VideoImportError('temporary network blip', {
        category: 'network',
        engineName: 'yt-dlp',
      });
      const engine = createFakeEngine();
      engine.download.mockRejectedValue(error);
      resolveEngineMock.mockReturnValue(engine);

      const processor = getProcessor();

      await expect(
        processor(
          fakeJob(
            {
              videoId: 'video-1',
              url: 'https://youtu.be/dQw4w9WgXcQ',
              provider: TranscriptionProvider.GROQ,
            },
            // 2 attempts remain after this one.
            { attemptsMade: 0, opts: { attempts: 3 } },
          ),
        ),
      ).rejects.toBe(error);

      // No FAILED write and no RENDER_FAILED notification on a non-final
      // attempt - Video.status stays IMPORTING so the idempotency guard
      // passes BullMQ's next attempt instead of skipping it.
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: VideoStatus.FAILED }) }),
      );
      expect(publishNotificationMock).not.toHaveBeenCalled();
      // Metrics are still recorded on every attempt, not just the final one.
      expect(recordVideoImportOutcomeMock).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ outcome: 'failure', category: 'network' }),
      );
    });

    it('writes FAILED and notifies on the final configured attempt', async () => {
      const { VideoImportError } = jest.requireActual('@speedora/video-import-engine');
      const error = new VideoImportError('still failing', {
        category: 'network',
        engineName: 'yt-dlp',
      });
      const engine = createFakeEngine();
      engine.download.mockRejectedValue(error);
      resolveEngineMock.mockReturnValue(engine);

      const processor = getProcessor();

      await expect(
        processor(
          fakeJob(
            {
              videoId: 'video-1',
              url: 'https://youtu.be/dQw4w9WgXcQ',
              provider: TranscriptionProvider.GROQ,
            },
            // This is attempt 2 of 2 - the final one.
            { attemptsMade: 1, opts: { attempts: 2 } },
          ),
        ),
      ).rejects.toBe(error);

      expect(videoUpdateMock).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: VideoStatus.FAILED },
      });
      expect(publishNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'RENDER_FAILED' }),
      );
    });
  });

  describe('health-check gate (Download Reliability Framework)', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('defers the job with a retryable internal error when the cached engine health is unreachable, without calling fetchMetadata or download', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2031, 0, 1));

      const engine = createFakeEngine({
        checkVersion: jest
          .fn()
          .mockResolvedValue({ engineName: 'yt-dlp', engineVersion: null, status: 'unreachable' }),
      });
      resolveEngineMock.mockReturnValue(engine);

      const processor = getProcessor();

      await expect(
        processor(
          fakeJob(
            {
              videoId: 'video-1',
              url: 'https://youtu.be/dQw4w9WgXcQ',
              provider: TranscriptionProvider.GROQ,
            },
            { attemptsMade: 0, opts: { attempts: 3 } },
          ),
        ),
      ).rejects.toMatchObject({ category: 'internal', retryable: true });

      expect(engine.fetchMetadata).not.toHaveBeenCalled();
      expect(engine.download).not.toHaveBeenCalled();
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: VideoStatus.FAILED }) }),
      );
    });

    it('reuses the cached health check across two jobs within the TTL (no extra preflight subprocess call)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2032, 0, 1));

      const engine = createFakeEngine();
      resolveEngineMock.mockReturnValue(engine);
      const processor = getProcessor();

      await processor(
        fakeJob({
          videoId: 'video-1',
          url: 'https://youtu.be/dQw4w9WgXcQ',
          provider: TranscriptionProvider.GROQ,
        }),
      );

      // job1 called checkVersion twice: once for the preflight gate (cache
      // miss) and once for the always-uncached post-download health read.
      // Clear the count and run a second job well within the 5-minute TTL -
      // only the post-download call should happen again.
      engine.checkVersion.mockClear();
      jest.setSystemTime(new Date(2032, 0, 1, 0, 1)); // +1 minute

      await processor(
        fakeJob({
          videoId: 'video-2',
          url: 'https://youtu.be/dQw4w9WgXcQ',
          provider: TranscriptionProvider.GROQ,
        }),
      );

      expect(engine.checkVersion).toHaveBeenCalledTimes(1);
    });

    it('re-checks health after the TTL expires', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2033, 0, 1));

      const engine = createFakeEngine();
      resolveEngineMock.mockReturnValue(engine);
      const processor = getProcessor();

      await processor(
        fakeJob({
          videoId: 'video-1',
          url: 'https://youtu.be/dQw4w9WgXcQ',
          provider: TranscriptionProvider.GROQ,
        }),
      );

      engine.checkVersion.mockClear();
      jest.setSystemTime(new Date(2033, 0, 1, 0, 6)); // +6 minutes, past the 5-minute TTL

      await processor(
        fakeJob({
          videoId: 'video-2',
          url: 'https://youtu.be/dQw4w9WgXcQ',
          provider: TranscriptionProvider.GROQ,
        }),
      );

      // Both the preflight gate (cache expired) and the post-download read
      // call checkVersion this time.
      expect(engine.checkVersion).toHaveBeenCalledTimes(2);
    });
  });
});
