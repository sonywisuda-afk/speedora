import {
  outputProfileSchema,
  type BuildOutputProfileInput,
  type OutputProfile,
  type ResolvedAspectRatioLabel,
} from '@speedora/contracts';
import { computeCropDimensions, resolveOutputResolution } from '@speedora/reframe';

// Render Fidelity & Composition Execution Engine, Phase 2 - see output-profile.ts's own module
// comment (packages/contracts) for the full scope-boundary reasoning. Reuses @speedora/reframe's
// own computeCropDimensions()/resolveOutputResolution() rather than re-deriving that geometry -
// these are the SAME functions render-clip.worker.ts's computeReframeDimensions() already calls
// today (see that function's own comment), already real-ffmpeg-verified. This module exists to
// give their output ONE canonical shape (OutputProfile), not a second resolution algorithm.

// EffectiveRenderConfig (Phase 1) deliberately only carries the resolved aspect ratio LABEL, not
// the numeric ratio computeCropDimensions()/resolveOutputResolution() need - this is the same
// label -> ratio mapping render-clip.worker.ts's own resolveTargetAspectRatio() switch already
// uses for each of its 5 explicit-pin cases (the 'auto' branch doesn't apply here - Phase 1 has
// already resolved 'auto' down to one of these 5 concrete labels by the time EffectiveRenderConfig
// exists).
const ASPECT_RATIO_NUMBER: Record<ResolvedAspectRatioLabel, number> = {
  '9:16': 9 / 16,
  '16:9': 16 / 9,
  '1:1': 1,
  '4:5': 4 / 5,
  '4:3': 4 / 3,
};

// The module's second entry point (alongside buildEffectiveRenderConfig) - pure and synchronous,
// no `deps` parameter, no ffprobe/subprocess/DB/filesystem access. `sourceMedia` is plain data the
// adapter already resolved - see BuildOutputProfileInput's own comment (packages/contracts) for
// what each field is expected to already represent (an already-clamped audioChannels, the fixed
// BRAND_SEGMENT_AUDIO_SAMPLE_RATE constant for audioSampleRate, and so on).
export function buildOutputProfile(input: BuildOutputProfileInput): OutputProfile {
  const { effectiveRenderConfig, sourceMedia } = input;

  const targetAspectRatio = ASPECT_RATIO_NUMBER[effectiveRenderConfig.output.aspectRatio];
  const crop = computeCropDimensions(sourceMedia.width, sourceMedia.height, targetAspectRatio);
  const resolutionTier = effectiveRenderConfig.output.resolutionTier;
  const resolved = resolveOutputResolution(crop, targetAspectRatio, resolutionTier);

  const outputProfile: OutputProfile = {
    aspectRatio: effectiveRenderConfig.output.aspectRatio,
    width: resolved.width,
    height: resolved.height,
    // null (no resolutionTier configured) -> 'natural', the exact same "no normalization policy"
    // case resolveOutputResolution() itself already treats as "return crop unchanged" - not a
    // new policy invented here, just this contract's own name for that existing case.
    resolutionPreset: resolutionTier ?? 'natural',
    // Verbatim, no crossfade-safety floor, no forced downconversion - see this module's own
    // header comment and output-profile.ts's module comment for why.
    fps: sourceMedia.frameRate,
    videoCodec: 'libx264',
    audioCodec: 'aac',
    pixelFormat: 'yuv420p',
    qualityPreset: effectiveRenderConfig.output.qualityPreset,
    qualityCrf: effectiveRenderConfig.output.quality?.crf ?? null,
    // Passed straight through from sourceMedia - no clamping/conversion performed here (see
    // sourceMediaCharacteristicsSchema's own comment for why that's the adapter's job, already
    // done once, not re-done here).
    audioSampleRate: sourceMedia.audioSampleRate,
    audioChannels: sourceMedia.audioChannels,
  };

  // Defense in depth on top of TypeScript's own static check - same "validate before returning"
  // convention buildEffectiveRenderConfig()/every other JSON-contract module already follows.
  return outputProfileSchema.parse(outputProfile);
}
