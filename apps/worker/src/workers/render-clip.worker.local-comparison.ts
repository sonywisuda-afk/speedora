// Render Fidelity & Composition Execution Engine - PRE-PRODUCTION REAL-OUTPUT EQUIVALENCE GATE
// (Path A, local comparison harness).
//
// WHAT THIS IS: proof that Phase 5's flag=true (compiled) execution path produces an output
// equivalent to flag=false (legacy, inline) for the SAME job, before Speedora has any real
// production deployment to canary against (docs/ai/render-fidelity-rollout.md's own Strategy A/B
// both presuppose a live deployment that does not exist yet - see that doc's own note on this
// harness). This is deliberately NOT a new feature, NOT Phase 10, and NOT itself a change to any
// production file - it is test/verification infrastructure only, built entirely on top of
// EXISTING, already-shipped seams (Phase 5's own `createRenderClipWorker()` -> mocked-`Worker`-
// capture technique already proven by render-clip.worker.spec.ts; Phase 7/8's own
// RENDER_MANIFEST_RESOLVED/RENDER_VERIFICATION_RESOLVED log lines).
//
// HOW "the same job" is actually invoked: `createRenderClipWorker()` is called for REAL (not
// reimplemented) with `bullmq`'s `Worker` constructor mocked JUST to capture the processor
// closure it's constructed with - the literal closure BullMQ would invoke in production. That one
// closure is then invoked TWICE per scenario, once with RENDER_EXECUTION_COMPILER_ENABLED unset
// and once 'true', against the exact same job.data object built from one shared fixture. There is
// no separate "legacy runner"/"compiled runner" anywhere in this file - see getProcessor() below.
//
// WHAT STAYS REAL (unlike render-clip.worker.spec.ts's own fully-mocked suite): renderClip,
// trimCutRanges, applyReactionHolds, concatBrandSegment, probeVideoMetadata,
// getVideoDimensions/getVideoFrameRateString/getAudioChannelCount/getMediaDurationSeconds (all of
// '../ffmpeg' except 5 unrelated thumbnail/B-roll-prep functions explicitly disabled below - see
// that mock's own comment for why), node:fs/node:fs/promises/node:stream/promises (real scratch
// files), '../storage' (real reserveScratchPath/cleanupTempFile), '@speedora/render-config' (real
// buildEffectiveRenderConfig/buildOutputProfile/buildRenderManifest/buildRenderPlan/
// compareRenderManifestToProbe - Phase 7/8's own real computation, never re-derived by this
// harness), and '../render-plan-compiler' (real compileRenderPlan - literally the compiled path
// under test). Every other seam (prisma, object storage's network transport, every AI/vision
// detector, B-roll asset search) is mocked deterministic/inert, the exact same "mock only the I/O
// seam" convention render-clip.worker.spec.ts already established - see each jest.mock() below for
// why.
//
// MANIFEST/VERIFICATION ARE NEVER RECOMPUTED: this harness does not re-implement Phase 7/8's own
// comparison logic. It captures each run's own RENDER_MANIFEST_RESOLVED/RENDER_VERIFICATION_RESOLVED
// log payload (via a mocked '../logger') and diffs those REAL, already-computed values against the
// sibling run's - this tests what the pipeline actually claims, not a second verifier built for
// this file alone.
//
// CHECKSUM IS DIAGNOSTIC ONLY: MD5 is captured and printed per run, but never gates PASS/FAIL -
// container metadata/encoding details can differ byte-for-byte between two semantically identical
// renders. The real gate is: resolution, fps, video codec, audio codec, audio sample rate, audio
// channels, duration (small tolerance for encoder rounding), execution pass sequence, and
// structural manifest/verification agreement.
//
// MANUAL-ONLY, NOT PART OF THE DEFAULT SUITE: this file deliberately does NOT end in `.spec.ts`
// (apps/worker's jest config testRegex is `.*\.spec\.ts$`), so `pnpm test`/`pnpm verify` never
// discovers or runs it - 5 scenarios x 2 real-ffmpeg job executions each (10 full renders) is far
// too slow/contention-prone for a per-commit suite, and this is a deliberate pre-production gate,
// not a regression test. Run it explicitly with an overridden testRegex, from apps/worker:
//
//   npx jest --testRegex "local-comparison\.ts$" --runInBand
//
// (--runInBand: this file's own scenarios already run serially against real ffmpeg; forcing Jest
// itself to stay single-worker avoids the exact CPU-contention flakiness this initiative has
// already hit more than once when a real-ffmpeg suite ran concurrently with something else.)
//
// Requires real `ffmpeg`/`ffprobe` on PATH (or FFMPEG_PATH/FFPROBE_PATH set) - skipped entirely
// (describe.skip) when unavailable, same convention as every other *.integration.spec.ts in this
// directory.
//
// ZERO PRODUCTION CODE CHANGES: this is the only new file this harness introduces. No flag, no
// schema, no database field, no API, no change to ffmpeg.ts/execute-render-plan.ts/
// render-plan-compiler.ts/render-clip.worker.ts.

