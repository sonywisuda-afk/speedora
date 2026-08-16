// Phase D ("Real-video benchmark, blind human evaluation" - see docs/ai/phase-d-benchmark.md) of
// the "Speedora Editorial Operating System" mission. The automated-benchmark half of Phase D: runs
// the REAL, unmodified render-clip.worker.ts processor against a REAL already-rendered clip's real
// transcript/source video, twice - once with EDIT_BUDGET_ENABLED/EFFECT_CONFLICT_RESOLUTION_ENABLED
// off, once with both on (the only two flags that change the physical rendered file - see the doc's
// own audit) - and writes a human-review packet (apps/worker/reports/, gitignored) with real
// EditorialDecision/EditPlan/FinalClipQualityAssessment values plus short-lived presigned links to
// both rendered outputs. The actual blind human evaluation itself is NOT performed here - see the
// packet's own blank Rubric section.
//
// WHY THIS RUNS UNDER JEST (same as render-clip.worker.local-comparison.ts, not a plain tsx
// script): capturing the real BullMQ processor closure needs jest.mock('bullmq', ...)'s hoisting -
// confirmed by this initiative's own audit that getProcessor() only works inside Jest.
//
//   npx jest --testRegex "phase-d-benchmark\.ts$" --runInBand
//
// (--runInBand: two real ~2min ffmpeg renders plus several real vision-detector/LLM calls in
// sequence; no reason to contend with Jest's own worker pool.)
//
// WHAT STAYS REAL, deliberately UNLIKE local-comparison.ts (which mocks every AI/vision detector to
// keep its own ffmpeg-equivalence question free of LLM cost/non-determinism): every AI/vision
// detector package (scene/facial/gesture/ocr/object-intelligence, hook-prediction, semantic-events,
// narrative-graph, multimodal-reasoning), '@speedora/visual-emphasis' (real computeEditingSuggestions),
// '@speedora/reframe' (real crop-path), '@speedora/subtitles' (real buildAss), '../openai' (a REAL
// OpenAI client, using this environment's real OPENAI_API_KEY), and of course '../ffmpeg' - this is
// the entire point of Phase D, to observe REAL signals, not synthetic/mocked ones. This means each
// of the two runs makes real OpenAI API calls (a real, user-confirmed cost, bounded to ONE real clip
// for this first pass - see the doc's own §"real cost").
//
// WHAT'S MOCKED, and why:
// - 'bullmq' (Worker capture only, same technique as local-comparison.ts/render-clip.worker.spec.ts).
// - '../redis', '../queues', '@sentry/node', '../notificationPublisher',
//   '../notificationDeliveryEnqueuer' - inert side channels unrelated to what this benchmark
//   observes, same convention as local-comparison.ts.
// - '../logger' - captured (for RENDER_MANIFEST_RESOLVED/RENDER_VERIFICATION_RESOLVED/
//   RENDER_QUALITY_ASSESSMENT_RESOLVED payloads) AND passed through to console, so a human watching
//   this long-running script gets live progress, unlike local-comparison.ts's silent capture-only
//   mock.
// - '../prisma' - CAPTURE-ONLY, never a real write. Running the real, unmodified processor against
//   an ALREADY-RENDERED clip would otherwise (a) silently no-op the DB write via the completion
//   transaction's own `outputUrl: null` optimistic-concurrency guard, while (b) still overwriting
//   the REAL `renders/${clipId}.mp4` object in MinIO at the same key - a real, undocumented side
//   effect on live dev data. clip.findUnique is seeded with this clip's REAL ownerId/title/
//   processingOptions (fetched for real in the setup step below) but a forced `outputUrl: null`, so
//   the processor's own idempotency guard (`if (existingClip.outputUrl) return early`) doesn't skip
//   the render entirely.
// - '@speedora/storage' - getObjectStream serves the REAL source video (downloaded once in setup,
//   via the REAL storage client obtained through jest.requireActual, never through the mock);
//   uploadObject captures the rendered file's local path only, never actually uploads to the real
//   `renders/` prefix. The REAL upload (to a benchmark-only prefix, never the real key) happens in a
//   separate post-run step below, again via jest.requireActual - same "mock the module for the
//   processor under test, but still reach the real implementation for setup/teardown" technique
//   '../ffmpeg' mock's `jest.requireActual` spread already established in local-comparison.ts.
// - '../ffmpeg' - real, EXCEPT 5 functions unrelated to this benchmark's own comparison
//   (thumbnail/storyboard/animated-preview/hover-preview extraction, B-roll trim/fade-prep) are
//   stubbed out purely to bound wall-clock time, same exact list local-comparison.ts already stubs.
// - '../broll' - B-roll depends on external stock-footage HTTP APIs (Pexels/Unsplash/Pixabay) whose
//   availability in this sandbox is unverified; disabled entirely (findBRollMoments -> []) rather
//   than risk an unrelated external dependency derailing a long real run. A documented scope
//   simplification, not a silent gap - see docs/ai/phase-d-benchmark.md.
//
// GRAPHRESULT IS NOT CACHED/REPLAYED ACROSS THE TWO RUNS - a deliberate simplification over the
// design this initiative's own plan originally described (capturing graphResult from the flag-off
// run and replaying it via jest.spyOn for the flag-on run, to guarantee byte-identical
// editingSuggestions input and halve LLM cost). That approach needs real jest.spyOn module-
// interception risk for a marginal cost saving on what's already a single-clip first pass; this
// harness instead runs two fully independent real invocations and reports the resulting
// editorialScore delta as expected LLM-sampling noise unless it looks large/systematic - see
// phase-d-report.ts's own "Invariant checks" section and docs/ai/phase-d-benchmark.md.
//
// ZERO PRODUCTION CODE CHANGES: this is the only new file this benchmark introduces (plus
// phase-d-report.ts, its own pure report renderer). No flag, no schema, no change to any already-
// shipped Phase A/B/C1 file.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });

