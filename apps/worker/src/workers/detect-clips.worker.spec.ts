import { VideoStatus } from '@speedora/database';
import { QueueName, type TranscriptSegment } from '@speedora/shared';
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
  detectClipsQueue: { add: jest.fn() },
  renderClipQueue: { add: (...args: unknown[]) => renderClipQueueAdd(...args) },
}));

// The adapter's only job is: call the stateless @speedora/clip-scoring
// module, then persist/orchestrate the result - so that module is mocked
// directly here rather than faking an LLM response. Its own behavior (LLM
// call, filtering, sanitization, Smart Start/End) is covered purely by
// packages/clip-scoring's own fixture-based spec, with no DB/queue mocking
// at all.
const scoreClipCandidatesMock = jest.fn();
jest.mock('@speedora/clip-scoring', () => ({
  scoreClipCandidates: (...args: unknown[]) => scoreClipCandidatesMock(...args),
}));

let clipIdCounter = 0;
const clipCreateMock = jest.fn((args: { data: Record<string, unknown> }) => {
  clipIdCounter += 1;
  return Promise.resolve({ id: `clip-${clipIdCounter}`, captionStyle: 'DEFAULT', ...args.data });
});
const videoUpdateMock = jest.fn();
const videoFindUniqueOrThrowMock = jest.fn();
const videoFindUniqueMock = jest.fn();
const videoStatusEventCreateMock = jest.fn().mockResolvedValue({});
const notificationCreateMock = jest.fn();
const notificationPreferenceFindUniqueMock = jest.fn();
const transactionMock = jest.fn((ops: Promise<unknown>[]) => Promise.all(ops));
jest.mock('../prisma', () => ({
  prisma: {
    clip: { create: (...args: [{ data: Record<string, unknown> }]) => clipCreateMock(...args) },
    video: {
      update: (...args: unknown[]) => videoUpdateMock(...args),
      findUniqueOrThrow: (...args: unknown[]) => videoFindUniqueOrThrowMock(...args),
      findUnique: (...args: unknown[]) => videoFindUniqueMock(...args),
    },
    // Fase 3 (DB+JSON-contract roadmap) - updateVideoStatus() writes here
    // too, in the same $transaction as video.update().
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

import { createDetectClipsWorker } from './detect-clips.worker';

function getProcessor() {
  createDetectClipsWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: {
    data: { videoId: string; segments: TranscriptSegment[] };
  }) => Promise<unknown>;
}

const FULL_SCORES = {
  hookStrength: 70,
  educationalValue: 60,
  curiosity: 65,
  emotion: 55,
  storytelling: 75,
  novelty: 50,
  trustAuthority: 80,
};

// Every field a @speedora/clip-scoring candidate carries, with sensible
// defaults - tests override only what they care about.
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

describe('detect-clips worker (adapter)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clipIdCounter = 0;
    transactionMock.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    videoUpdateMock.mockResolvedValue({});
    renderClipQueueAdd.mockResolvedValue(undefined);
    notificationCreateMock.mockResolvedValue({ id: 'notif-1' });
    notificationPreferenceFindUniqueMock.mockResolvedValue(null);
    publishNotificationMock.mockResolvedValue(undefined);
    // Video exists and is at its precondition status (TRANSCRIBED) by
    // default - individual tests override this to exercise the
    // orphaned-job (deleted-video) and already-processed (idempotency) skip
    // paths.
    videoFindUniqueMock.mockResolvedValue({ status: VideoStatus.TRANSCRIBED });
  });

  it("narrows each TranscriptSegment to the scoring module's own input shape (drops speaker/emotion)", async () => {
    scoreClipCandidatesMock.mockResolvedValue({ candidates: [] });
    const segments: TranscriptSegment[] = [
      {
        start: 0,
        end: 5,
        text: 'hi',
        speaker: 'Speaker A',
        emotion: 'hap',
        words: [{ word: 'hi', start: 0, end: 0.5 }],
      },
    ];

    const processor = getProcessor();
    await processor({ data: { videoId: 'video-1', segments } });

    expect(scoreClipCandidatesMock).toHaveBeenCalledWith(
      {
        segments: [{ start: 0, end: 5, text: 'hi', words: [{ word: 'hi', start: 0, end: 0.5 }] }],
      },
      { openai: {} },
    );
  });

  it('persists each candidate, marks the video CLIPS_DETECTED, and enqueues render-clip per candidate', async () => {
    const segments: TranscriptSegment[] = [{ start: 0, end: 60, text: 'main content' }];
    scoreClipCandidatesMock.mockResolvedValue({
      candidates: [
        scoredCandidate({ startTime: 10, endTime: 35, viralityScore: 100, hookText: 'a' }),
        scoredCandidate({ startTime: 35, endTime: 58, viralityScore: 70, hookText: 'b' }),
      ],
    });
    videoFindUniqueOrThrowMock.mockResolvedValue({ id: 'video-1', sourceUrl: 'videos/abc.mp4' });

    const processor = getProcessor();
    const result = (await processor({ data: { videoId: 'video-1', segments } })) as {
      candidates: Array<{ viralityScore: number }>;
    };

    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.CLIPS_DETECTED },
    });
    expect(result.candidates.map((c) => c.viralityScore)).toEqual([100, 70]);
    expect(renderClipQueueAdd).toHaveBeenCalledTimes(2);
  });

  it('enqueues render-clip with the video source URL and the overlapping transcript slice', async () => {
    const segments: TranscriptSegment[] = [
      { start: 0, end: 3, text: 'before clip' },
      { start: 10, end: 30, text: 'inside clip' },
      { start: 35, end: 40, text: 'after clip' },
    ];
    scoreClipCandidatesMock.mockResolvedValue({
      candidates: [
        scoredCandidate({
          startTime: 5,
          endTime: 32,
          viralityScore: 90,
          hookText: 'hook',
          hashtags: ['tag'],
        }),
      ],
    });
    videoFindUniqueOrThrowMock.mockResolvedValue({ id: 'video-1', sourceUrl: 'videos/abc.mp4' });

    const processor = getProcessor();
    await processor({ data: { videoId: 'video-1', segments } });

    expect(renderClipQueueAdd).toHaveBeenCalledWith(
      QueueName.RENDER_CLIP,
      expect.objectContaining({
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        startTime: 5,
        endTime: 32,
        transcript: [{ start: 10, end: 30, text: 'inside clip' }],
      }),
    );
  });

  it("computes emoji suggestions (Fase 23) from the candidate's own overlapping transcript text and persists them", async () => {
    const segments: TranscriptSegment[] = [
      { start: 0, end: 3, text: 'before clip, not counted' },
      { start: 10, end: 20, text: 'this is amazing news' },
      { start: 20, end: 30, text: 'up 40% this quarter' },
      { start: 35, end: 40, text: 'after clip, not counted' },
    ];
    scoreClipCandidatesMock.mockResolvedValue({
      candidates: [
        scoredCandidate({ startTime: 10, endTime: 30, viralityScore: 90, hookText: 'hook' }),
      ],
    });
    videoFindUniqueOrThrowMock.mockResolvedValue({ id: 'video-1', sourceUrl: 'videos/abc.mp4' });

    const processor = getProcessor();
    const result = (await processor({ data: { videoId: 'video-1', segments } })) as {
      candidates: Array<{ emojiSuggestions: string[] }>;
    };

    expect(clipCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ emojiSuggestions: ['🔥', '📈'] }),
    });
    expect(result.candidates[0].emojiSuggestions).toEqual(['🔥', '📈']);
  });

  it('does not enqueue render-clip or fetch the video when there are no candidates', async () => {
    scoreClipCandidatesMock.mockResolvedValue({ candidates: [] });

    const processor = getProcessor();
    const result = await processor({
      data: { videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] },
    });

    expect(result).toEqual({ videoId: 'video-1', candidates: [] });
    expect(videoFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(renderClipQueueAdd).not.toHaveBeenCalled();
  });

  it('skips an orphaned job for a video that was deleted while queued, without doing any work', async () => {
    videoFindUniqueMock.mockResolvedValue(null);

    const processor = getProcessor();
    const result = await processor({
      data: { videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] },
    });

    expect(result).toEqual({ videoId: 'video-1', candidates: [] });
    // No LLM call, no clip writes, no status update, no downstream enqueue -
    // the job is a pure no-op once the video is gone.
    expect(scoreClipCandidatesMock).not.toHaveBeenCalled();
    expect(clipCreateMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalled();
    expect(renderClipQueueAdd).not.toHaveBeenCalled();
  });

  it('skips a job for a video already past TRANSCRIBED, without a duplicate LLM call (BullMQ stalled-job re-processing guard)', async () => {
    videoFindUniqueMock.mockResolvedValue({ status: VideoStatus.CLIPS_DETECTED });

    const processor = getProcessor();
    const result = await processor({
      data: { videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] },
    });

    expect(result).toEqual({ videoId: 'video-1', candidates: [] });
    expect(scoreClipCandidatesMock).not.toHaveBeenCalled();
    expect(clipCreateMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalled();
    expect(renderClipQueueAdd).not.toHaveBeenCalled();
  });

  it('marks the video FAILED and rethrows when the scoring module fails', async () => {
    scoreClipCandidatesMock.mockRejectedValue(new Error('openai is down'));

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
    // Milestone 04c - deps.publish wired through to updateVideoStatus.
    expect(publishNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RENDER_FAILED' }),
    );
  });

  it('reports the failure to Sentry tagged with videoId only (no transcript content)', async () => {
    const error = new Error('openai is down');
    scoreClipCandidatesMock.mockRejectedValue(error);

    const processor = getProcessor();

    await expect(
      processor({
        data: { videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] },
      }),
    ).rejects.toThrow('openai is down');

    expect(captureExceptionMock).toHaveBeenCalledWith(error, { tags: { videoId: 'video-1' } });
  });
});
