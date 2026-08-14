import {
  renderVerificationResultSchema,
  type ProbedMediaForVerification,
  type RenderManifest,
  type RenderVerificationField,
  type RenderVerificationResult,
} from '@speedora/contracts';

// Render Fidelity & Composition Execution Engine, Phase 8 (ffprobe verification) - see
// render-verification.ts's own module comment (packages/contracts) for the full scope-boundary
// reasoning. This module COMPARES already-resolved values - it performs no I/O of any kind (no
// DB, no filesystem, no ffprobe, no subprocess, no network). The caller (adapter) is responsible
// for having already probed the real final file via apps/worker/src/ffmpeg.ts's own EXISTING
// probeVideoMetadata() - this function never probes anything itself.

// Deterministic encoder-name -> ffprobe codec_name mapping - direct string comparison would
// always fail otherwise (OutputProfile.videoCodec stores the ENCODER name, ffprobe reports the
// BITSTREAM codec name for what that encoder actually produced). Confirmed against real ffmpeg
// 8.1.2, not assumed - apps/worker/src/ffmpeg.output-profile.integration.spec.ts:335/382/402/417
// already proves a stream encoded with `-c:v libx264` reports codec_name 'h264', and `-c:a aac`
// already reports 'aac' directly (identity - kept in the table anyway for one uniform lookup path
// rather than a special case).
const CODEC_NAME_BY_ENCODER: Record<string, string> = {
  libx264: 'h264',
  aac: 'aac',
};

function normalizeCodecName(encoderName: string): string {
  return CODEC_NAME_BY_ENCODER[encoderName] ?? encoderName;
}

// Duplicated from apps/worker/src/ffmpeg.ts's own private parseFrameRate() - packages/* can never
// depend on apps/worker/* (the same boundary render-plan-compiler.ts's own module comment already
// established). Same "duplicate the small thing, note why" precedent as CROSSFADE_SECONDS/
// EXPORT_QUALITY_PRESETS elsewhere in this initiative - a 5-line pure fraction parser, not worth a
// cross-package dependency. Identical algorithm, so parsing OutputProfile's own "num/den" fps
// string here produces the exact same decimal probeVideoMetadata() already computed internally
// for the probe's own `fps` field - an apples-to-apples comparison by construction.
function parseFrameRateFraction(value: string | null): number | null {
  if (!value) return null;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

// Float-precision safety margin only, NOT a real tolerance policy (unlike
// verifyRenderedDuration()'s own DURATION_VERIFICATION_TOLERANCE_SECONDS, a deliberate
// seconds-scale allowance for real accumulation). Both sides here are produced by the identical
// num/den -> decimal division (see parseFrameRateFraction()'s own comment), so this only ever
// absorbs IEEE754 rounding noise, never a genuine frame-rate drift - a real mismatch (e.g. 30 vs.
// 29.97) is orders of magnitude larger than this margin and always still fails.
const FPS_COMPARISON_EPSILON = 0.001;

function compareField(
  expected: string | number | null,
  actual: string | number | null,
  matches: boolean,
): RenderVerificationField {
  return { expected, actual, matches };
}

// The module's single entry point - pure and synchronous, no `deps` parameter. Every field on
// `manifest`/`probe` is already a fully-resolved value from the existing pipeline
// (RenderManifest itself, Phase 7; the probe, from the adapter's own probeVideoMetadata() call);
// this function only compares them field by field and computes one boolean (`passed`) via plain
// logic - not a new rendering decision, not a new detection algorithm.
export function compareRenderManifestToProbe(
  manifest: RenderManifest,
  probe: ProbedMediaForVerification,
): RenderVerificationResult {
  const expected = manifest.expectedOutput;

  const expectedFps = parseFrameRateFraction(expected.fps);
  const fpsMatches =
    expectedFps === null || probe.fps === null
      ? expectedFps === probe.fps
      : Math.abs(expectedFps - probe.fps) <= FPS_COMPARISON_EPSILON;

  const expectedVideoCodec = normalizeCodecName(expected.videoCodec);
  const expectedAudioCodec = normalizeCodecName(expected.audioCodec);

  const fields = {
    width: compareField(expected.width, probe.width, expected.width === probe.width),
    height: compareField(expected.height, probe.height, expected.height === probe.height),
    fps: compareField(expectedFps, probe.fps, fpsMatches),
    videoCodec: compareField(
      expectedVideoCodec,
      probe.videoCodec,
      expectedVideoCodec === probe.videoCodec,
    ),
    audioCodec: compareField(
      expectedAudioCodec,
      probe.audioCodec,
      expectedAudioCodec === probe.audioCodec,
    ),
    audioChannels: compareField(
      expected.audioChannels,
      probe.audioChannels,
      expected.audioChannels === probe.audioChannels,
    ),
    audioSampleRate: compareField(
      expected.audioSampleRate,
      probe.audioSampleRate,
      expected.audioSampleRate === probe.audioSampleRate,
    ),
  };

  const passed = Object.values(fields).every((field) => field.matches);

  const result: RenderVerificationResult = {
    version: 1,
    clipId: manifest.clipId,
    videoId: manifest.videoId,
    fields,
    passed,
  };

  // Defense in depth on top of TypeScript's own static check - same "validate before returning"
  // convention every earlier phase's own build/compare function already follows.
  return renderVerificationResultSchema.parse(result);
}
