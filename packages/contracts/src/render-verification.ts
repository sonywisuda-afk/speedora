import { z } from 'zod';
import { renderManifestSchema } from './render-manifest';

// Render Fidelity & Composition Execution Engine, Phase 8 (ffprobe verification) - see
// render-manifest.ts's own module comment for the full pipeline context
// (EffectiveRenderConfig -> RenderPlan -> FFmpeg Compiler -> Render Manifest -> ffprobe
// verification). This is the pipeline's own last named stage: reconciling RenderManifest's
// DECLARED expectedOutput against what a REAL ffprobe of the actual delivered file reports.
//
// SCOPE BOUNDARY (deliberate, resolved via user approval, not unilaterally):
// - pixelFormat is NOT verified - apps/worker/src/ffmpeg.ts's own probeVideoMetadata() (reused
//   unchanged, never widened) does not capture it, and that function is owned by
//   probe-video.worker.ts for an unrelated purpose; widening it for this one field risked a
//   cross-worker coupling for a value that has never varied (yuv420p hardcoded everywhere).
// - duration is NOT verified - it isn't part of OutputProfile's shape at all (it lives on
//   RenderPlan.timeline, which RenderManifest deliberately doesn't embed), and is already covered
//   by the existing, separate verifyRenderedDuration() (Render Fidelity Matrix bug fix #5).
//   Reopening RenderManifest's already-shipped schema to add an expected-duration field, or
//   duplicating a working mechanism, was explicitly rejected in favor of staying narrow.
// - audioSampleRate IS verified, unlike the other two exclusions - the underlying gap that made
//   it unreliable (apps/worker/src/ffmpeg.ts's resolveAudioEncodeArgs() never set -ar) was fixed
//   as part of this same phase, not worked around or excluded - see that function's own comment.

export const renderVerificationFieldSchema = z.object({
  expected: z.union([z.string(), z.number(), z.null()]),
  actual: z.union([z.string(), z.number(), z.null()]),
  matches: z.boolean(),
});
export type RenderVerificationField = z.infer<typeof renderVerificationFieldSchema>;

// Plain, ffprobe-free probed media data - the caller (adapter) already probed this by reusing
// apps/worker/src/ffmpeg.ts's own EXISTING probeVideoMetadata() (never re-probed here, and no new
// ffprobe wrapper was written for this phase). A structural SUBSET of that function's own
// ProbedVideoMetadata return shape - packages/* can never depend on apps/worker/* (the same
// boundary render-plan-compiler.ts's own module comment already established), so this is defined
// fresh here rather than imported; the real probeVideoMetadata() result satisfies this type
// directly via structural typing, no cast needed at the call site.
export const probedMediaForVerificationSchema = z.object({
  width: z.number().nullable(),
  height: z.number().nullable(),
  fps: z.number().nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  audioSampleRate: z.number().nullable(),
  audioChannels: z.number().nullable(),
});
export type ProbedMediaForVerification = z.infer<typeof probedMediaForVerificationSchema>;

export const compareRenderManifestInputSchema = z.object({
  manifest: renderManifestSchema,
  probe: probedMediaForVerificationSchema,
});
export type CompareRenderManifestInput = z.infer<typeof compareRenderManifestInputSchema>;

export const renderVerificationResultSchema = z.object({
  version: z.literal(1),
  clipId: z.string(),
  videoId: z.string(),
  fields: z.object({
    width: renderVerificationFieldSchema,
    height: renderVerificationFieldSchema,
    fps: renderVerificationFieldSchema,
    videoCodec: renderVerificationFieldSchema,
    audioCodec: renderVerificationFieldSchema,
    audioChannels: renderVerificationFieldSchema,
    audioSampleRate: renderVerificationFieldSchema,
  }),
  // true only when every field above matches - see this contract's own module comment for exactly
  // which 7 fields are in scope and which 2 (pixelFormat, duration) are deliberately excluded.
  passed: z.boolean(),
});
export type RenderVerificationResult = z.infer<typeof renderVerificationResultSchema>;
