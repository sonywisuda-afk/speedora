import { z } from 'zod';
import { cropWindowSchema, ocrHighlightBoxSchema } from './reframe';
import { effectiveRenderConfigSchema } from './render-config';
import { outputProfileSchema } from './output-profile';

// Render Fidelity & Composition Execution Engine, Phase 3 (RenderPlan) - see
// render-config.ts/output-profile.ts's own module comments for Phase 1/2's scope boundaries.
// RenderPlan is NOT another configuration layer - it is a deterministic SNAPSHOT of render
// decisions the existing pipeline has already made by the time it's built. Every field here is
// assembled from values render-clip.worker.ts already computes at some point in its existing job
// handler; nothing in this contract represents a new decision, and nothing here is derived a
// second time from scratch (EffectiveRenderConfig/OutputProfile are embedded verbatim, not
// rebuilt; cropPath/reactionHoldInstants/broll come from the existing pipeline's own already-run
// computations, never recomputed).
//
// ARCHITECTURAL POSITION (why this is built LATE, unlike Phase 1/2): EffectiveRenderConfig and
// OutputProfile are resolvable right after source probing, before any AI/render-graph work runs.
// RenderPlan's own fields (cropPath, reaction hold instants, B-roll overlays) are NOT available
// that early - they only exist after the render graph has executed and the existing cuts/reframe/
// holds/B-roll computations have each run their course, several of which are interleaved with the
// CURRENT ffmpeg passes. RenderPlan is therefore built near the END of the job handler, once every
// decision it captures has actually been made - see render-clip.worker.ts's own wiring comment for
// the exact point.
//
// SCOPE BOUNDARY (deliberate, same discipline as Phase 1/2's contracts):
// - No audio normalization/ducking/fades (confirmed NOT_IMPLEMENTED anywhere in this pipeline).
// - No derived caption fields (fontSize/position/safeArea are computed inside buildAss() from
//   videoHeight, not an independently-resolved decision that exists before RenderPlan
//   construction) - EffectiveRenderConfig.captions already carries the real per-render caption
//   configuration; RenderPlan does not duplicate it into a second object.
// - No clip-generation settings (clipCount, min/maxClipDurationSeconds) - a separate concern
//   (detect-clips stage), not this one's.
// - No raw primarySubjectSamples/editingSuggestions/hookPrediction - those are the render graph's
//   OWN outputs, several steps upstream of the decisions RenderPlan actually captures (the crop
//   path buildCropPath() derived FROM primarySubjectSamples/editingSuggestions, not those inputs
//   themselves).
// - No Render Manifest, no ffprobe/final-media verification, no FFmpeg Compiler logic - those are
//   later phases' jobs (Phase 4 consumes RenderPlan to drive real ffmpeg execution; Render
//   Manifest is Phase 7's, ffprobe verification is Phase 8's - see docs/ai/render-fidelity-matrix.md
//   for the full, current phase list; this comment predates Phase 9 becoming the Clip Count &
//   Duration Precision Engine instead of verification, which had already shipped as Phase 8 by
//   the time that renumbering happened).
// - overlays.broll deliberately carries only {keyword, startTime, endTime} - never the ephemeral
//   local scratch file path (a randomUUID-based path unique to this one render attempt), which
//   would make RenderPlan non-deterministic across otherwise-identical renders of the same clip.

export const renderPlanBrollOverlaySchema = z.object({
  keyword: z.string(),
  startTime: z.number(),
  endTime: z.number(),
});
export type RenderPlanBrollOverlay = z.infer<typeof renderPlanBrollOverlaySchema>;

export const buildRenderPlanInputSchema = z.object({
  clipId: z.string(),
  videoId: z.string(),
  // Embedded verbatim - see this file's own module comment. Phase 1/2's own objects, not rebuilt.
  effectiveRenderConfig: effectiveRenderConfigSchema,
  outputProfile: outputProfileSchema,
  requestedStartTime: z.number(),
  requestedEndTime: z.number(),
  // Same shape as the existing verifyRenderedDuration()'s own params (Render Fidelity Matrix bug
  // fix #5) - trimApplied gates whether removedSeconds actually applies, rather than removedSeconds
  // alone (0 when no cuts ran vs. "cuts ran but genuinely removed 0 seconds" would otherwise be
  // indistinguishable, and the trim pass is itself best-effort/can fail independently of whether
  // cuts were computed at all).
  trimApplied: z.boolean(),
  removedSeconds: z.number(),
  reactionHoldInstants: z.array(z.number()),
  reactionHoldDurationSeconds: z.number(),
  // null means a static (non-time-varying) center crop was used for the whole clip - the same
  // meaning buildCropPath()'s own null return, and buildReframePlan()'s widened cropPath field,
  // already carry.
  cropPath: z.array(cropWindowSchema).nullable(),
  reframeHints: z.array(ocrHighlightBoxSchema),
  broll: z.array(renderPlanBrollOverlaySchema),
});
export type BuildRenderPlanInput = z.infer<typeof buildRenderPlanInputSchema>;

export const renderPlanSchema = z.object({
  // Bumped only on a real breaking shape change - same convention as EffectiveRenderConfig's own
  // version field.
  version: z.literal(1),
  clipId: z.string(),
  videoId: z.string(),
  effectiveRenderConfig: effectiveRenderConfigSchema,
  outputProfile: outputProfileSchema,
  timeline: z.object({
    requestedStartTime: z.number(),
    requestedEndTime: z.number(),
    requestedDurationSeconds: z.number(),
    // Deliberately a SEPARATE field from requestedDurationSeconds, never a single ambiguous
    // "outputDuration" - cuts shrink the final duration, reaction holds grow it, and Phase 5/9
    // will eventually need to compile against and verify the REAL final value, not the originally
    // requested one.
    effectiveDurationSeconds: z.number(),
  }),
  holds: z.object({
    reactionHoldInstants: z.array(z.number()),
    reactionHoldDurationSeconds: z.number(),
  }),
  framing: z.object({
    cropPath: z.array(cropWindowSchema).nullable(),
    reframeHints: z.array(ocrHighlightBoxSchema),
  }),
  overlays: z.object({
    broll: z.array(renderPlanBrollOverlaySchema),
    // Presence-only booleans, derived from effectiveRenderConfig.branding.{watermark,intro,outro}
    // being non-null - RenderPlan does not re-expose the full watermark/intro/outro objects a
    // second time (they're already in the embedded effectiveRenderConfig), only whether each
    // branding decision applies to this render.
    watermark: z.boolean(),
    intro: z.boolean(),
    outro: z.boolean(),
  }),
  transitions: z.object({
    // The existing, fixed CROSSFADE_SECONDS policy (apps/worker/src/ffmpeg.ts) - echoed, not
    // computed and not configurable; no per-clip transition setting exists anywhere in this
    // product today.
    crossfadeSeconds: z.number(),
  }),
});
export type RenderPlan = z.infer<typeof renderPlanSchema>;