import { execFile, execFileSync } from 'node:child_process';
import { createReadStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { CaptionStyle } from '@speedora/database';
import type { ClipScores, TranscriptSegment } from '@speedora/shared';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({
  ...jest.requireActual('bullmq'),
  Worker: jest.fn(),
}));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));
jest.mock('../openai', () => ({ openai: {} }));

const generatePlatformCopyQueueAddMock = jest.fn();
const publishClipQueueAddMock = jest.fn();
jest.mock('../queues', () => ({
  generatePlatformCopyQueue: {
    add: (...args: unknown[]) => generatePlatformCopyQueueAddMock(...args),
  },
  publishClipQueue: { add: (...args: unknown[]) => publishClipQueueAddMock(...args) },
}));

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

// Phase 5/7/8/9's own logging is this harness's ONLY source of manifest/verification data - see
// this file's own header comment ("MANIFEST/VERIFICATION ARE NEVER RECOMPUTED"). Captured per
// level so runOnce() below can scan for the exact RENDER_MANIFEST_RESOLVED/RENDER_VERIFICATION_RESOLVED
// calls each run produced.
const loggerInfoMock = jest.fn();
const loggerWarnMock = jest.fn();
jest.mock('../logger', () => ({
  forStage: () => ({
    debug: jest.fn(),
    info: (...args: unknown[]) => loggerInfoMock(...args),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    error: jest.fn(),
  }),
}));

// '../ffmpeg' is deliberately NOT fully mocked (unlike render-clip.worker.spec.ts) - renderClip,
// trimCutRanges, applyReactionHolds, concatBrandSegment, probeVideoMetadata,
// getVideoDimensions/getVideoFrameRateString/getAudioChannelCount/getMediaDurationSeconds, and the
// MAX_OUTPUT_AUDIO_CHANNELS/REACTION_HOLD_EXTENSION_SECONDS constants all stay real via
// jest.requireActual - this is the whole point of this harness (see the header comment's "WHAT
// STAYS REAL"). Only 5 functions unrelated to the 5-pass equivalence gate are stubbed out, purely
// to avoid ~30 extra real ffmpeg subprocess calls (thumbnail/storyboard/animated-preview/hover-
// preview extraction, B-roll trim/fade-prep) per run that neither branch's own comparison depends
// on - render-clip.worker.ts already treats every one of these as independently best-effort
// (wrapped in its own try/catch, never fails the job), so a rejection here is exactly the same
// "optional signal unavailable" path production already exercises when e.g. thumbnail extraction
// fails for any real reason.
jest.mock('../ffmpeg', () => ({
  ...jest.requireActual('../ffmpeg'),
  extractThumbnail: jest.fn().mockRejectedValue(new Error('disabled in local-comparison harness')),
  extractBlurPlaceholder: jest
    .fn()
    .mockRejectedValue(new Error('disabled in local-comparison harness')),
  extractAnimatedPreview: jest
    .fn()
    .mockRejectedValue(new Error('disabled in local-comparison harness')),
  trimAndFadeInBRoll: jest
    .fn()
    .mockRejectedValue(new Error('disabled in local-comparison harness')),
  fadeOutBRoll: jest.fn().mockRejectedValue(new Error('disabled in local-comparison harness')),
}));

// B-roll deliberately disabled entirely (not forced deterministic) - Guardrail #4: "kalau
// B-roll/reframe tidak bisa dibuat deterministik tanpa memperluas scope, jangan memaksakannya".
// findBRollMoments() returning [] means buildBRollOverlays() short-circuits before any real stock-
// asset search/download, so '../assets/stockAssetService' below never actually gets called either.
jest.mock('../broll', () => ({
  BROLL_DURATION_SECONDS: 2.5,
  BROLL_FADE_SECONDS: 0.3,
  findBRollMoments: jest.fn().mockReturnValue([]),
  downloadStockAsset: jest.fn(),
}));
jest.mock('../assets/stockAssetService', () => ({
  stockAssetService: { searchAssets: jest.fn().mockResolvedValue(null) },
}));

// buildAss() mocked to return '' (matching render-clip.worker.spec.ts's own default) - subtitlesPath
// stays null (renderClip() explicitly treats that as "no captions", not an error - see its own
// signature comment in ffmpeg.ts), sidestepping the need for a real, syntactically valid .ass
// fixture entirely. Captions are irrelevant to the 5-pass equivalence gate.
jest.mock('@speedora/subtitles', () => ({ buildAss: jest.fn().mockReturnValue('') }));

