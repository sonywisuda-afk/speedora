import { VideoStatus } from '@viral-clip-app/database';
import { QueueName } from '@viral-clip-app/shared';
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
jest.mock('@viral-clip-app/storage', () => ({
  getObjectStream: (...args: unknown[]) => getObjectStreamMock(...args),
}));

const toFileMock = jest.fn();
jest.mock('openai', () => ({ toFile: (...args: unknown[]) => toFileMock(...args) }));

const transcriptionsCreateMock = jest.fn();
jest.mock('../openai', () => ({
  openai: {
    audio: {
      transcriptions: { create: (...args: unknown[]) => transcriptionsCreateMock(...args) },
    },
  },
}));

const transcriptSegmentCreateManyMock = jest.fn();
const videoUpdateMock = jest.fn();
const transactionMock = jest.fn((ops: Promise<unknown>[]) => Promise.all(ops));
jest.mock('../prisma', () => ({
  prisma: {
    transcriptSegment: {
      createMany: (...args: unknown[]) => transcriptSegmentCreateManyMock(...args),
    },
    video: { update: (...args: unknown[]) => videoUpdateMock(...args) },
    $transaction: (...args: [Promise<unknown>[]]) => transactionMock(...args),
  },
}));

import { createTranscribeWorker } from './transcribe.worker';

function getProcessor() {
  createTranscribeWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: {
    data: { videoId: string; sourceUrl: string };
  }) => Promise<unknown>;
}

describe('transcribe worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transactionMock.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    transcriptSegmentCreateManyMock.mockResolvedValue({ count: 2 });
    videoUpdateMock.mockResolvedValue({});
    detectClipsQueueAdd.mockResolvedValue(undefined);
  });

  it('transcribes the source video and enqueues detect-clips on success', async () => {
    const fakeStream = { fake: 'stream' };
    getObjectStreamMock.mockResolvedValue(fakeStream);
    const fakeFile = { fake: 'file' };
    toFileMock.mockResolvedValue(fakeFile);
    transcriptionsCreateMock.mockResolvedValue({
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
      data: { videoId: 'video-1', sourceUrl: 'videos/abc.mp4' },
    });

    expect(getObjectStreamMock).toHaveBeenCalledWith('videos/abc.mp4');
    expect(toFileMock).toHaveBeenCalledWith(fakeStream, 'abc.mp4');
    expect(transcriptionsCreateMock).toHaveBeenCalledWith({
      file: fakeFile,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });

    const segments = [
      { start: 0, end: 2, text: 'hi', words: [{ start: 0, end: 0.8, word: 'hi' }] },
      { start: 2, end: 4, text: 'there', words: [{ start: 2, end: 2.5, word: 'there' }] },
    ];
    expect(transcriptSegmentCreateManyMock).toHaveBeenCalledWith({
      data: segments.map((s) => ({ videoId: 'video-1', ...s })),
    });
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.TRANSCRIBED },
    });
    expect(detectClipsQueueAdd).toHaveBeenCalledWith(QueueName.DETECT_CLIPS, {
      videoId: 'video-1',
      segments,
    });
    expect(result).toEqual({ videoId: 'video-1', segments });
  });

  it('buckets each word into the segment whose range contains its start time', async () => {
    getObjectStreamMock.mockResolvedValue({});
    toFileMock.mockResolvedValue({});
    transcriptionsCreateMock.mockResolvedValue({
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
    await processor({ data: { videoId: 'video-1', sourceUrl: 'videos/abc.mp4' } });

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
    toFileMock.mockResolvedValue({});
    transcriptionsCreateMock.mockRejectedValue(new Error('whisper is down'));

    const processor = getProcessor();

    await expect(
      processor({ data: { videoId: 'video-1', sourceUrl: 'videos/abc.mp4' } }),
    ).rejects.toThrow('whisper is down');

    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.FAILED },
    });
    expect(detectClipsQueueAdd).not.toHaveBeenCalled();
  });

  it('reports the failure to Sentry tagged with videoId only (no transcript content)', async () => {
    getObjectStreamMock.mockResolvedValue({});
    toFileMock.mockResolvedValue({});
    const error = new Error('whisper is down');
    transcriptionsCreateMock.mockRejectedValue(error);

    const processor = getProcessor();

    await expect(
      processor({ data: { videoId: 'video-1', sourceUrl: 'videos/abc.mp4' } }),
    ).rejects.toThrow('whisper is down');

    expect(captureExceptionMock).toHaveBeenCalledWith(error, { tags: { videoId: 'video-1' } });
  });
});
