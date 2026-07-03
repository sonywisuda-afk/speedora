import { VideoStatus } from '@viral-clip-app/database';
import { QueueName, type TranscriptSegment } from '@viral-clip-app/shared';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const renderClipQueueAdd = jest.fn();
jest.mock('../queues', () => ({
  detectClipsQueue: { add: jest.fn() },
  renderClipQueue: { add: (...args: unknown[]) => renderClipQueueAdd(...args) },
}));

const chatCompletionsCreateMock = jest.fn();
jest.mock('../openai', () => ({
  openai: {
    chat: { completions: { create: (...args: unknown[]) => chatCompletionsCreateMock(...args) } },
  },
}));

let clipIdCounter = 0;
const clipCreateMock = jest.fn((args: { data: Record<string, unknown> }) => {
  clipIdCounter += 1;
  return Promise.resolve({ id: `clip-${clipIdCounter}`, ...args.data });
});
const videoUpdateMock = jest.fn();
const videoFindUniqueOrThrowMock = jest.fn();
const transactionMock = jest.fn((ops: Promise<unknown>[]) => Promise.all(ops));
jest.mock('../prisma', () => ({
  prisma: {
    clip: { create: (...args: [{ data: Record<string, unknown> }]) => clipCreateMock(...args) },
    video: {
      update: (...args: unknown[]) => videoUpdateMock(...args),
      findUniqueOrThrow: (...args: unknown[]) => videoFindUniqueOrThrowMock(...args),
    },
    $transaction: (...args: [Promise<unknown>[]]) => transactionMock(...args),
  },
}));

import { createDetectClipsWorker } from './detect-clips.worker';

function getProcessor() {
  createDetectClipsWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: {
    data: { videoId: string; segments: TranscriptSegment[] };
  }) => Promise<unknown>;
}

function completionWith(candidates: unknown[]) {
  return { choices: [{ message: { content: JSON.stringify({ candidates }) } }] };
}

describe('detect-clips worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clipIdCounter = 0;
    transactionMock.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    videoUpdateMock.mockResolvedValue({});
    renderClipQueueAdd.mockResolvedValue(undefined);
  });

  it('returns no candidates and skips the LLM call when there are no transcript segments', async () => {
    const processor = getProcessor();

    const result = await processor({ data: { videoId: 'video-1', segments: [] } });

    expect(chatCompletionsCreateMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.CLIPS_DETECTED },
    });
    expect(renderClipQueueAdd).not.toHaveBeenCalled();
    expect(result).toEqual({ videoId: 'video-1', candidates: [] });
  });

  it('filters out-of-range candidates, clamps score, sorts by score, and caps at 3', async () => {
    const segments: TranscriptSegment[] = [
      { start: 0, end: 5, text: 'intro' },
      { start: 5, end: 60, text: 'main content' },
    ];
    chatCompletionsCreateMock.mockResolvedValue(
      completionWith([
        { startTime: 10, endTime: 20, viralityScore: 150, hookText: 'a', hashtags: [] }, // clamped to 100
        { startTime: 20, endTime: 30, viralityScore: 40, hookText: 'b', hashtags: [] },
        { startTime: 30, endTime: 25, viralityScore: 90, hookText: 'c', hashtags: [] }, // invalid: end <= start, dropped
        { startTime: -5, endTime: 5, viralityScore: 80, hookText: 'd', hashtags: [] }, // out of range, dropped
        { startTime: 35, endTime: 45, viralityScore: 70, hookText: 'e', hashtags: [] },
        { startTime: 45, endTime: 55, viralityScore: 60, hookText: 'f', hashtags: [] }, // 4th valid candidate, should be cut by MAX_CANDIDATES
      ]),
    );
    videoFindUniqueOrThrowMock.mockResolvedValue({ id: 'video-1', sourceUrl: 'videos/abc.mp4' });

    const processor = getProcessor();
    const result = (await processor({ data: { videoId: 'video-1', segments } })) as {
      candidates: Array<{ viralityScore: number }>;
    };

    expect(chatCompletionsCreateMock).toHaveBeenCalledTimes(1);
    expect(result.candidates).toHaveLength(3);
    // 4 candidates survive the range/order filter (10-20:150->100, 20-30:40,
    // 35-45:70, 45-55:60); sorted desc and capped at MAX_CANDIDATES=3 drops
    // the lowest score (40).
    expect(result.candidates.map((c) => c.viralityScore)).toEqual([100, 70, 60]);
    expect(renderClipQueueAdd).toHaveBeenCalledTimes(3);
  });

  it('enqueues render-clip with the video source URL and the overlapping transcript slice', async () => {
    const segments: TranscriptSegment[] = [
      { start: 0, end: 5, text: 'before clip' },
      { start: 10, end: 15, text: 'inside clip' },
      { start: 25, end: 30, text: 'after clip' },
    ];
    chatCompletionsCreateMock.mockResolvedValue(
      completionWith([
        { startTime: 8, endTime: 20, viralityScore: 90, hookText: 'hook', hashtags: ['tag'] },
      ]),
    );
    videoFindUniqueOrThrowMock.mockResolvedValue({ id: 'video-1', sourceUrl: 'videos/abc.mp4' });

    const processor = getProcessor();
    await processor({ data: { videoId: 'video-1', segments } });

    expect(renderClipQueueAdd).toHaveBeenCalledWith(
      QueueName.RENDER_CLIP,
      expect.objectContaining({
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        startTime: 8,
        endTime: 20,
        transcript: [{ start: 10, end: 15, text: 'inside clip' }],
      }),
    );
  });

  it('trims hookText and sanitizes hashtags (stray "#" and blanks) before persisting', async () => {
    const segments: TranscriptSegment[] = [{ start: 0, end: 10, text: 'hi' }];
    chatCompletionsCreateMock.mockResolvedValue(
      completionWith([
        {
          startTime: 0,
          endTime: 5,
          viralityScore: 80,
          hookText: '  You wont believe this  ',
          hashtags: ['#viral', ' fyp ', '#foryou', '', '  '],
        },
      ]),
    );
    videoFindUniqueOrThrowMock.mockResolvedValue({ id: 'video-1', sourceUrl: 'videos/abc.mp4' });

    const processor = getProcessor();
    const result = (await processor({ data: { videoId: 'video-1', segments } })) as {
      candidates: Array<{ hookText: string; hashtags: string[] }>;
    };

    expect(clipCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        hookText: 'You wont believe this',
        hashtags: ['viral', 'fyp', 'foryou'],
      }),
    });
    expect(result.candidates[0].hookText).toBe('You wont believe this');
    expect(result.candidates[0].hashtags).toEqual(['viral', 'fyp', 'foryou']);
  });

  it('marks the video FAILED and rethrows when the LLM call fails', async () => {
    chatCompletionsCreateMock.mockRejectedValue(new Error('openai is down'));

    const processor = getProcessor();

    await expect(
      processor({
        data: { videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] },
      }),
    ).rejects.toThrow('openai is down');

    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.FAILED },
    });
    expect(renderClipQueueAdd).not.toHaveBeenCalled();
  });

  it('reports the failure to Sentry tagged with videoId only (no transcript content)', async () => {
    const error = new Error('openai is down');
    chatCompletionsCreateMock.mockRejectedValue(error);

    const processor = getProcessor();

    await expect(
      processor({
        data: { videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] },
      }),
    ).rejects.toThrow('openai is down');

    expect(captureExceptionMock).toHaveBeenCalledWith(error, { tags: { videoId: 'video-1' } });
  });
});