// Every AI/vision detector below is mocked the exact same "mock only the I/O seam, leave pure
// derive functions real via requireActual" way render-clip.worker.ts's OWN spec file already
// established - this harness reuses that proven scaffolding verbatim rather than inventing a
// second one. None of these affect the 5 ffmpeg execution passes under test; they only need to
// resolve to something the real render-graph orchestration can consume without crashing.
jest.mock('@speedora/scene-intelligence', () => ({
  ...jest.requireActual('@speedora/scene-intelligence'),
  detectSceneCuts: jest.fn().mockResolvedValue({ cuts: [] }),
  classifySceneCutTypes: jest.fn().mockResolvedValue({ events: [] }),
  analyzeMotionEnergy: jest.fn().mockResolvedValue({ samples: [] }),
  detectCameraMotion: jest.fn().mockResolvedValue([]),
}));
jest.mock('@speedora/facial-intelligence', () => ({
  ...jest.requireActual('@speedora/facial-intelligence'),
  detectFacialEmotion: jest.fn().mockResolvedValue([]),
  detectFaceLandmarks: jest.fn().mockResolvedValue([]),
}));
jest.mock('@speedora/gesture-intelligence', () => ({
  ...jest.requireActual('@speedora/gesture-intelligence'),
  detectGestures: jest.fn().mockResolvedValue([]),
}));
jest.mock('@speedora/ocr-intelligence', () => ({
  ...jest.requireActual('@speedora/ocr-intelligence'),
  detectOcrText: jest.fn().mockResolvedValue([]),
}));
jest.mock('@speedora/object-intelligence', () => ({
  ...jest.requireActual('@speedora/object-intelligence'),
  detectObjects: jest.fn().mockResolvedValue([]),
}));
jest.mock('@speedora/hook-prediction', () => ({
  ...jest.requireActual('@speedora/hook-prediction'),
  predictHook: jest.fn().mockResolvedValue(null),
}));
jest.mock('@speedora/semantic-events', () => ({
  ...jest.requireActual('@speedora/semantic-events'),
  detectSemanticEvents: jest.fn().mockResolvedValue(null),
}));
jest.mock('@speedora/narrative-graph', () => ({
  ...jest.requireActual('@speedora/narrative-graph'),
  buildNarrativeGraph: jest.fn().mockResolvedValue(null),
}));
jest.mock('@speedora/multimodal-reasoning', () => ({
  ...jest.requireActual('@speedora/multimodal-reasoning'),
  reasonMultimodal: jest.fn().mockResolvedValue(null),
}));

// computeEditingSuggestions is the ONE detector-layer seam this harness actively drives (not just
// stubs inert) - Scenario 3/5 below override it to inject a deterministic reaction_hold suggestion
// (real detection would need a real, statistically-significant EmotionalArc peak through 3 upstream
// derive layers - out of scope, same "don't force it" posture as B-roll). Every other feature flag
// (isFocusShiftEnabled, isPauseHoldEnabled, ...) stays real via requireActual, env-var driven.
const computeEditingSuggestionsMock = jest.fn();
jest.mock('@speedora/visual-emphasis', () => ({
  ...jest.requireActual('@speedora/visual-emphasis'),
  computeEditingSuggestions: (...args: unknown[]) => computeEditingSuggestionsMock(...args),
}));

// @speedora/reframe stays mocked (not real) - this harness makes no claim about face-detection/
// crop-path fidelity, only about the 5 ffmpeg execution passes. A fixed static center-crop
// (buildCropPath -> null) is deterministic and sufficient; computeCropDimensions/
// resolveOutputResolution's return values below are sized to fit this file's own 320x240 real
// lavfi source fixture (see makeColorClip()), the same 320x240/136x240 pairing
// render-clip.worker.spec.ts's own default fixture already uses.
jest.mock('@speedora/reframe', () => ({
  computeCropDimensions: jest.fn().mockReturnValue({ width: 136, height: 240 }),
  buildCropPath: jest.fn().mockReturnValue(null),
  buildSendCmdScript: jest.fn().mockReturnValue(''),
  findEmphasisWords: jest.fn().mockReturnValue([]),
  computeOcrHighlightBoxes: jest.fn().mockReturnValue([]),
  resolveOutputResolution: jest.fn().mockImplementation((crop: unknown) => crop),
  TARGET_ASPECT_RATIO: 9 / 16,
}));

// '@speedora/render-config' and '../render-plan-compiler' are deliberately NOT mocked - see this
// file's header comment. buildRenderManifest/compareRenderManifestToProbe's REAL output is exactly
// what this harness captures via the logger mock above; compileRenderPlan/executeCompiledRenderPlan
// are the compiled path itself.

