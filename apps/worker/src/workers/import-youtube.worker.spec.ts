import { VideoStatus } from '@speedora/database';
import { QueueName, TranscriptionProvider } from '@speedora/shared';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const transcribeQueueAdd = jest.fn();
jest.mock('../queues', () => ({
  transcribeQueue: { add: (...args: unknown[]) => transcribeQueueAdd(...args) },
}));

const uploadObjectMock = jest.fn();
jest.mock('@speedora/storage', () => ({
  uploadObject: (...args: unknown[]) => uploadObjectMock(...args),
}));

const downloadYoutubeVideoMock = jest.fn();
const getYoutubeVideoTitleMock = jest.fn();
jest.mock('../youtube', () => ({
  downloadYoutubeVideo: (...args: unknown[]) => downloadYoutubeVideoMock(...args),
  getYoutubeVideoTitle: (...args: unknown[]) => getYoutubeVideoTitleMock(...args),
}));

const statMock = jest.fn();
jest.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => statMock(...args),
}));

const reserveScratchPathMock = jest.fn();
const cleanupTempFileMock = jest.fn();
jest.mock('../storage', () => ({
  reserveScratchPath: (...args: unknown[]) => reserveScratchPathMock(...args),
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

function getProcessor() {
  createImportYoutubeWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: {
    data: { videoId: string; url: string; provider: TranscriptionProvider };
  }) => Promise<unknown>;
}

describe('import-youtube worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reserveScratchPathMock.mockResolvedValue('/tmp/youtube-import-abc.mp4');
    downloadYoutubeVideoMock.mockResolvedValue(undefined);
    getYoutubeVideoTitleMock.mockResolvedValue('My YouTube Video');
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
    transcribeQueueAdd.mockResolvedValue(undefined);
    cleanupTempFileMock.mockResolvedValue(undefined);
  });

  it('downloads, uploads to storage, marks UPLOADED, and enqueues transcribe (forwarding provider) on success', async () => {
    const processor = getProcessor();
    const result = await processor({
      data: {
        videoId: 'video-1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        provider: TranscriptionProvider.OPENAI,
      },
    });

    expect(downloadYoutubeVideoMock).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      '/tmp/youtube-import-abc.mp4',
      expect.any(Function),
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
    // ...and cleared back to null once UPLOADED, same "irrelevant past this
    // stage" convention as transcribeProgress. title/sourceSizeBytes (Sprint
    // 1-2, Dashboard Redesign) are written in the same update.
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
    expect(transcribeQueueAdd).toHaveBeenCalledWith(QueueName.TRANSCRIBE, {
      videoId: 'video-1',
      sourceUrl: 'videos/video-1.mp4',
      provider: TranscriptionProvider.OPENAI,
    });
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/tmp/youtube-import-abc.mp4');
    expect(result).toEqual({ videoId: 'video-1', sourceUrl: 'videos/video-1.mp4' });
  });

  it('reports each real download percentage from yt-dlp to Video.importProgress', async () => {
    downloadYoutubeVideoMock.mockImplementation(
      async (_url: string, _path: string, onProgress: (percent: number) => void) => {
        onProgress(12.7);
        onProgress(88.4);
      },
    );

    const processor = getProcessor();
    await processor({
      data: {
        videoId: 'video-1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        provider: TranscriptionProvider.GROQ,
      },
    });

    // Rounded to the nearest integer - Video.importProgress is an Int
    // column, yt-dlp's own percentages are fractional.
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
    const result = await processor({
      data: {
        videoId: 'video-1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        provider: TranscriptionProvider.GROQ,
      },
    });

    expect(result).toEqual({ videoId: 'video-1', sourceUrl: '' });
    // No download, no upload, no progress/status writes, no downstream
    // enqueue - the job is a pure no-op once the video is gone.
    expect(downloadYoutubeVideoMock).not.toHaveBeenCalled();
    expect(uploadObjectMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalled();
    expect(transcribeQueueAdd).not.toHaveBeenCalled();
  });

  it('skips a job for a video already past IMPORTING, to avoid a duplicate yt-dlp download', async () => {
    videoFindUniqueMock.mockResolvedValue({ status: VideoStatus.UPLOADED });

    const processor = getProcessor();
    const result = await processor({
      data: {
        videoId: 'video-1',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        provider: TranscriptionProvider.GROQ,
      },
    });

    expect(result).toEqual({ videoId: 'video-1', sourceUrl: '' });
    expect(downloadYoutubeVideoMock).not.toHaveBeenCalled();
    expect(uploadObjectMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalled();
    expect(transcribeQueueAdd).not.toHaveBeenCalled();
  });

  it('marks the video FAILED, reports to Sentry, and still cleans up the scratch file when the download fails', async () => {
    const error = new Error('yt-dlp exited with code 1');
    downloadYoutubeVideoMock.mockRejectedValue(error);

    const processor = getProcessor();

    await expect(
      processor({
        data: {
          videoId: 'video-1',
          url: 'https://youtu.be/dQw4w9WgXcQ',
          provider: TranscriptionProvider.GROQ,
        },
      }),
    ).rejects.toThrow('yt-dlp exited with code 1');

    expect(captureExceptionMock).toHaveBeenCalledWith(error, { tags: { videoId: 'video-1' } });
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.FAILED },
    });
    expect(transcribeQueueAdd).not.toHaveBeenCalled();
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/tmp/youtube-import-abc.mp4');
    // Milestone 04c - deps.publish wired through to updateVideoStatus.
    expect(publishNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RENDER_FAILED' }),
    );
  });
});
