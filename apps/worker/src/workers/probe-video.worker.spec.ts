import { VideoStatus } from '@speedora/database';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

// probe-video.worker.ts doesn't enqueue anything itself, but it transitively
// imports ../notificationDeliveryEnqueuer, which imports ../queues, which
// constructs real bullmq Queue instances at module scope - mocked here
// (rather than only mocking bullmq's Worker above) for the same reason
// detect-clips.worker.spec.ts/render-clip.worker.spec.ts already do: without
// this, `new Queue(...)` throws "Queue is not a constructor" against the
// bare `{ Worker: jest.fn() }` bullmq mock above.
jest.mock('../queues', () => ({
  notificationDeliveryQueue: { add: jest.fn() },
}));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const getObjectStreamMock = jest.fn();
jest.mock('@speedora/storage', () => ({
  getObjectStream: (...args: unknown[]) => getObjectStreamMock(...args),
}));

const reserveScratchPathMock = jest.fn().mockResolvedValue('/scratch/probe-src-0.mp4');
const cleanupTempFileMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../storage', () => ({
  reserveScratchPath: (...args: unknown[]) => reserveScratchPathMock(...args),
  cleanupTempFile: (...args: unknown[]) => cleanupTempFileMock(...args),
}));

const probeVideoMetadataMock = jest.fn();
jest.mock('../ffmpeg', () => ({
  probeVideoMetadata: (...args: unknown[]) => probeVideoMetadataMock(...args),
}));

// Left real (not mocked) - evaluateVideoQuality is a pure function with its
// own dedicated spec in packages/video-validation, same "adapter test
// leaves the pure derive function real" convention as
// render-clip.worker.spec.ts leaving @speedora/cutlist's pure functions
// unmocked.

const pipelineMock = jest.fn().mockResolvedValue(undefined);
jest.mock('node:stream/promises', () => ({
  pipeline: (...args: unknown[]) => pipelineMock(...args),
}));

