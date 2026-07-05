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
jest.mock('../youtube', () => ({
  downloadYoutubeVideo: (...args: unknown[]) => downloadYoutubeVideoMock(...args),
}));

const reserveScratchPathMock = jest.fn();
const cleanupTempFileMock = jest.fn();
jest.mock('../storage', () => ({
  reserveScratchPath: (...args: unknown[]) => reserveScratchPathMock(...args),
  cleanupTempFile: (...args: unknown[]) => cleanupTempFileMock(...args),
}));

const readFileMock = jest.fn();
jest.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const videoUpdateMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: { video: { update: (...args: unknown[]) => videoUpdateMock(...args) } },
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
    readFileMock.mockResolvedValue(Buffer.from('fake video bytes'));
    uploadObjectMock.mockResolvedValue(undefined);
    videoUpdateMock.mockResolvedValue({});
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
    );
    expect(uploadObjectMock).toHaveBeenCalledWith(
      'videos/video-1.mp4',
      Buffer.from('fake video bytes'),
      'video/mp4',
    );
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { sourceUrl: 'videos/video-1.mp4', status: VideoStatus.UPLOADED },
    });
    expect(transcribeQueueAdd).toHaveBeenCalledWith(QueueName.TRANSCRIBE, {
      videoId: 'video-1',
      sourceUrl: 'videos/video-1.mp4',
      provider: TranscriptionProvider.OPENAI,
    });
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/tmp/youtube-import-abc.mp4');
    expect(result).toEqual({ videoId: 'video-1', sourceUrl: 'videos/video-1.mp4' });
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
  });
});
