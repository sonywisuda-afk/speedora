import { VideoStatus } from '@speedora/database';
import { QueueName, RENDER_CLIP_RETRY_OPTIONS, type TranscriptSegment } from '@speedora/shared';
import { Worker } from 'bullmq';

// UnrecoverableError is left real (via requireActual) - only Worker itself
// is mocked, same "mock the seam, leave real classes/pure functions real"
// convention as probe-video.worker.spec.ts/import-youtube.worker.spec.ts.
jest.mock('bullmq', () => ({
  ...jest.requireActual('bullmq'),
  Worker: jest.fn(),
}));
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
// AI Intelligence v4 Phase 13.1 (Clip Ranking Engine) - isCandidateExpansionEnabled
// is left REAL (via requireActual), not mocked, so tests can flip the real
// env var and assert the real read - same "mock the seam, leave real
// classes/pure functions real" convention this file's other jest.mock calls
// already follow (see the bullmq mock's own comment above).
// CANDIDATE_EXPANSION_POOL_SIZE is also left real since it's a plain
// constant, not a seam.
jest.mock('@speedora/clip-scoring', () => ({
  ...jest.requireActual('@speedora/clip-scoring'),
  scoreClipCandidates: (...args: unknown[]) => scoreClipCandidatesMock(...args),
}));

// AI Intelligence v4 Phase 13.2 (Clip Ranking Engine, Stage B) -
// @speedora/candidate-shortlist itself is left REAL (unmocked) here, same
// "mock the seam, leave real orchestration real" convention as
// isCandidateExpansionEnabled() above - its own passthrough behavior (the
// common case in this file's existing tests, all well under the shortlist
// target) is exercised for real with zero extra setup. Only the two true
// external LLM seams it calls into are mocked, at the same packages
// nodes/semantic-events.ts and nodes/narrative-graph.ts already mock this
// way for the render-graph side of this codebase.
const detectSemanticEventsMock = jest.fn();
jest.mock('@speedora/semantic-events', () => ({
  detectSemanticEvents: (...args: unknown[]) => detectSemanticEventsMock(...args),
}));
const buildNarrativeGraphMock = jest.fn();
jest.mock('@speedora/narrative-graph', () => ({
  buildNarrativeGraph: (...args: unknown[]) => buildNarrativeGraphMock(...args),
}));