import { Worker } from 'bullmq';
import type {
  EditorialDecision,
  EditPlanResult,
  FinalClipQualityAssessment,
} from '@speedora/contracts';
import type { CaptionStyle, ClipScores, TranscriptSegment } from '@speedora/shared';

jest.mock('bullmq', () => ({
  ...jest.requireActual('bullmq'),
  Worker: jest.fn(),
}));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));
jest.mock('../queues', () => ({
  generatePlatformCopyQueue: { add: jest.fn() },
  publishClipQueue: { add: jest.fn() },
}));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));
jest.mock('../notificationPublisher', () => ({ publishNotification: jest.fn() }));
jest.mock('../notificationDeliveryEnqueuer', () => ({ enqueueNotificationDelivery: jest.fn() }));

const loggerInfoMock = jest.fn();
jest.mock('../logger', () => ({
  forStage: (stage: string) => ({
    debug: jest.fn(),
    info: (...args: unknown[]) => {
      loggerInfoMock(...args);

      console.log(`[${stage}]`, ...args);
    },
    warn: (...args: unknown[]) => {
      console.warn(`[${stage}]`, ...args);
    },
    error: (...args: unknown[]) => {
      console.error(`[${stage}]`, ...args);
    },
  }),
}));

// Same 5-function-only stub as local-comparison.ts's own '../ffmpeg' mock - everything else
// (renderClip, trimCutRanges, applyReactionHolds, concatBrandSegment, probeVideoMetadata, ...) stays
// real via jest.requireActual. See this file's header comment.
jest.mock('../ffmpeg', () => ({
  ...jest.requireActual('../ffmpeg'),
  extractThumbnail: jest.fn().mockRejectedValue(new Error('disabled in Phase D benchmark harness')),
  extractBlurPlaceholder: jest
    .fn()
    .mockRejectedValue(new Error('disabled in Phase D benchmark harness')),
  extractAnimatedPreview: jest
    .fn()
    .mockRejectedValue(new Error('disabled in Phase D benchmark harness')),
  trimAndFadeInBRoll: jest
    .fn()
    .mockRejectedValue(new Error('disabled in Phase D benchmark harness')),
  fadeOutBRoll: jest.fn().mockRejectedValue(new Error('disabled in Phase D benchmark harness')),
}));