let scratchCounter = 0;
const reserveScratchPathMock = jest.fn((prefix: string, ext: string) => {
  scratchCounter += 1;
  return Promise.resolve(path.join(scratchDir, `${prefix}-${scratchCounter}${ext}`));
});
jest.mock('../storage', () => ({
  reserveScratchPath: (...args: [string, string]) => reserveScratchPathMock(...args),
  // Real unlink would work fine too, but this harness wants every scratch file to survive until
  // its own scenario's afterEach cleans the whole scratch dir at once - see runOnce() below, which
  // independently ffprobes finalOutputPath from inside the uploadObject mock BEFORE any cleanup
  // could possibly race it.
  cleanupTempFile: jest.fn().mockResolvedValue(undefined),
}));

// getObjectStream is keyed by storage key -> a real local fixture file path (registered per
// scenario via registerFixture() below), returning a REAL fs.createReadStream - this is what makes
// sourcePath/introPath/outroPath real local files real ffmpeg can actually operate on, not mocked
// buffers. uploadObject captures + independently ffprobes the real finalOutputPath the instant it's
// called (see below) - the file is guaranteed to still exist at that point regardless of any later
// cleanup.
const fixtureFilesByKey = new Map<string, string>();
function registerFixture(key: string, filePath: string): void {
  fixtureFilesByKey.set(key, filePath);
}
const getObjectStreamMock = jest.fn(async (key: string) => {
  const filePath = fixtureFilesByKey.get(key);
  if (!filePath) {
    throw new Error(`local-comparison harness: no fixture registered for storage key "${key}"`);
  }
  return createReadStream(filePath);
});
type CapturedUpload = { key: string; probe: RealProbedVideoMetadata } | null;
let capturedUpload: CapturedUpload = null;
const uploadObjectMock = jest.fn(async (key: string, stream: unknown) => {
  if (key.startsWith('renders/')) {
    const filePath = (stream as { path?: string }).path;
    if (typeof filePath === 'string') {
      capturedUpload = { key, probe: await probeVideoMetadata(filePath) };
    }
  }
  return undefined;
});
jest.mock('@speedora/storage', () => ({
  getObjectStream: (...args: [string]) => getObjectStreamMock(...args),
  uploadObject: (...args: [string, unknown, string]) => uploadObjectMock(args[0], args[1]),
}));

jest.mock('../notificationPublisher', () => ({ publishNotification: jest.fn() }));
jest.mock('../notificationDeliveryEnqueuer', () => ({ enqueueNotificationDelivery: jest.fn() }));

const clipUpdateMock = jest.fn().mockResolvedValue({});
const clipFindManyMock = jest
  .fn()
  .mockResolvedValue([
    { id: 'harness-clip', outputUrl: 'renders/harness-clip.mp4', highlightScore: null },
  ]);
const clipFindUniqueMock = jest.fn();
const videoUpdateMock = jest.fn().mockResolvedValue({});
const videoFindUniqueMock = jest.fn();
const inertPrismaWrite = jest.fn().mockResolvedValue({});
const transactionMock = jest.fn((arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => {
  if (typeof arg === 'function') {
    return arg({
      clip: {
        update: (...a: unknown[]) => clipUpdateMock(...a),
        findMany: (...a: unknown[]) => clipFindManyMock(...a),
      },
      video: { update: (...a: unknown[]) => videoUpdateMock(...a) },
      videoStatusEvent: { create: (...a: unknown[]) => inertPrismaWrite(...a) },
    });
  }
  return Promise.all(arg);
});
jest.mock('../prisma', () => ({
  prisma: {
    clip: {
      update: (...args: unknown[]) => clipUpdateMock(...args),
      findMany: (...args: unknown[]) => clipFindManyMock(...args),
      findUnique: (...args: unknown[]) => clipFindUniqueMock(...args),
    },
    video: {
      update: (...args: unknown[]) => videoUpdateMock(...args),
      findUnique: (...args: unknown[]) => videoFindUniqueMock(...args),
    },
    videoStatusEvent: { create: (...args: unknown[]) => inertPrismaWrite(...args) },
    activityEvent: { create: (...args: unknown[]) => inertPrismaWrite(...args) },
    notification: { create: (...args: unknown[]) => inertPrismaWrite(...args) },
    notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    notificationThread: {
      create: jest.fn().mockResolvedValue({ id: 'harness-thread' }),
      update: jest.fn().mockResolvedValue({ id: 'harness-thread' }),
    },
    clipPlatformCopy: { count: jest.fn().mockResolvedValue(0), create: inertPrismaWrite },
    socialAccount: { findUnique: jest.fn().mockResolvedValue(null) },
    publishRecord: { create: inertPrismaWrite },
    $transaction: (...args: [Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)]) =>
      transactionMock(...args),
  },
}));