let clipIdCounter = 0;
const clipCreateMock = jest.fn((args: { data: Record<string, unknown> }) => {
  clipIdCounter += 1;
  // captionStyle/applyBrandKit/watermarkEnabled/introEnabled/outroEnabled
  // all mirror real schema.prisma column defaults (not passed explicitly in
  // the create data - see the worker's own comment) - synthesized here so
  // the mock reflects what a real Prisma insert would actually return.
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
// Workspace-level Brand Kit roadmap (P3g).
const workspaceFindUniqueOrThrowMock = jest.fn();
// Pre-Processing Settings roadmap (Phase 3).
const brandKitTemplateFindUniqueMock = jest.fn();
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
    // Brand Kit roadmap (P3a) - resolves the video owner's chosen font once
    // per detect-clips run, same reasoning as ClipsService.render()'s own
    // resolveFontFamily.
    user: { findUniqueOrThrow: (...args: unknown[]) => userFindUniqueOrThrowMock(...args) },
    // Workspace-level Brand Kit roadmap (P3g) - merged over the owner's
    // fields per-field, same reasoning as ClipsService's own
    // resolveEffectiveBrandKit.
    workspace: {
      findUniqueOrThrow: (...args: unknown[]) => workspaceFindUniqueOrThrowMock(...args),
    },
    // Pre-Processing Settings roadmap (Phase 3) - resolveBrandKitFields()'s
    // ownership-checked template lookup.
    brandKitTemplate: {
      findUnique: (...args: unknown[]) => brandKitTemplateFindUniqueMock(...args),
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

type FakeJob = {
  data: { videoId: string; segments: TranscriptSegment[] };
  attemptsMade: number;
  opts: { attempts?: number };
};

function getProcessor() {
  createDetectClipsWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: FakeJob) => Promise<unknown>;
}

// Every existing (pre-retry-framework) test exercises a single-attempt job
// (attemptsMade: 0, opts.attempts: 1) - the new retry tests below override
// these explicitly, same convention as
// probe-video.worker.spec.ts/import-youtube.worker.spec.ts's own fakeJob
// helper.
function fakeJob(
  data: FakeJob['data'],
  overrides: Partial<Pick<FakeJob, 'attemptsMade' | 'opts'>> = {},
): FakeJob {
  return { data, attemptsMade: 0, opts: { attempts: 1 }, ...overrides };
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
    // AI Intelligence v4 Phase 13.2 - only reached when a test's raw
    // candidate pool exceeds the shortlist target; harmless defaults for
    // every other (passthrough) test.
    detectSemanticEventsMock.mockResolvedValue([]);
    buildNarrativeGraphMock.mockResolvedValue({ segments: [], relations: [], unsegmented: true });
    // Video exists and is at its precondition status (TRANSCRIBED) by
    // default - individual tests override this to exercise the
    // orphaned-job (deleted-video) and already-processed (idempotency) skip
    // paths.
    videoFindUniqueMock.mockResolvedValue({ status: VideoStatus.TRANSCRIBED });
    // Brand Kit roadmap (P3a) - no font set by default; individual tests
    // override to exercise a real brandFontFamily flowing through.
    userFindUniqueOrThrowMock.mockResolvedValue({ brandFontFamily: null });
    // Workspace-level Brand Kit roadmap (P3g) - defaults to a personal
    // workspace (mergeBrandKitFields short-circuits to the owner's fields
    // untouched), same "existing tests keep working unchanged" reasoning as
    // ClipsService/VideosService's own specs.
    workspaceFindUniqueOrThrowMock.mockResolvedValue({ isPersonal: true });
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
    await processor(fakeJob({ videoId: 'video-1', segments }));

    expect(scoreClipCandidatesMock).toHaveBeenCalledWith(
      {
        segments: [{ start: 0, end: 5, text: 'hi', words: [{ word: 'hi', start: 0, end: 0.5 }] }],
      },
      { openai: {} },
    );
  });

  // Pre-Processing Settings roadmap (Phase 0/1).
  it('threads clipCount/min/maxClipDurationSeconds from Video.processingOptions into the scoring module', async () => {
    scoreClipCandidatesMock.mockResolvedValue({ candidates: [] });
    videoFindUniqueMock.mockResolvedValue({
      status: VideoStatus.TRANSCRIBED,
      processingOptions: {
        version: 1,
        clipGeneration: { clipCount: 5, minClipDurationSeconds: 15, maxClipDurationSeconds: 45 },
      },
    });
    const segments: TranscriptSegment[] = [{ start: 0, end: 5, text: 'hi' }];

    const processor = getProcessor();
    await processor(fakeJob({ videoId: 'video-1', segments }));

    expect(scoreClipCandidatesMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxCandidates: 5, minClipSeconds: 15, maxClipSeconds: 45 }),
      { openai: {} },
    );
  });

  it("maps clipCount: 'unlimited' to a high cap rather than an uncapped/NaN value", async () => {
    scoreClipCandidatesMock.mockResolvedValue({ candidates: [] });
    videoFindUniqueMock.mockResolvedValue({
      status: VideoStatus.TRANSCRIBED,
      processingOptions: { version: 1, clipGeneration: { clipCount: 'unlimited' } },
    });
    const segments: TranscriptSegment[] = [{ start: 0, end: 5, text: 'hi' }];

    const processor = getProcessor();
    await processor(fakeJob({ videoId: 'video-1', segments }));

    const call = scoreClipCandidatesMock.mock.calls[0][0] as { maxCandidates: number };
    expect(Number.isFinite(call.maxCandidates)).toBe(true);
    expect(call.maxCandidates).toBeGreaterThan(3);
  });

  // AI Intelligence v4 Phase 13.1 (Clip Ranking Engine, see
  // docs/ai/clip-ranking-engine.md).
  describe('CANDIDATE_EXPANSION_ENABLED', () => {
    const original = process.env.CANDIDATE_EXPANSION_ENABLED;

    afterEach(() => {
      if (original === undefined) delete process.env.CANDIDATE_EXPANSION_ENABLED;
      else process.env.CANDIDATE_EXPANSION_ENABLED = original;
    });

    it('requests the funnel pool size when the flag is on and clipCount is omitted', async () => {
      process.env.CANDIDATE_EXPANSION_ENABLED = 'true';
      scoreClipCandidatesMock.mockResolvedValue({ candidates: [] });
      videoFindUniqueMock.mockResolvedValue({
        status: VideoStatus.TRANSCRIBED,
        processingOptions: null,
      });
      const segments: TranscriptSegment[] = [{ start: 0, end: 5, text: 'hi' }];

      const processor = getProcessor();
      await processor(fakeJob({ videoId: 'video-1', segments }));

      expect(scoreClipCandidatesMock).toHaveBeenCalledWith(
        expect.objectContaining({ maxCandidates: 30 }),
        { openai: {} },
      );
    });

    it('leaves the module default untouched when the flag is off, even with no processingOptions', async () => {
      delete process.env.CANDIDATE_EXPANSION_ENABLED;
      scoreClipCandidatesMock.mockResolvedValue({ candidates: [] });
      videoFindUniqueMock.mockResolvedValue({
        status: VideoStatus.TRANSCRIBED,
        processingOptions: null,
      });
      const segments: TranscriptSegment[] = [{ start: 0, end: 5, text: 'hi' }];

      const processor = getProcessor();
      await processor(fakeJob({ videoId: 'video-1', segments }));

      const call = scoreClipCandidatesMock.mock.calls[0][0] as { maxCandidates?: number };
      expect(call.maxCandidates).toBeUndefined();
    });

    it("an explicit clipCount still wins over the flag's pool size", async () => {
      process.env.CANDIDATE_EXPANSION_ENABLED = 'true';
      scoreClipCandidatesMock.mockResolvedValue({ candidates: [] });
      videoFindUniqueMock.mockResolvedValue({
        status: VideoStatus.TRANSCRIBED,
        processingOptions: { version: 1, clipGeneration: { clipCount: 5 } },
      });
      const segments: TranscriptSegment[] = [{ start: 0, end: 5, text: 'hi' }];

      const processor = getProcessor();
      await processor(fakeJob({ videoId: 'video-1', segments }));

      expect(scoreClipCandidatesMock).toHaveBeenCalledWith(
        expect.objectContaining({ maxCandidates: 5 }),
        { openai: {} },
      );
    });
  });

  // AI Intelligence v4 Phase 13.2 (Clip Ranking Engine, Stage B - see
  // docs/ai/clip-ranking-engine.md).
  describe('candidate shortlisting (Phase 13.2)', () => {
    const COMPLETE_SCORES = {
      hookStrength: 50,
      educationalValue: 50,
      practicalValue: 50,
      curiosity: 50,
      emotion: 50,
      storytelling: 50,
      novelty: 50,
      trustAuthority: 50,
      ctaStrength: 50,
    };

    // Ascending viralityScore (index 0 weakest, last strongest) with every
    // other Tier-1 signal held identical, so the shortlist's own composite
    // score ranks purely on viralityScore - a deterministic way to assert
    // which candidates survive.
    function manyScoredCandidates(count: number) {
      return Array.from({ length: count }, (_, i) =>
        scoredCandidate({
          startTime: i * 30,
          endTime: i * 30 + 25,
          viralityScore: i,
          hookText: `hook-${i}`,
          scores: COMPLETE_SCORES,
        }),
      );
    }

    it('does not call the shortlist LLM signals when the raw pool is already at or under the shortlist target', async () => {
      const segments: TranscriptSegment[] = [{ start: 0, end: 600, text: 'video' }];
      scoreClipCandidatesMock.mockResolvedValue({ candidates: manyScoredCandidates(10) });
      videoFindUniqueOrThrowMock.mockResolvedValue({ id: 'video-1', sourceUrl: 'videos/abc.mp4' });

      const processor = getProcessor();
      const result = (await processor(fakeJob({ videoId: 'video-1', segments }))) as {
        candidates: unknown[];
      };

      expect(detectSemanticEventsMock).not.toHaveBeenCalled();
      expect(buildNarrativeGraphMock).not.toHaveBeenCalled();
      expect(result.candidates).toHaveLength(10);
      expect(renderClipQueueAdd).toHaveBeenCalledTimes(10);
    });

    it('shortlists a raw pool larger than the target down to 15 before persisting or rendering anything', async () => {
      const segments: TranscriptSegment[] = [{ start: 0, end: 600, text: 'video' }];
      scoreClipCandidatesMock.mockResolvedValue({ candidates: manyScoredCandidates(20) });
      videoFindUniqueOrThrowMock.mockResolvedValue({ id: 'video-1', sourceUrl: 'videos/abc.mp4' });

      const processor = getProcessor();
      const result = (await processor(fakeJob({ videoId: 'video-1', segments }))) as {
        candidates: Array<{ viralityScore: number }>;
      };

      expect(detectSemanticEventsMock).toHaveBeenCalledTimes(20);
      expect(buildNarrativeGraphMock).toHaveBeenCalledTimes(20);
      expect(result.candidates).toHaveLength(15);
      expect(renderClipQueueAdd).toHaveBeenCalledTimes(15);
      // Every other Tier-1 signal is identical across fixtures (see
      // manyScoredCandidates), so the 5 lowest-viralityScore candidates
      // (0-4) are exactly the ones the shortlist cuts.
      expect(result.candidates.map((c) => c.viralityScore).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 15 }, (_, i) => i + 5),
      );
    });

    it('never persists a Clip row for a candidate the shortlist cut', async () => {
      const segments: TranscriptSegment[] = [{ start: 0, end: 600, text: 'video' }];
      scoreClipCandidatesMock.mockResolvedValue({ candidates: manyScoredCandidates(18) });
      videoFindUniqueOrThrowMock.mockResolvedValue({ id: 'video-1', sourceUrl: 'videos/abc.mp4' });

      const processor = getProcessor();
      await processor(fakeJob({ videoId: 'video-1', segments }));

      expect(clipCreateMock).toHaveBeenCalledTimes(15);
    });
  });

  it('applies processingOptions.subtitle as the new clip default instead of the schema default', async () => {
    videoFindUniqueMock.mockResolvedValue({
      status: VideoStatus.TRANSCRIBED,
      processingOptions: {
        version: 1,
        subtitle: { captionStyle: 'KARAOKE', speakerColorCaptions: true, fontFamily: 'Poppins' },
      },
    });
    scoreClipCandidatesMock.mockResolvedValue({
      candidates: [
        scoredCandidate({ startTime: 0, endTime: 30, viralityScore: 80, hookText: 'a' }),
      ],
    });
    videoFindUniqueOrThrowMock.mockResolvedValue({ id: 'video-1', sourceUrl: 'videos/abc.mp4' });

    const processor = getProcessor();
    await processor(fakeJob({ videoId: 'video-1', segments: [{ start: 0, end: 30, text: 'hi' }] }));

    expect(clipCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        captionStyle: 'KARAOKE',
        speakerColorCaptions: true,
        fontFamily: 'Poppins',
      }),
    });
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
    const result = (await processor(fakeJob({ videoId: 'video-1', segments }))) as {
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
    await processor(fakeJob({ videoId: 'video-1', segments }));

    expect(renderClipQueueAdd).toHaveBeenCalledWith(
      QueueName.RENDER_CLIP,
      expect.objectContaining({
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        startTime: 5,
        endTime: 32,
        transcript: [{ start: 10, end: 30, text: 'inside clip' }],
      }),
      RENDER_CLIP_RETRY_OPTIONS,
    );
  });

  // Workspace-level Brand Kit roadmap (P3g).
  it("prefers the video's workspace Brand Kit font over the owner's personal one when set", async () => {
    scoreClipCandidatesMock.mockResolvedValue({
      candidates: [
        scoredCandidate({ startTime: 5, endTime: 10, viralityScore: 90, hookText: 'hook' }),
      ],
    });
    videoFindUniqueOrThrowMock.mockResolvedValue({
      id: 'video-1',
      sourceUrl: 'videos/abc.mp4',
      ownerId: 'user-1',
      workspaceId: 'team-ws-1',
    });
    workspaceFindUniqueOrThrowMock.mockResolvedValue({
      isPersonal: false,
      brandFontFamily: 'Oswald',
    });
    userFindUniqueOrThrowMock.mockResolvedValue({ brandFontFamily: 'Roboto' });

    const processor = getProcessor();
    await processor(fakeJob({ videoId: 'video-1', segments: [{ start: 0, end: 10, text: 'hi' }] }));

    expect(workspaceFindUniqueOrThrowMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'team-ws-1' } }),
    );
    expect(renderClipQueueAdd).toHaveBeenCalledWith(
      QueueName.RENDER_CLIP,
      expect.objectContaining({ fontFamily: 'Oswald' }),
      RENDER_CLIP_RETRY_OPTIONS,
    );
  });

  // Pre-Processing Settings roadmap (Phase 3).
  it('sets applyBrandKit: false on every new clip when processingOptions opts the whole video out', async () => {
    videoFindUniqueMock.mockResolvedValue({
      status: VideoStatus.TRANSCRIBED,
      processingOptions: { version: 1, brandKit: { applyBrandKit: false } },
    });
    scoreClipCandidatesMock.mockResolvedValue({
      candidates: [
        scoredCandidate({ startTime: 0, endTime: 30, viralityScore: 80, hookText: 'a' }),
      ],
    });
    videoFindUniqueOrThrowMock.mockResolvedValue({ id: 'video-1', sourceUrl: 'videos/abc.mp4' });

    const processor = getProcessor();
    await processor(fakeJob({ videoId: 'video-1', segments: [{ start: 0, end: 30, text: 'hi' }] }));

    expect(clipCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ applyBrandKit: false }),
    });
  });

  it('uses a chosen Brand Kit template (owned by the video) as the effective Brand Kit instead of the live one, without fetching workspace/owner', async () => {
    videoFindUniqueMock.mockResolvedValue({
      status: VideoStatus.TRANSCRIBED,
      processingOptions: { version: 1, brandKit: { templateId: 'template-1' } },
    });
    scoreClipCandidatesMock.mockResolvedValue({
      candidates: [
        scoredCandidate({ startTime: 0, endTime: 30, viralityScore: 80, hookText: 'a' }),
      ],
    });
    videoFindUniqueOrThrowMock.mockResolvedValue({
      id: 'video-1',
      sourceUrl: 'videos/abc.mp4',
      ownerId: 'user-1',
      workspaceId: 'workspace-1',
    });
    brandKitTemplateFindUniqueMock.mockResolvedValue({
      id: 'template-1',
      userId: 'user-1',
      fontFamily: 'Montserrat',
      watermarkUrl: 'watermarks/template-1.png',
      watermarkOpacity: 0.5,
      watermarkScale: 0.2,
      watermarkMargin: 0.05,
      watermarkPosition: 'TOP_LEFT',
      introUrl: null,
      introType: null,
      introImageDurationSeconds: null,
      outroUrl: null,
      outroType: null,
      outroImageDurationSeconds: null,
    });

    const processor = getProcessor();
    await processor(fakeJob({ videoId: 'video-1', segments: [{ start: 0, end: 30, text: 'hi' }] }));

    expect(brandKitTemplateFindUniqueMock).toHaveBeenCalledWith({ where: { id: 'template-1' } });
    expect(workspaceFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(userFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(renderClipQueueAdd).toHaveBeenCalledWith(
      QueueName.RENDER_CLIP,
      expect.objectContaining({
        fontFamily: 'Montserrat',
        watermark: {
          key: 'watermarks/template-1.png',
          opacity: 0.5,
          scale: 0.2,
          margin: 0.05,
          position: 'TOP_LEFT',
        },
      }),
      RENDER_CLIP_RETRY_OPTIONS,
    );
  });

  it('falls back to the live Brand Kit (and logs a warning) when the chosen template no longer exists', async () => {
    videoFindUniqueMock.mockResolvedValue({
      status: VideoStatus.TRANSCRIBED,
      processingOptions: { version: 1, brandKit: { templateId: 'deleted-template' } },
    });
    scoreClipCandidatesMock.mockResolvedValue({
      candidates: [
        scoredCandidate({ startTime: 0, endTime: 30, viralityScore: 80, hookText: 'a' }),
      ],
    });
    videoFindUniqueOrThrowMock.mockResolvedValue({
      id: 'video-1',
      sourceUrl: 'videos/abc.mp4',
      ownerId: 'user-1',
      workspaceId: 'workspace-1',
    });
    brandKitTemplateFindUniqueMock.mockResolvedValue(null);
    workspaceFindUniqueOrThrowMock.mockResolvedValue({ isPersonal: true });
    userFindUniqueOrThrowMock.mockResolvedValue({ brandFontFamily: 'Roboto' });

    const processor = getProcessor();
    await processor(fakeJob({ videoId: 'video-1', segments: [{ start: 0, end: 30, text: 'hi' }] }));

    expect(userFindUniqueOrThrowMock).toHaveBeenCalled();
    expect(renderClipQueueAdd).toHaveBeenCalledWith(
      QueueName.RENDER_CLIP,
      expect.objectContaining({ fontFamily: 'Roboto' }),
      RENDER_CLIP_RETRY_OPTIONS,
    );
  });

  it('falls back to the live Brand Kit when the chosen template belongs to a different user', async () => {
    videoFindUniqueMock.mockResolvedValue({
      status: VideoStatus.TRANSCRIBED,
      processingOptions: { version: 1, brandKit: { templateId: 'someone-elses-template' } },
    });
    scoreClipCandidatesMock.mockResolvedValue({
      candidates: [
        scoredCandidate({ startTime: 0, endTime: 30, viralityScore: 80, hookText: 'a' }),
      ],
    });
    videoFindUniqueOrThrowMock.mockResolvedValue({
      id: 'video-1',
      sourceUrl: 'videos/abc.mp4',
      ownerId: 'user-1',
      workspaceId: 'workspace-1',
    });
    brandKitTemplateFindUniqueMock.mockResolvedValue({
      id: 'someone-elses-template',
      userId: 'someone-else',
      fontFamily: 'Montserrat',
    });
    workspaceFindUniqueOrThrowMock.mockResolvedValue({ isPersonal: true });
    userFindUniqueOrThrowMock.mockResolvedValue({ brandFontFamily: 'Roboto' });

    const processor = getProcessor();
    await processor(fakeJob({ videoId: 'video-1', segments: [{ start: 0, end: 30, text: 'hi' }] }));

    expect(renderClipQueueAdd).toHaveBeenCalledWith(
      QueueName.RENDER_CLIP,
      expect.objectContaining({ fontFamily: 'Roboto' }),
      RENDER_CLIP_RETRY_OPTIONS,
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
    const result = (await processor(fakeJob({ videoId: 'video-1', segments }))) as {
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
    const result = await processor(
      fakeJob({ videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] }),
    );

    expect(result).toEqual({ videoId: 'video-1', candidates: [] });
    expect(videoFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(renderClipQueueAdd).not.toHaveBeenCalled();
  });

  it('skips an orphaned job for a video that was deleted while queued, without doing any work', async () => {
    videoFindUniqueMock.mockResolvedValue(null);

    const processor = getProcessor();
    const result = await processor(
      fakeJob({ videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] }),
    );

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
    const result = await processor(
      fakeJob({ videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] }),
    );

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
      processor(fakeJob({ videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] })),
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
      processor(fakeJob({ videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] })),
    ).rejects.toThrow('openai is down');

    expect(captureExceptionMock).toHaveBeenCalledWith(error, { tags: { videoId: 'video-1' } });
  });

  describe('retry framework (DETECT_CLIPS_RETRY_OPTIONS)', () => {
    it('does not mark the video FAILED on a non-final attempt of a transient (retryable) error', async () => {
      scoreClipCandidatesMock.mockRejectedValue(new Error('openai is down'));

      const processor = getProcessor();
      await expect(
        processor(
          fakeJob(
            { videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] },
            { attemptsMade: 0, opts: { attempts: 3 } },
          ),
        ),
      ).rejects.toThrow('openai is down');

      // Video.status stays TRANSCRIBED (no FAILED write) so the idempotency
      // guard above lets BullMQ's next attempt actually re-run the LLM call
      // instead of skipping it as "already past TRANSCRIBED".
      expect(videoUpdateMock).not.toHaveBeenCalled();
    });

    it('marks the video FAILED once a transient (retryable) error reaches its final attempt', async () => {
      scoreClipCandidatesMock.mockRejectedValue(new Error('openai is down'));

      const processor = getProcessor();
      await expect(
        processor(
          fakeJob(
            { videoId: 'video-1', segments: [{ start: 0, end: 5, text: 'hi' }] },
            { attemptsMade: 2, opts: { attempts: 3 } },
          ),
        ),
      ).rejects.toThrow('openai is down');

      expect(videoUpdateMock).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: VideoStatus.FAILED },
      });
    });
  });
});