jest.mock('../broll', () => ({
  BROLL_DURATION_SECONDS: 2.5,
  BROLL_FADE_SECONDS: 0.3,
  findBRollMoments: jest.fn().mockReturnValue([]),
  downloadStockAsset: jest.fn(),
}));

let scratchDir: string;
let scratchCounter = 0;
jest.mock('../storage', () => ({
  reserveScratchPath: (prefix: string, ext: string) => {
    scratchCounter += 1;
    return Promise.resolve(path.join(scratchDir, `${prefix}-${scratchCounter}${ext}`));
  },
  cleanupTempFile: jest.fn().mockResolvedValue(undefined),
}));

// Registered once in beforeAll (setup step) to the REAL downloaded source video's local path -
// getObjectStream below serves it for both runs, never re-downloading. uploadObject captures the
// rendered file's local path (never a real upload) - see runOnce() below for how that capture is
// consumed.
let sourceFixturePath: string;
let capturedRenderedPath: string | null = null;
jest.mock('@speedora/storage', () => ({
  getObjectStream: async (key: string) => {
    if (key !== BENCHMARK_SOURCE_KEY) {
      throw new Error(`Phase D benchmark harness: unexpected storage key requested: "${key}"`);
    }
    return createReadStream(sourceFixturePath);
  },
  uploadObject: async (key: string, stream: unknown) => {
    if (key.startsWith('renders/')) {
      const filePath = (stream as { path?: string }).path;
      if (typeof filePath === 'string') capturedRenderedPath = filePath;
    }
    return undefined;
  },
}));
const BENCHMARK_SOURCE_KEY = '__phase-d-benchmark-source__';

// CAPTURE-ONLY - see this file's header comment for why a real write here would be unsafe. Seeded
// with this clip's REAL ownerId/title/processingOptions in beforeAll, but a forced outputUrl: null
// so the processor's own idempotency guard doesn't short-circuit the render.
let clipFindUniqueSeed: {
  outputUrl: null;
  hookText: string | null;
  video: { ownerId: string; title: string; processingOptions: unknown };
};
let capturedClipUpdateData: Record<string, unknown> | null = null;
const clipUpdateMock = jest.fn(async (args: { data: Record<string, unknown> }) => {
  capturedClipUpdateData = args.data;
  return {};
});
const clipFindManyMock = jest.fn().mockResolvedValue([]);
const videoFindUniqueMock = jest.fn().mockResolvedValue(null);
const inertWrite = jest.fn().mockResolvedValue({});
const transactionMock = jest.fn((arg: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[]) => {
  if (typeof arg === 'function') {
    return arg({
      clip: {
        update: (...a: [{ data: Record<string, unknown> }]) => clipUpdateMock(...a),
        findMany: clipFindManyMock,
      },
      video: { update: inertWrite },
      videoStatusEvent: { create: inertWrite },
    });
  }
  return Promise.all(arg);
});
jest.mock('../prisma', () => ({
  prisma: {
    clip: {
      findUnique: () => Promise.resolve(clipFindUniqueSeed),
      findMany: (...a: unknown[]) => clipFindManyMock(...a),
      update: (...a: [{ data: Record<string, unknown> }]) => clipUpdateMock(...a),
    },
    video: {
      update: inertWrite,
      findUnique: (...a: unknown[]) => videoFindUniqueMock(...a),
    },
    videoStatusEvent: { create: inertWrite },
    activityEvent: { create: inertWrite },
    notification: { create: inertWrite },
    notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    notificationThread: {
      create: jest.fn().mockResolvedValue({ id: 'phase-d-thread' }),
      update: jest.fn().mockResolvedValue({ id: 'phase-d-thread' }),
    },
    clipPlatformCopy: { count: jest.fn().mockResolvedValue(0), create: inertWrite },
    socialAccount: { findUnique: jest.fn().mockResolvedValue(null) },
    publishRecord: { create: inertWrite },
    // Best-effort render-graph node telemetry (packages/database's startJobExecution/
    // finishJobExecution/recordNodeExecution) - stubbed so it succeeds silently instead of
    // producing a harmless-but-noisy "failed to start JobExecution telemetry row" warning per run.
    // Telemetry doesn't influence editorialDecision/editPlan/qualityAssessment, so this is a pure
    // console-noise fix, not a correctness one.
    jobExecution: {
      create: jest.fn().mockResolvedValue({ id: 'phase-d-job-execution' }),
      update: inertWrite,
    },
    nodeExecution: { create: inertWrite },
    $transaction: (...args: [((tx: unknown) => Promise<unknown>) | Promise<unknown>[]]) =>
      transactionMock(...args),
  },
}));

