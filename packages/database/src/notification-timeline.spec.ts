import { computePipelineTimeline } from './notification-timeline';

const baseVideo = {
  id: 'video-1',
  createdAt: new Date('2026-07-27T00:00:00.000Z'),
  importProgress: null,
  transcribeProgress: null,
};

describe('computePipelineTimeline', () => {
  it('marks every stage done and reports no failure history for a clean, fully-rendered video', () => {
    const result = computePipelineTimeline({
      video: { ...baseVideo, status: 'RENDERED' as never },
      statusEvents: [
        {
          toStatus: 'UPLOADED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:01:00.000Z'),
        },
        {
          toStatus: 'TRANSCRIBED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:02:00.000Z'),
        },
        {
          toStatus: 'CLIPS_DETECTED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:03:00.000Z'),
        },
        {
          toStatus: 'RENDERED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:04:00.000Z'),
        },
      ],
      clips: [{ outputUrl: 'renders/clip-1.mp4' }],
    });

    expect(result.overallStatus).toBe('completed');
    expect(result.failureHistory).toEqual([]);
    expect(result.stages.every((stage) => stage.status === 'done')).toBe(true);
  });

  it('remembers a past failure (Retry -> Completed) even once the video has fully succeeded', () => {
    // Failed once at TRANSCRIBING (last reached status: UPLOADED), retried,
    // then completed cleanly - the CURRENT overallStatus is 'completed' and
    // every stage reads 'done', but failureHistory must still record the
    // real failure that happened along the way (requirement: error history
    // must never be silently overwritten by a later retry).
    const result = computePipelineTimeline({
      video: { ...baseVideo, status: 'RENDERED' as never },
      statusEvents: [
        {
          toStatus: 'UPLOADED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:01:00.000Z'),
        },
        {
          toStatus: 'FAILED' as never,
          errorMessage: 'Whisper API timed out',
          createdAt: new Date('2026-07-27T00:02:00.000Z'),
        },
        {
          toStatus: 'UPLOADED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:03:00.000Z'),
        },
        {
          toStatus: 'TRANSCRIBED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:04:00.000Z'),
        },
        {
          toStatus: 'CLIPS_DETECTED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:05:00.000Z'),
        },
        {
          toStatus: 'RENDERED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:06:00.000Z'),
        },
      ],
      clips: [{ outputUrl: 'renders/clip-1.mp4' }],
    });

    expect(result.overallStatus).toBe('completed');
    expect(result.failureReason).toBeNull();
    expect(result.stages.every((stage) => stage.status === 'done')).toBe(true);
    expect(result.failureHistory).toEqual([
      {
        stage: 'TRANSCRIBING',
        reason: 'Whisper API timed out',
        occurredAt: '2026-07-27T00:02:00.000Z',
      },
    ]);
  });

  it('records every failure when a video failed, retried, and failed again before eventually being retried once more', () => {
    const result = computePipelineTimeline({
      video: { ...baseVideo, status: 'FAILED' as never },
      statusEvents: [
        {
          toStatus: 'UPLOADED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:01:00.000Z'),
        },
        {
          toStatus: 'FAILED' as never,
          errorMessage: 'first failure',
          createdAt: new Date('2026-07-27T00:02:00.000Z'),
        },
        {
          toStatus: 'UPLOADED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:03:00.000Z'),
        },
        {
          toStatus: 'FAILED' as never,
          errorMessage: 'second failure',
          createdAt: new Date('2026-07-27T00:04:00.000Z'),
        },
      ],
      clips: [],
    });

    expect(result.overallStatus).toBe('failed');
    // The CURRENT failure reason is always the latest one (unchanged
    // existing behavior)...
    expect(result.failureReason).toBe('second failure');
    // ...but failureHistory keeps both, oldest first.
    expect(result.failureHistory).toEqual([
      { stage: 'TRANSCRIBING', reason: 'first failure', occurredAt: '2026-07-27T00:02:00.000Z' },
      { stage: 'TRANSCRIBING', reason: 'second failure', occurredAt: '2026-07-27T00:04:00.000Z' },
    ]);
  });

  it('returns an empty failureHistory for a video that has never failed', () => {
    const result = computePipelineTimeline({
      video: { ...baseVideo, status: 'TRANSCRIBED' as never },
      statusEvents: [
        {
          toStatus: 'UPLOADED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:01:00.000Z'),
        },
        {
          toStatus: 'TRANSCRIBED' as never,
          errorMessage: null,
          createdAt: new Date('2026-07-27T00:02:00.000Z'),
        },
      ],
      clips: [],
    });

    expect(result.failureHistory).toEqual([]);
  });
});