import { probeVideoMetadata, type ProbedVideoMetadata as RealProbedVideoMetadata } from '../ffmpeg';
import { createRenderClipWorker } from './render-clip.worker';

const execFileAsync = promisify(execFile);
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
  // Real (unmocked) buildEffectiveRenderConfig() requires every one of these fields present -
  // .nullable(), never .optional(), on packages/contracts' own effectiveRenderConfigSchema (see
  // render-config.ts) - unlike render-clip.worker.spec.ts's own local RenderClipJobData, which can
  // get away with marking them optional only because that file mocks '@speedora/render-config'
  // wholesale and this real schema never actually runs there.
  speakerColorCaptions: boolean;
  smartSegmentation: boolean;
  dynamicCaptions: boolean;
  captionLanguage: string | null;
  fontFamily: string | null;
  watermark: {
    key: string;
    opacity: number;
    scale: number;
    margin: number;
    position: 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT' | 'CENTER';
  } | null;
  intro: { key: string; type: 'video' | 'image'; imageDurationSeconds: number | null } | null;
  outro: { key: string; type: 'video' | 'image'; imageDurationSeconds: number | null } | null;
}
type FakeJob = { data: HarnessJobData; attemptsMade: number; opts: { attempts?: number } };
function fakeJob(data: HarnessJobData): FakeJob {
  return { data, attemptsMade: 0, opts: { attempts: 1 } };
}

// Same capture technique render-clip.worker.spec.ts's own getProcessor() already established -
// see this file's header comment ("HOW 'the same job' is actually invoked"). Called fresh per
// flag-state run so each gets its own Worker-mock call to read from.
function getProcessor() {
  createRenderClipWorker();
  const calls = (Worker as unknown as jest.Mock).mock.calls;
  return calls[calls.length - 1][1] as (job: FakeJob) => Promise<unknown>;
}

// Guardrail #3 - env isolation: every mutation this harness makes to process.env is restored in a
// finally block, so a thrown assertion (a genuine mismatch) can never leak flag state into a later
// scenario.
async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    originals[key] = process.env[key];
  }
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

let scratchDir: string;
let fixtureDir: string;

async function makeColorClip(
  name: string,
  color: string,
  durationSeconds: number,
  withAudio = true,
): Promise<string> {
  const clipPath = path.join(fixtureDir, name);
  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:size=320x240:rate=25:duration=${durationSeconds}`,
  ];
  if (withAudio) {
    args.push(
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:sample_rate=44100:duration=${durationSeconds}`,
    );
  }
  args.push('-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', clipPath);
  await execFileAsync(FFMPEG_PATH, args);
  return clipPath;
}

// --- Report types/printing -------------------------------------------------------------------

interface FieldResult {
  label: string;
  pass: boolean;
  detail?: string;
}

function fieldsMatch(label: string, a: unknown, b: unknown): FieldResult {
  const pass = a === b;
  return { label, pass, detail: pass ? undefined : `${String(a)} vs ${String(b)}` };
}

function printReport(scenario: string, rows: FieldResult[]): void {
  console.log(`\n${scenario}\nLEGACY vs COMPILED\n${'-'.repeat(18)}`);
  for (const row of rows) {
    const status = row.pass ? 'PASS' : `FAIL: ${row.detail ?? ''}`;

    console.log(`${row.label.padEnd(17)}${status}`);
  }
}

// --- Single-run execution ----------------------------------------------------------------------

interface RunResult {
  probe: RealProbedVideoMetadata;
  outputKey: string | null;
  checksumMd5: string | null;
  manifest: Record<string, unknown> | null;
  verification: Record<string, unknown> | null;
  passSequence: string[] | null;
}

function findLoggedPayload(event: string): Record<string, unknown> | null {
  const call = loggerInfoMock.mock.calls.find((c) => c[0] === event);
  return call ? (call[1] as Record<string, unknown>) : null;
}

async function runOnce(jobData: HarnessJobData, compilerEnabled: boolean): Promise<RunResult> {
  loggerInfoMock.mockClear();
  loggerWarnMock.mockClear();
  capturedUpload = null;

  await withEnv(
    { RENDER_EXECUTION_COMPILER_ENABLED: compilerEnabled ? 'true' : undefined },
    async () => {
      const processor = getProcessor();
      await processor(fakeJob(jobData));
    },
  );

  // TypeScript's control-flow narrowing can't see across the closure (uploadObjectMock, defined
  // elsewhere) that actually reassigns `capturedUpload`, so an `if (!capturedUpload)` guard here
  // narrows to `never` instead of the non-null branch - a direct type assertion sidesteps that
  // narrowing entirely rather than fighting it.
  if (capturedUpload === null) {
    throw new Error(
      `local-comparison harness: no render output was uploaded for clip "${jobData.clipId}" ` +
        `(compilerEnabled=${compilerEnabled}) - check loggerWarnMock output above for the real cause`,
    );
  }
  const upload = capturedUpload as { key: string; probe: RealProbedVideoMetadata };
  const manifestPayload = findLoggedPayload('RENDER_MANIFEST_RESOLVED');
  const verificationPayload = findLoggedPayload('RENDER_VERIFICATION_RESOLVED');
  const manifest = (manifestPayload?.renderManifest as Record<string, unknown> | undefined) ?? null;
  const verification =
    (verificationPayload?.renderVerification as Record<string, unknown> | undefined) ?? null;
  const execution = manifest?.execution as { passes?: string[] } | undefined;
  const file = manifest?.file as { checksumMd5?: string } | undefined;

  return {
    probe: upload.probe,
    outputKey: upload.key,
    checksumMd5: file?.checksumMd5 ?? null,
    manifest,
    verification,
    passSequence: execution?.passes ?? null,
  };
}