// Deliberately NOT mocked (see header comment): every AI/vision detector package, '@speedora/
// reframe', '@speedora/visual-emphasis', '@speedora/subtitles', '../openai' - all real. Imported
// AFTER dotenv's config() call above (module load order matters: '../openai' reads
// process.env.OPENAI_API_KEY at module-scope construction time).
import { probeVideoMetadata, type ProbedVideoMetadata } from '../ffmpeg';
import { createRenderClipWorker } from './render-clip.worker';

const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH ?? 'ffprobe';

function isFfmpegAvailable(): boolean {
  try {
    execFileSync(FFMPEG_PATH, ['-version'], { stdio: 'ignore' });
    execFileSync(FFPROBE_PATH, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function md5OfFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash('md5').update(buffer).digest('hex');
}

// The one real clip this first pass benchmarks - the longer of the McDonald's video's 2 real
// clips (128.6s), chosen for the most editing-suggestion density among the 4 real, already-
// rendered clips in this dev DB - see docs/ai/phase-d-benchmark.md's own selection rationale.
// Overridable via argv for a future multi-clip expansion (Phase D's own documented non-goal for
// this first pass).
const BENCHMARK_CLIP_ID =
  process.argv.find((a) => a.startsWith('--clipId='))?.slice('--clipId='.length) ??
  'cmsq3ix8a028e2su80g10w5y6';

interface HarnessJobData {
  clipId: string;
  videoId: string;
  sourceUrl: string;
  startTime: number;
  endTime: number;
  transcript: TranscriptSegment[];
  captionStyle: CaptionStyle;
  keywords: string[];
  scores: ClipScores | null;
  speakerColorCaptions: boolean;
  smartSegmentation: boolean;
  dynamicCaptions: boolean;
  captionLanguage: string | null;
  fontFamily: string | null;
  watermark: null;
  intro: null;
  outro: null;
}
type FakeJob = { data: HarnessJobData; attemptsMade: number; opts: { attempts?: number } };
function fakeJob(data: HarnessJobData): FakeJob {
  return { data, attemptsMade: 0, opts: { attempts: 1 } };
}

function getProcessor() {
  createRenderClipWorker();
  const calls = (Worker as unknown as jest.Mock).mock.calls;
  return calls[calls.length - 1][1] as (job: FakeJob) => Promise<unknown>;
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) originals[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

interface RunResult {
  editorialDecision: EditorialDecision | null;
  // NOT the full EditPlanResult - captured from the mocked clip.update() call's own `data`
  // argument, which mirrors exactly what real production code persists to Clip.editPlan
  // (budget + decisions only, deliberately excluding `suggestions` - see
  // docs/ai/edit-plan-director.md's own "Wiring" section for why). A real bug in an earlier
  // version of this harness typed this as the full EditPlanResult and compared a `suggestions`
  // field that was always `undefined` on both sides - fixed by being honest about the real shape
  // here instead.
  editPlan: Omit<EditPlanResult, 'suggestions'>;
  qualityAssessment: FinalClipQualityAssessment;
  renderedPath: string;
  probe: ProbedVideoMetadata;
  checksumMd5: string;
}

async function runOnce(jobData: HarnessJobData, flagsOn: boolean): Promise<RunResult> {
  capturedClipUpdateData = null;
  capturedRenderedPath = null;

  await withEnv(
    {
      EDIT_BUDGET_ENABLED: flagsOn ? 'true' : undefined,
      EFFECT_CONFLICT_RESOLUTION_ENABLED: flagsOn ? 'true' : undefined,
    },
    async () => {
      const processor = getProcessor();
      await processor(fakeJob(jobData));
    },
  );

  if (capturedClipUpdateData === null) {
    throw new Error(
      'Phase D benchmark harness: the processor never reached its completion transaction ' +
        '(clip.update was never called) - check console output above for the real cause.',
    );
  }
  if (capturedRenderedPath === null) {
    throw new Error(
      'Phase D benchmark harness: no render output was captured by the mocked uploadObject - ' +
        'check console output above for the real cause.',
    );
  }

  const data = capturedClipUpdateData as Record<string, unknown>;
  const probe = await probeVideoMetadata(capturedRenderedPath);
  const checksumMd5 = await md5OfFile(capturedRenderedPath);

  return {
    editorialDecision: (data.editorialDecision as EditorialDecision | null | undefined) ?? null,
    editPlan: data.editPlan as Omit<EditPlanResult, 'suggestions'>,
    qualityAssessment: data.qualityAssessment as FinalClipQualityAssessment,
    renderedPath: capturedRenderedPath,
    probe,
    checksumMd5,
  };
}

const describeIfFfmpeg = isFfmpegAvailable() ? describe : describe.skip;

describeIfFfmpeg(
  'Phase D Real-Video Benchmark (real ffmpeg + real AI signals, manual-only)',
  () => {
    let clip: {
      id: string;
      videoId: string;
      startTime: number;
      endTime: number;
      captionStyle: string;
      speakerColorCaptions: boolean;
      keywords: string[];
      scores: ClipScores | null;
    };
    let video: {
      id: string;
      title: string;
      sourceUrl: string;
      processingOptions: unknown;
      ownerId: string;
    };
    let transcript: TranscriptSegment[];

    beforeAll(async () => {
      scratchDir = mkdtempSync(path.join(tmpdir(), 'speedora-phase-d-scratch-'));

      // Real setup: a SEPARATE, freshly-constructed real Prisma client and the REAL @speedora/storage
      // functions (via jest.requireActual, bypassing the mock above) - never the mocked '../prisma'/
      // '@speedora/storage' this file registers for the two harness runs themselves. See header
      // comment.
      const { createPrismaClient } = await import('@speedora/database');
      const realStorage = jest.requireActual(
        '@speedora/storage',
      ) as typeof import('@speedora/storage');
      const setupPrisma = createPrismaClient();

      const clipRow = await setupPrisma.clip.findUnique({
        where: { id: BENCHMARK_CLIP_ID },
        select: {
          id: true,
          videoId: true,
          startTime: true,
          endTime: true,
          captionStyle: true,
          speakerColorCaptions: true,
          keywords: true,
          llmFeatures: true,
          video: {
            select: {
              id: true,
              title: true,
              sourceUrl: true,
              processingOptions: true,
              ownerId: true,
            },
          },
        },
      });
      if (!clipRow || clipRow.startTime === null || clipRow.endTime === null) {
        throw new Error(
          `Phase D benchmark harness: clip "${BENCHMARK_CLIP_ID}" not found or missing startTime/endTime.`,
        );
      }
      clip = {
        id: clipRow.id,
        videoId: clipRow.videoId,
        startTime: clipRow.startTime,
        endTime: clipRow.endTime,
        captionStyle: clipRow.captionStyle,
        speakerColorCaptions: clipRow.speakerColorCaptions,
        keywords: clipRow.keywords,
        scores: clipRow.llmFeatures as ClipScores | null,
      };
      video = { ...clipRow.video, title: clipRow.video.title ?? 'Untitled' };

      const segmentRows = await setupPrisma.transcriptSegment.findMany({
        where: { videoId: clip.videoId },
        orderBy: { start: 'asc' },
      });
      const fullTranscript: TranscriptSegment[] = segmentRows.map((row) => ({
        id: row.id,
        start: row.start,
        end: row.end,
        text: row.text,
        speaker: row.speaker ?? undefined,
        emotion: row.emotion ?? undefined,
        words: Array.isArray(row.words)
          ? (row.words as unknown as TranscriptSegment['words'])
          : undefined,
        rmsDb: row.rmsDb ?? undefined,
        peakDb: row.peakDb ?? undefined,
        speakingRateWordsPerSecond: row.speakingRateWordsPerSecond ?? undefined,
        translations: (row.translations as Record<string, string> | null) ?? undefined,
      }));
      const { filterSegmentsForClip } = await import('@speedora/shared');
      transcript = filterSegmentsForClip(fullTranscript, clip.startTime, clip.endTime);

      // Real download - the ONLY network/storage call this harness makes against the real bucket
      // for the source side (the two mocked runs below never touch real storage at all).
      sourceFixturePath = path.join(scratchDir, 'source.mp4');
      const sourceStream = await realStorage.getObjectStream(video.sourceUrl);
      const outFile = createWriteStream(sourceFixturePath);
      await pipeline(sourceStream, outFile);

      await setupPrisma.$disconnect();

      console.log(
        `[Phase D setup] clip=${clip.id} video="${video.title}" window=${clip.startTime.toFixed(2)}-${clip.endTime.toFixed(2)}s ` +
          `transcriptSegments=${transcript.length} sourceBytes downloaded to ${sourceFixturePath}`,
      );
    }, 300_000);

    afterAll(() => {
      rmSync(scratchDir, { recursive: true, force: true });
    });

    it('renders the real clip twice (EDIT_BUDGET_ENABLED/EFFECT_CONFLICT_RESOLUTION_ENABLED off vs on), uploads both outputs to a benchmark-only prefix, and writes a human-review packet', async () => {
      clipFindUniqueSeed = {
        outputUrl: null,
        hookText: null,
        video: {
          ownerId: video.ownerId,
          title: video.title,
          processingOptions: video.processingOptions,
        },
      };

      const jobData: HarnessJobData = {
        clipId: clip.id,
        videoId: clip.videoId,
        sourceUrl: BENCHMARK_SOURCE_KEY,
        startTime: clip.startTime,
        endTime: clip.endTime,
        transcript,
        captionStyle: clip.captionStyle as CaptionStyle,
        keywords: clip.keywords,
        scores: clip.scores,
        speakerColorCaptions: clip.speakerColorCaptions,
        // Simplified for this first pass - not resolving the real Brand Kit watermark/intro/outro
        // chain (ClipsService's own resolveWatermark/resolveIntro/resolveOutro logic), a documented
        // scope decision (see this file's header comment and docs/ai/phase-d-benchmark.md).
        // Phase D's own question is editPlan/editorialDecision/qualityAssessment, not brand-kit
        // fidelity.
        smartSegmentation: false,
        dynamicCaptions: false,
        captionLanguage: null,
        fontFamily: null,
        watermark: null,
        intro: null,
        outro: null,
      };

      console.log('[Phase D] --- Run 1: flags OFF ---');
      const off = await runOnce(jobData, false);
      console.log('[Phase D] --- Run 2: flags ON ---');
      const on = await runOnce(jobData, true);

      // Real upload to a benchmark-only prefix (never the real renders/${clipId}.mp4 key) + real
      // short-lived presigned URLs, via the same real storage client used for the setup download.
      const realStorage = jest.requireActual(
        '@speedora/storage',
      ) as typeof import('@speedora/storage');
      const runId = new Date().toISOString().replace(/[:.]/g, '-');
      const offKey = `benchmark/phase-d/${clip.id}/${runId}/off.mp4`;
      const onKey = `benchmark/phase-d/${clip.id}/${runId}/on.mp4`;
      const PRESIGN_EXPIRY_SECONDS = 30 * 60;

      let offReviewUrl: string | null = null;
      let onReviewUrl: string | null = null;
      try {
        const offBuffer = await readFile(off.renderedPath);
        await realStorage.uploadObject(offKey, offBuffer, 'video/mp4');
        offReviewUrl = await realStorage.getPresignedDownloadUrl(offKey, PRESIGN_EXPIRY_SECONDS);
      } catch (error) {
        console.warn('[Phase D] failed to upload/presign the flag-off output', error);
      }
      try {
        const onBuffer = await readFile(on.renderedPath);
        await realStorage.uploadObject(onKey, onBuffer, 'video/mp4');
        onReviewUrl = await realStorage.getPresignedDownloadUrl(onKey, PRESIGN_EXPIRY_SECONDS);
      } catch (error) {
        console.warn('[Phase D] failed to upload/presign the flag-on output', error);
      }

      const { renderMarkdown } = await import('../scripts/phase-d-report');
      const report = {
        generatedAt: new Date().toISOString(),
        videoId: video.id,
        videoTitle: video.title,
        clipId: clip.id,
        requestedDurationSeconds: clip.endTime - clip.startTime,
        off: {
          flagState: 'off' as const,
          editorialDecision: off.editorialDecision,
          editPlan: off.editPlan,
          qualityAssessment: off.qualityAssessment,
          renderedDurationSeconds: off.probe.durationSeconds,
          checksumMd5: off.checksumMd5,
          reviewUrl: offReviewUrl,
        },
        on: {
          flagState: 'on' as const,
          editorialDecision: on.editorialDecision,
          editPlan: on.editPlan,
          qualityAssessment: on.qualityAssessment,
          renderedDurationSeconds: on.probe.durationSeconds,
          checksumMd5: on.checksumMd5,
          reviewUrl: onReviewUrl,
        },
        editorialDecisionIdentical:
          off.editorialDecision?.editorialScore === on.editorialDecision?.editorialScore,
        // NOT a comparison of off.editPlan.suggestions vs on.editPlan.suggestions -
        // Clip.editPlan's own persisted shape never includes `suggestions` at all (see
        // phase-d-report.ts's own comment on this field), so both sides would always be
        // `undefined` regardless of what actually happened - a real bug this harness's own 3rd
        // real run caught. `on.editPlan.decisions` is the real, meaningful signal instead.
        editPlanArbitrationFired: on.editPlan.decisions.length > 0,
        physicalOutputIdentical: off.checksumMd5 === on.checksumMd5,
      };

      const reportsDir = path.resolve(__dirname, '../../reports');
      await mkdir(reportsDir, { recursive: true });
      const stamp = report.generatedAt.replace(/[:.]/g, '-');
      const mdPath = path.join(reportsDir, `phase-d-benchmark-${stamp}.md`);
      const jsonPath = path.join(reportsDir, `phase-d-benchmark-${stamp}.json`);
      await writeFile(mdPath, renderMarkdown(report), 'utf-8');
      await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

      console.log(`\n[Phase D] report written to:\n  ${mdPath}\n  ${jsonPath}\n`);
      console.log(renderMarkdown(report));

      // A real, meaningful smoke assertion (this is a benchmark, not a pass/fail gate - see the
      // doc's own "no verdict rendered" framing) - both runs must have actually produced a
      // playable output, or the harness itself is broken, not the pipeline under observation.
      expect(off.probe.hasVideoStream && off.probe.hasAudioStream).toBe(true);
      expect(on.probe.hasVideoStream && on.probe.hasAudioStream).toBe(true);
      // 45 min, up from 30 - once this sandbox's model files were fixed (docs/ai/
      // phase-d-benchmark.md), every real detector actually runs to completion instead of
      // failing fast on a missing file, adding real wall-clock time. 30 min was cutting it close
      // even before that fix; a real run after it hit the old ceiling right at the final upload/
      // report-writing step (Jest tore the test environment down mid-`await`), after the render
      // itself had already succeeded - a genuine "needs more headroom" finding, not a hang.
    }, 2_700_000);
  },
);