jest.mock('node:fs', () => ({
  createWriteStream: jest.fn(() => ({ fake: 'writable' })),
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
    videoStatusEvent: { create: (...args: unknown[]) => videoStatusEventCreateMock(...args) },
    notification: { create: (...args: unknown[]) => notificationCreateMock(...args) },
    notificationPreference: {
      findUnique: (...args: unknown[]) => notificationPreferenceFindUniqueMock(...args),
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

const publishNotificationMock = jest.fn();
jest.mock('../notificationPublisher', () => ({
  publishNotification: (...args: unknown[]) => publishNotificationMock(...args),
}));

import { createProbeVideoWorker } from './probe-video.worker';

function getProcessor() {
  createProbeVideoWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: {
    data: { videoId: string; sourceUrl: string };
  }) => Promise<unknown>;
}

const VALID_METADATA = {
  durationSeconds: 120,
  hasVideoStream: true,
  hasAudioStream: true,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  videoBitrate: 4_000_000,
  audioCodec: 'aac',
  audioSampleRate: 48_000,
  audioChannels: 2,
  audioBitrate: 128_000,
};

describe('probe-video worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    videoUpdateMock.mockResolvedValue({ id: 'video-1', ownerId: 'owner-1', title: 'My video' });
    videoStatusEventCreateMock.mockResolvedValue({});
    notificationPreferenceFindUniqueMock.mockResolvedValue(null);
    notificationCreateMock.mockResolvedValue({});
    getObjectStreamMock.mockResolvedValue({});
    videoFindUniqueMock.mockResolvedValue({ status: VideoStatus.UPLOADED });
  });

  it('probes the source, persists metadata, and marks PENDING_SETTINGS on a clean result', async () => {
    probeVideoMetadataMock.mockResolvedValue(VALID_METADATA);

    const processor = getProcessor();
    const result = await processor({
      data: { videoId: 'video-1', sourceUrl: 'videos/video-1.mp4' },
    });

    expect(result).toEqual({ videoId: 'video-1' });
    expect(pipelineMock).toHaveBeenCalled();
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: {
        durationSeconds: 120,
        width: 1920,
        height: 1080,
        fps: 30,
        videoCodec: 'h264',
        videoBitrate: 4_000_000,
        audioCodec: 'aac',
        audioSampleRate: 48_000,
        audioChannels: 2,
        audioBitrate: 128_000,
        validationReport: { errors: [], warnings: [], info: [] },
        status: VideoStatus.PENDING_SETTINGS,
      },
    });
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/probe-src-0.mp4');
  });

  it('persists a real Warning-tier validationReport (low resolution, mono audio) without failing the job', async () => {
    probeVideoMetadataMock.mockResolvedValue({
      ...VALID_METADATA,
      width: 640,
      height: 360,
      audioChannels: 1,
    });

    const processor = getProcessor();
    const result = await processor({
      data: { videoId: 'video-1', sourceUrl: 'videos/video-1.mp4' },
    });

    expect(result).toEqual({ videoId: 'video-1' });
    expect(videoUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: VideoStatus.PENDING_SETTINGS,
          validationReport: {
            errors: [],
            warnings: expect.arrayContaining([
              expect.objectContaining({ id: 'low-resolution' }),
              expect.objectContaining({ id: 'mono-audio' }),
            ]),
            info: [],
          },
        }),
      }),
    );
  });

  it('marks the video FAILED when there is no video stream', async () => {
    probeVideoMetadataMock.mockResolvedValue({ ...VALID_METADATA, hasVideoStream: false });

    const processor = getProcessor();
    await expect(
      processor({ data: { videoId: 'video-1', sourceUrl: 'videos/video-1.mp4' } }),
    ).rejects.toThrow('video stream');

    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.FAILED },
    });
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it('marks the video FAILED when there is no audio stream', async () => {
    probeVideoMetadataMock.mockResolvedValue({ ...VALID_METADATA, hasAudioStream: false });

    const processor = getProcessor();
    await expect(
      processor({ data: { videoId: 'video-1', sourceUrl: 'videos/video-1.mp4' } }),
    ).rejects.toThrow('audio stream');

    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.FAILED },
    });
  });

  it('marks the video FAILED for a zero/unreadable duration', async () => {
    probeVideoMetadataMock.mockResolvedValue({ ...VALID_METADATA, durationSeconds: Number.NaN });

    const processor = getProcessor();
    await expect(
      processor({ data: { videoId: 'video-1', sourceUrl: 'videos/video-1.mp4' } }),
    ).rejects.toThrow('durasi');

    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.FAILED },
    });
  });

  it('marks the video FAILED when ffprobe itself throws (corrupted/unreadable file)', async () => {
    probeVideoMetadataMock.mockRejectedValue(new Error('ffprobe returned unparseable output'));

    const processor = getProcessor();
    await expect(
      processor({ data: { videoId: 'video-1', sourceUrl: 'videos/video-1.mp4' } }),
    ).rejects.toThrow('unparseable');

    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.FAILED },
    });
    expect(cleanupTempFileMock).toHaveBeenCalled();
  });

  it('skips an orphaned job for a deleted video', async () => {
    videoFindUniqueMock.mockResolvedValue(null);

    const processor = getProcessor();
    const result = await processor({
      data: { videoId: 'video-1', sourceUrl: 'videos/video-1.mp4' },
    });

    expect(result).toEqual({ videoId: 'video-1' });
    expect(probeVideoMetadataMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalled();
  });

  it('skips a video already past UPLOADED, to avoid a duplicate probe', async () => {
    videoFindUniqueMock.mockResolvedValue({ status: VideoStatus.PENDING_SETTINGS });

    const processor = getProcessor();
    const result = await processor({
      data: { videoId: 'video-1', sourceUrl: 'videos/video-1.mp4' },
    });

    expect(result).toEqual({ videoId: 'video-1' });
    expect(probeVideoMetadataMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalled();
  });

  it('reports the failure to Sentry tagged with videoId only', async () => {
    probeVideoMetadataMock.mockResolvedValue({ ...VALID_METADATA, hasVideoStream: false });

    const processor = getProcessor();
    await expect(
      processor({ data: { videoId: 'video-1', sourceUrl: 'videos/video-1.mp4' } }),
    ).rejects.toThrow();

    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      tags: { videoId: 'video-1' },
    });
  });
});
