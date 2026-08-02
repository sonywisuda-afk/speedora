import { VideoStatus } from '@speedora/database';
import {
  QueueName,
  RENDER_CLIP_RETRY_OPTIONS,
  type GenerateMoreClipsJobData,
} from '@speedora/shared';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));
jest.mock('../openai', () => ({ openai: {} }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const renderClipQueueAdd = jest.fn();
jest.mock('../queues', () => ({
  renderClipQueue: { add: (...args: unknown[]) => renderClipQueueAdd(...args) },
}));

// Same reasoning as detect-clips.worker.spec.ts's own comment: the adapter's
// only job is calling the stateless @speedora/clip-scoring module and then
// persisting/orchestrating the result, so the module is mocked directly here
// rather than faking an LLM response.
const scoreClipCandidatesMock = jest.fn();
const filterOverlappingCandidatesMock = jest.fn();
jest.mock('@speedora/clip-scoring', () => ({
  scoreClipCandidates: (...args: unknown[]) => scoreClipCandidatesMock(...args),
  filterOverlappingCandidates: (...args: unknown[]) => filterOverlappingCandidatesMock(...args),
}));

let clipIdCounter = 0;
const clipCreateMock = jest.fn((args: { data: Record<string, unknown> }) => {
  clipIdCounter += 1;
  return Promise.resolve({
    id: `clip-${clipIdCounter}`,
    captionStyle: 'DEFAULT',
    applyBrandKit: true,
    watermarkEnabled: true,
    introEnabled: true,
    outroEnabled: true,
    ...args.data,
  });
});
const videoUpdateMock = jest.fn();
const videoFindUniqueOrThrowMock = jest.fn();
const videoFindUniqueMock = jest.fn();
const userFindUniqueOrThrowMock = jest.fn();
const workspaceFindUniqueOrThrowMock = jest.fn();
const brandKitTemplateFindUniqueMock = jest.fn();
const transcriptSegmentFindManyMock = jest.fn();
const clipFindManyMock = jest.fn();
const notificationCreateMock = jest.fn();
const notificationPreferenceFindUniqueMock = jest.fn();
const transactionMock = jest.fn((ops: Promise<unknown>[]) => Promise.all(ops));
jest.mock('../prisma', () => ({
  prisma: {
    clip: {
      create: (...args: [{ data: Record<string, unknown> }]) => clipCreateMock(...args),
      findMany: (...args: unknown[]) => clipFindManyMock(...args),
    },
    video: {
      update: (...args: unknown[]) => videoUpdateMock(...args),
      findUniqueOrThrow: (...args: unknown[]) => videoFindUniqueOrThrowMock(...args),
      findUnique: (...args: unknown[]) => videoFindUniqueMock(...args),
    },
    user: { findUniqueOrThrow: (...args: unknown[]) => userFindUniqueOrThrowMock(...args) },
    workspace: {
      findUniqueOrThrow: (...args: unknown[]) => workspaceFindUniqueOrThrowMock(...args),
    },
    brandKitTemplate: {
      findUnique: (...args: unknown[]) => brandKitTemplateFindUniqueMock(...args),
    },
    transcriptSegment: {
      findMany: (...args: unknown[]) => transcriptSegmentFindManyMock(...args),
    },
    notification: { create: (...args: unknown[]) => notificationCreateMock(...args) },
    notificationPreference: {
      findUnique: (...args: unknown[]) => notificationPreferenceFindUniqueMock(...args),
    },
    $transaction: (...args: [Promise<unknown>[]]) => transactionMock(...args),
  },
}));

const publishNotificationMock = jest.fn();
jest.mock('../notificationPublisher', () => ({
  publishNotification: (...args: unknown[]) => publishNotificationMock(...args),
}));
const enqueueNotificationDeliveryMock = jest.fn();
jest.mock('../notificationDeliveryEnqueuer', () => ({
  enqueueNotificationDelivery: (...args: unknown[]) => enqueueNotificationDeliveryMock(...args),
}));

import { createGenerateMoreClipsWorker } from './generate-more-clips.worker';

function getProcessor() {
  createGenerateMoreClipsWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: {
    data: GenerateMoreClipsJobData;
  }) => Promise<unknown>;
}

const FULL_SCORES = {
  hookStrength: 70,
  educationalValue: 60,
  practicalValue: 65,
  curiosity: 65,
  emotion: 55,
  storytelling: 75,
  novelty: 50,
  trustAuthority: 80,
  ctaStrength: 40,
};

function scoredCandidate(overrides: Record<string, unknown>) {
  return {
    hashtags: [],
    scores: FULL_SCORES,
    reason: 'because it is a strong self-contained moment',
    topics: ['topic-a'],
    keywords: ['keyword-a'],
    intent: 'educate',
    ctaText: '',
    ...overrides,
  };
}

function baseJobData(overrides: Partial<GenerateMoreClipsJobData> = {}): GenerateMoreClipsJobData {
  return {
    videoId: 'video-1',
    requestedCount: 2,
    avoidOverlap: true,
    ...overrides,
  };
}

describe('generate-more-clips worker (adapter)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clipIdCounter = 0;
    transactionMock.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    videoUpdateMock.mockResolvedValue({});
    renderClipQueueAdd.mockResolvedValue(undefined);
    notificationCreateMock.mockResolvedValue({ id: 'notif-1' });
    notificationPreferenceFindUniqueMock.mockResolvedValue(null);
    publishNotificationMock.mockResolvedValue(undefined);
    enqueueNotificationDeliveryMock.mockResolvedValue(undefined);
    // Video exists, is RENDERED, and has 1 existing clip by default -
    // individual tests override to exercise the orphaned-job, non-RENDERED,
    // and zero-existing-clips paths.
    videoFindUniqueMock.mockResolvedValue({
      id: 'video-1',
      ownerId: 'owner-1',
      title: 'My Video',
      status: VideoStatus.RENDERED,
      processingOptions: null,
    });
    transcriptSegmentFindManyMock.mockResolvedValue([
      {
        id: 'seg-1',
        start: 0,
        end: 60,
        text: 'hello world',
        speaker: null,
        emotion: null,
        words: null,
        rmsDb: null,
        peakDb: null,
        speakingRateWordsPerSecond: null,
      },
    ]);
    clipFindManyMock.mockResolvedValue([{ startTime: 0, endTime: 20 }]);
    filterOverlappingCandidatesMock.mockImplementation((candidates: unknown[]) => candidates);
    userFindUniqueOrThrowMock.mockResolvedValue({ brandFontFamily: null });
    workspaceFindUniqueOrThrowMock.mockResolvedValue({ isPersonal: true });
    videoFindUniqueOrThrowMock.mockResolvedValue({ id: 'video-1', sourceUrl: 'videos/abc.mp4' });
  });

  it('skips an orphaned job for a video that was deleted while queued, without doing any work', async () => {
    videoFindUniqueMock.mockResolvedValue(null);

    const processor = getProcessor();
    const result = await processor({ data: baseJobData() });

    expect(result).toEqual({ videoId: 'video-1', candidateCount: 0 });
    expect(scoreClipCandidatesMock).not.toHaveBeenCalled();
    expect(transcriptSegmentFindManyMock).not.toHaveBeenCalled();
  });

  it('skips without error when the video is not RENDERED (state changed between enqueue and processing)', async () => {
    videoFindUniqueMock.mockResolvedValue({
      id: 'video-1',
      ownerId: 'owner-1',
      title: 'My Video',
      status: VideoStatus.CLIPS_DETECTED,
      processingOptions: null,
    });

    const processor = getProcessor();
    const result = await processor({ data: baseJobData() });

    expect(result).toEqual({ videoId: 'video-1', candidateCount: 0 });
    expect(scoreClipCandidatesMock).not.toHaveBeenCalled();
  });

  it('builds excludeRanges from every existing clip and passes maxCandidates/min/maxClipSeconds/minConfidence through', async () => {
    clipFindManyMock.mockResolvedValue([
      { startTime: 0, endTime: 20 },
      { startTime: 40, endTime: 55 },
    ]);
    scoreClipCandidatesMock.mockResolvedValue({ candidates: [] });

    const processor = getProcessor();
    await processor({
      data: baseJobData({
        requestedCount: 3,
        minClipDurationSeconds: 15,
        maxClipDurationSeconds: 90,
        minConfidence: 60,
      }),
    });

    expect(scoreClipCandidatesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxCandidates: 3,
        minClipSeconds: 15,
        maxClipSeconds: 90,
        minConfidence: 60,
        excludeRanges: [
          { start: 0, end: 20 },
          { start: 40, end: 55 },
        ],
      }),
      { openai: {} },
    );
  });

  it('creates a new clip per surviving candidate and enqueues one render-clip each, without touching Video.status', async () => {
    scoreClipCandidatesMock.mockResolvedValue({
      candidates: [
        scoredCandidate({ startTime: 30, endTime: 55, viralityScore: 80, hookText: 'a' }),
        scoredCandidate({ startTime: 60, endTime: 90, viralityScore: 70, hookText: 'b' }),
      ],
    });

    const processor = getProcessor();
    const result = await processor({ data: baseJobData({ requestedCount: 2 }) });

    expect(result).toEqual({ videoId: 'video-1', candidateCount: 2 });
    expect(clipCreateMock).toHaveBeenCalledTimes(2);
    expect(renderClipQueueAdd).toHaveBeenCalledTimes(2);
    expect(renderClipQueueAdd).toHaveBeenCalledWith(
      QueueName.RENDER_CLIP,
      expect.objectContaining({ startTime: 30, endTime: 55 }),
      RENDER_CLIP_RETRY_OPTIONS,
    );
    // The one behavior this worker must never have: detect-clips.worker.ts's
    // CLIPS_DETECTED transition. A RENDERED video stays RENDERED throughout
    // Generate More (see this worker's own module comment).
    expect(videoUpdateMock).not.toHaveBeenCalled();
  });

  it('filters overlapping candidates when avoidOverlap is true and creates only the survivors', async () => {
    const overlapping = scoredCandidate({
      startTime: 5,
      endTime: 15,
      viralityScore: 90,
      hookText: 'overlap',
    });
    const clear = scoredCandidate({
      startTime: 30,
      endTime: 55,
      viralityScore: 70,
      hookText: 'clear',
    });
    scoreClipCandidatesMock.mockResolvedValue({ candidates: [overlapping, clear] });
    filterOverlappingCandidatesMock.mockReturnValue([clear]);

    const processor = getProcessor();
    const result = await processor({ data: baseJobData({ avoidOverlap: true }) });

    expect(filterOverlappingCandidatesMock).toHaveBeenCalledWith(
      [overlapping, clear],
      [{ start: 0, end: 20 }],
    );
    expect(result).toEqual({ videoId: 'video-1', candidateCount: 1 });
    expect(clipCreateMock).toHaveBeenCalledTimes(1);
  });

  it('does not filter overlapping candidates when avoidOverlap is false', async () => {
    const overlapping = scoredCandidate({
      startTime: 5,
      endTime: 15,
      viralityScore: 90,
      hookText: 'overlap',
    });
    scoreClipCandidatesMock.mockResolvedValue({ candidates: [overlapping] });

    const processor = getProcessor();
    const result = await processor({ data: baseJobData({ avoidOverlap: false }) });

    expect(filterOverlappingCandidatesMock).not.toHaveBeenCalled();
    expect(result).toEqual({ videoId: 'video-1', candidateCount: 1 });
    expect(clipCreateMock).toHaveBeenCalledTimes(1);
  });

  it('records a GENERATE_MORE_NO_CANDIDATES notification and creates zero clips when nothing survives filtering', async () => {
    scoreClipCandidatesMock.mockResolvedValue({
      candidates: [
        scoredCandidate({ startTime: 5, endTime: 15, viralityScore: 90, hookText: 'overlap' }),
      ],
    });
    filterOverlappingCandidatesMock.mockReturnValue([]);

    const processor = getProcessor();
    const result = await processor({ data: baseJobData() });

    expect(result).toEqual({ videoId: 'video-1', candidateCount: 0 });
    expect(clipCreateMock).not.toHaveBeenCalled();
    expect(renderClipQueueAdd).not.toHaveBeenCalled();
    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'owner-1',
          type: 'GENERATE_MORE_NO_CANDIDATES',
          videoId: 'video-1',
        }),
      }),
    );
  });

  it('reports the failure to Sentry, rethrows, and never marks the video FAILED', async () => {
    scoreClipCandidatesMock.mockRejectedValue(new Error('LLM call failed'));

    const processor = getProcessor();
    await expect(processor({ data: baseJobData() })).rejects.toThrow('LLM call failed');

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { videoId: 'video-1' } }),
    );
    // Unlike detect-clips.worker.ts's catch block, this worker must never
    // mark the whole Video FAILED - its existing clips are all still fine.
    expect(videoUpdateMock).not.toHaveBeenCalled();
  });
});