// --- Comparison --------------------------------------------------------------------------------

const DURATION_TOLERANCE_SECONDS = 0.2; // encoder/rounding tolerance only - see guardrail #6.

function compareRuns(scenario: string, legacy: RunResult, compiled: RunResult): boolean {
  const rows: FieldResult[] = [
    fieldsMatch(
      'Resolution',
      `${legacy.probe.width}x${legacy.probe.height}`,
      `${compiled.probe.width}x${compiled.probe.height}`,
    ),
    fieldsMatch('FPS', legacy.probe.fps, compiled.probe.fps),
    fieldsMatch('Video codec', legacy.probe.videoCodec, compiled.probe.videoCodec),
    fieldsMatch('Audio codec', legacy.probe.audioCodec, compiled.probe.audioCodec),
    fieldsMatch('Audio rate', legacy.probe.audioSampleRate, compiled.probe.audioSampleRate),
    fieldsMatch('Audio channels', legacy.probe.audioChannels, compiled.probe.audioChannels),
    {
      label: 'Duration',
      pass:
        Math.abs(legacy.probe.durationSeconds - compiled.probe.durationSeconds) <=
        DURATION_TOLERANCE_SECONDS,
      detail: `${legacy.probe.durationSeconds.toFixed(2)} vs ${compiled.probe.durationSeconds.toFixed(2)}`,
    },
    {
      label: 'Pass sequence',
      pass: JSON.stringify(legacy.passSequence) === JSON.stringify(compiled.passSequence),
      detail: `${JSON.stringify(legacy.passSequence)} vs ${JSON.stringify(compiled.passSequence)}`,
    },
    {
      label: 'Manifest',
      pass:
        JSON.stringify(legacy.manifest?.execution) ===
          JSON.stringify(compiled.manifest?.execution) &&
        JSON.stringify(legacy.manifest?.expectedOutput) ===
          JSON.stringify(compiled.manifest?.expectedOutput),
    },
    {
      // Consistency between the two branches is the actual equivalence gate here (Guardrail's own
      // acceptance criterion: "Verification result -> consistent") - NOT "both individually PASS".
      // Phase 8's own compareRenderManifestToProbe() can legitimately fail on both sides equally
      // for a reason unrelated to compiled-vs-legacy divergence (e.g. a real fps rounding artifact
      // after several chained re-encodes); that's a Phase 8 finding to audit separately, not
      // evidence the compiled executor disagrees with the legacy path. A DIFFERING passed value
      // between the two branches is what would actually indicate real divergence.
      label: 'Verification',
      pass: legacy.verification?.passed === compiled.verification?.passed,
      detail: `legacy.passed=${String(legacy.verification?.passed)} compiled.passed=${String(compiled.verification?.passed)}`,
    },
    {
      label: 'Playable output',
      pass:
        legacy.probe.hasVideoStream &&
        legacy.probe.hasAudioStream &&
        compiled.probe.hasVideoStream &&
        compiled.probe.hasAudioStream,
    },
  ];
  printReport(scenario, rows);

  console.log(`  legacy passes:   ${JSON.stringify(legacy.passSequence)}`);

  console.log(`  compiled passes: ${JSON.stringify(compiled.passSequence)}`);

  console.log(
    `Checksum (diagnostic only, not a gate): legacy=${legacy.checksumMd5} compiled=${compiled.checksumMd5}`,
  );
  // Diagnostic only (never a gate on its own - see the 'Verification' row's comment) - surfaces
  // exactly which field(s) Phase 8's own compareRenderManifestToProbe() flagged, whenever either
  // run's verification.passed came back false, so a real (if orthogonal) finding is never silent.
  for (const [label, run] of [
    ['legacy', legacy],
    ['compiled', compiled],
  ] as const) {
    if (run.verification?.passed === false) {
      const failingFields = Object.entries(
        (run.verification.fields as Record<string, unknown>) ?? {},
      )
        .filter(([, field]) => (field as { matches?: boolean })?.matches === false)
        .map(([fieldName, field]) => `${fieldName}: ${JSON.stringify(field)}`);

      console.log(
        `  [diagnostic] ${label} run's own Phase 8 verification failed on: ${failingFields.join(', ')}`,
      );
    }
  }
  return rows.every((row) => row.pass);
}

// --- Scenarios -----------------------------------------------------------------------------------

const describeIfFfmpeg = isFfmpegAvailable() ? describe : describe.skip;

describeIfFfmpeg(
  'Render Fidelity Pre-Production Equivalence Gate (real ffmpeg, manual-only)',
  () => {
    let sourcePath: string;
    let introPath: string;
    let outroPath: string;

    beforeAll(async () => {
      fixtureDir = mkdtempSync(path.join(tmpdir(), 'speedora-fidelity-fixtures-'));
      // 12s source - comfortably covers every scenario's endTime below.
      sourcePath = await makeColorClip('source.mp4', 'blue', 12);
      introPath = await makeColorClip('intro.mp4', 'green', 1);
      outroPath = await makeColorClip('outro.mp4', 'red', 1);
      registerFixture('harness/source.mp4', sourcePath);
      registerFixture('harness/intro.mp4', introPath);
      registerFixture('harness/outro.mp4', outroPath);
    }, 60_000);

    afterAll(() => {
      rmSync(fixtureDir, { recursive: true, force: true });
    });

    beforeEach(() => {
      scratchDir = mkdtempSync(path.join(tmpdir(), 'speedora-fidelity-scratch-'));
      scratchCounter = 0;
      jest.clearAllMocks();
      // clearAllMocks() wipes call history only, not implementations set via mockResolvedValue -
      // but a handful of mocks in this file use a plain jest.fn() factory INSIDE their jest.mock()
      // call (no persistent default configured elsewhere), so they're re-asserted here every test,
      // same defensive convention render-clip.worker.spec.ts's own beforeEach already established.
      clipFindUniqueMock.mockResolvedValue({
        outputUrl: null,
        hookText: null,
        video: { ownerId: 'harness-user', title: 'Harness Video', processingOptions: null },
      });
      clipFindManyMock.mockResolvedValue([
        { id: 'harness-clip', outputUrl: 'renders/harness-clip.mp4', highlightScore: null },
      ]);
      videoFindUniqueMock.mockResolvedValue({
        status: 'CLIPS_DETECTED',
        ownerId: 'harness-user',
        title: 'Harness Video',
      });
      computeEditingSuggestionsMock.mockImplementation(
        jest.requireActual('@speedora/visual-emphasis').computeEditingSuggestions,
      );
    });

    afterEach(() => {
      rmSync(scratchDir, { recursive: true, force: true });
    });

    async function runScenario(
      name: string,
      buildJobData: (base: HarnessJobData) => HarnessJobData,
      envOverrides: Record<string, string | undefined> = {},
    ): Promise<void> {
      const base: HarnessJobData = {
        clipId: `harness-${name.replace(/\s+/g, '-').toLowerCase()}`,
        videoId: 'harness-video',
        sourceUrl: 'harness/source.mp4',
        startTime: 0,
        endTime: 5,
        transcript: [],
        captionStyle: CaptionStyle.DEFAULT,
        keywords: [],
        scores: null,
        speakerColorCaptions: false,
        smartSegmentation: false,
        dynamicCaptions: false,
        captionLanguage: null,
        fontFamily: null,
        watermark: null,
        intro: null,
        outro: null,
      };
      const jobData = buildJobData(base);

      const [legacy, compiled] = await withEnv(envOverrides, async () => [
        await runOnce(jobData, false),
        await runOnce(jobData, true),
      ]);

      const overallPass = compareRuns(name, legacy, compiled);
      expect(overallPass).toBe(true);
    }

    // Scenario 1 - Minimal: renderClip only, no cuts/holds/branding. Word coverage deliberately
    // spans almost the WHOLE clip (not just its first second) - computeSilenceCuts() cuts a
    // trailing gap past the last word too (own MIN_SILENCE_GAP_SECONDS=0.7 threshold,
    // packages/cutlist/src/cutlist.ts), so a transcript covering only the first ~1s of a 5s clip
    // would silently ALSO trigger trimCutRanges via that trailing gap - caught for real the first
    // time this harness ran (its own pass-sequence diagnostic showed trimCutRanges firing when this
    // scenario's name promised renderClip only).
    it('Minimal (renderClip only)', async () => {
      await runScenario('Minimal', (base) => ({
        ...base,
        endTime: 5,
        transcript: [
          {
            start: 0.2,
            end: 4.8,
            text: 'hello there world today',
            words: [
              { word: 'hello', start: 0.2, end: 2.4 },
              { word: 'world', start: 2.5, end: 4.8 },
            ],
          },
        ] as unknown as TranscriptSegment[],
      }));
    }, 120_000);

    // Scenario 2 - Cuts: a real transcript-driven silence gap forces trimCutRanges.
    it('Cuts (renderClip + trimCutRanges)', async () => {
      await runScenario('Cuts', (base) => ({
        ...base,
        endTime: 8,
        transcript: [
          {
            start: 0.5,
            end: 1.0,
            text: 'hello',
            words: [{ word: 'hello', start: 0.5, end: 1.0 }],
          },
          {
            start: 5.0,
            end: 7.8,
            text: 'world again now',
            words: [{ word: 'world', start: 5.0, end: 7.8 }],
          },
        ] as unknown as TranscriptSegment[],
      }));
    }, 120_000);

    // Scenario 3 - Reaction hold: a deterministic injected reaction_hold suggestion forces
    // applyReactionHolds, no cuts involved. Word coverage spans the whole clip (same "no trailing
    // gap" fix as Scenario 1 - a stray trailing cut here would remap the reaction_hold instant to
    // null via remapTimestamp(), silently eating the very pass this scenario exists to force; caught
    // for real the first time this harness ran).
    it('Reaction hold (renderClip + applyReactionHolds)', async () => {
      computeEditingSuggestionsMock.mockReturnValue([
        {
          technique: 'reaction_hold',
          start: 3.0,
          end: 3.4,
          score: 0.9,
          reason: 'harness fixture peak',
        },
      ]);
      await runScenario(
        'Reaction hold',
        (base) => ({
          ...base,
          endTime: 8,
          transcript: [
            {
              start: 0.2,
              end: 7.8,
              text: 'hello there world today friend',
              words: [
                { word: 'hello', start: 0.2, end: 3.9 },
                { word: 'world', start: 4.0, end: 7.8 },
              ],
            },
          ] as unknown as TranscriptSegment[],
        }),
        { VISUAL_EMPHASIS_REACTION_HOLD_ENABLED: 'true' },
      );
    }, 120_000);

    // Scenario 4 - Intro + outro: real branding assets force both concatBrandSegment positions, no
    // cuts involved (same "no trailing gap" fix as Scenario 1).
    it('Intro + outro (renderClip + concatBrandSegment:start + concatBrandSegment:end)', async () => {
      await runScenario('Intro + outro', (base) => ({
        ...base,
        endTime: 5,
        transcript: [
          {
            start: 0.2,
            end: 4.8,
            text: 'hello there world today',
            words: [
              { word: 'hello', start: 0.2, end: 2.4 },
              { word: 'world', start: 2.5, end: 4.8 },
            ],
          },
        ] as unknown as TranscriptSegment[],
        intro: { key: 'harness/intro.mp4', type: 'video', imageDurationSeconds: null },
        outro: { key: 'harness/outro.mp4', type: 'video', imageDurationSeconds: null },
      }));
    }, 120_000);

    // Scenario 5 - Full pipeline: cuts + reaction hold + intro + outro together, forcing all 5
    // execution passes (renderClip -> trimCutRanges -> applyReactionHolds ->
    // concatBrandSegment:start -> concatBrandSegment:end) - see this file's header comment and
    // Guardrail #4. B-roll/reframe deliberately not forced (bonus, not the acceptance criterion).
    it('Full pipeline (all 5 execution passes)', async () => {
      // Reaction-hold window placed AFTER the silence gap below (in the ORIGINAL, pre-cut
      // timeline) so its remapped post-cut instant survives (see this file's header comment's
      // worked timing: cut [1.15,4.85], instant remaps to 3.5 of a 6.3s post-cut duration).
      computeEditingSuggestionsMock.mockReturnValue([
        {
          technique: 'reaction_hold',
          start: 7.0,
          end: 7.4,
          score: 0.9,
          reason: 'harness fixture peak',
        },
      ]);
      await runScenario(
        'Full pipeline',
        (base) => ({
          ...base,
          endTime: 10,
          transcript: [
            {
              start: 0.5,
              end: 1.0,
              text: 'hello',
              words: [{ word: 'hello', start: 0.5, end: 1.0 }],
            },
            {
              start: 5.0,
              end: 9.5,
              text: 'world again right now',
              words: [{ word: 'world', start: 5.0, end: 9.5 }],
            },
          ] as unknown as TranscriptSegment[],
          intro: { key: 'harness/intro.mp4', type: 'video', imageDurationSeconds: null },
          outro: { key: 'harness/outro.mp4', type: 'video', imageDurationSeconds: null },
        }),
        { VISUAL_EMPHASIS_REACTION_HOLD_ENABLED: 'true' },
      );
    }, 180_000);
  },
);
