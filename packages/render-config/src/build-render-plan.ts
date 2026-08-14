import { renderPlanSchema, type BuildRenderPlanInput, type RenderPlan } from '@speedora/contracts';

// Render Fidelity & Composition Execution Engine, Phase 3 - see render-plan.ts's own module
// comment (packages/contracts) for the full scope-boundary/architectural-position reasoning. This
// module ASSEMBLES already-resolved values into one deterministic snapshot - it makes no new
// rendering decisions, recomputes no existing algorithm, and calls no detector.

// The existing, fixed transition policy (apps/worker/src/ffmpeg.ts's own CROSSFADE_SECONDS,
// unexported) - duplicated here rather than adding a cross-package/app dependency for one
// literal, same "duplicate the literal, note why" precedent Phase 1/2 already established
// (build-effective-render-config.ts's own aspect-ratio thresholds, build-output-profile.ts's
// ASPECT_RATIO_NUMBER map). Not configurable - no per-clip transition setting exists anywhere in
// this product today.
const CROSSFADE_SECONDS = 0.15;

// The module's third entry point (alongside buildEffectiveRenderConfig/buildOutputProfile) - pure
// and synchronous, no `deps` parameter, no DB/filesystem/ffprobe/subprocess access. Every field on
// `input` is already a fully-resolved value from the existing pipeline; this function only
// arranges them into RenderPlan's shape and computes the one genuinely derived value
// (effectiveDurationSeconds) via plain arithmetic over already-resolved numbers - not a new
// rendering decision, the same duration-accounting formula the Render Fidelity Matrix's bug fix
// #5 (verifyRenderedDuration(), apps/worker/src/workers/render-clip.worker.ts) already
// established: requested span, minus cuts actually removed (only when the trim pass actually
// ran), plus reaction-hold time actually inserted.
export function buildRenderPlan(input: BuildRenderPlanInput): RenderPlan {
  const {
    clipId,
    videoId,
    effectiveRenderConfig,
    outputProfile,
    requestedStartTime,
    requestedEndTime,
    trimApplied,
    removedSeconds,
    reactionHoldInstants,
    reactionHoldDurationSeconds,
    cropPath,
    reframeHints,
    broll,
  } = input;

  const requestedDurationSeconds = requestedEndTime - requestedStartTime;
  const effectiveDurationSeconds =
    requestedDurationSeconds - (trimApplied ? removedSeconds : 0) + reactionHoldDurationSeconds;

  const renderPlan: RenderPlan = {
    version: 1,
    clipId,
    videoId,
    effectiveRenderConfig,
    outputProfile,
    timeline: {
      requestedStartTime,
      requestedEndTime,
      requestedDurationSeconds,
      effectiveDurationSeconds,
    },
    holds: {
      reactionHoldInstants,
      reactionHoldDurationSeconds,
    },
    framing: {
      cropPath,
      reframeHints,
    },
    overlays: {
      // {keyword, startTime, endTime} only - see this contract's own module comment for why the
      // ephemeral local scratch filePath is never carried into RenderPlan (determinism).
      broll: broll.map(({ keyword, startTime, endTime }) => ({ keyword, startTime, endTime })),
      // Presence-only, derived from the embedded effectiveRenderConfig - not a second,
      // independently-resolved branding decision.
      watermark: effectiveRenderConfig.branding.watermark !== null,
      intro: effectiveRenderConfig.branding.intro !== null,
      outro: effectiveRenderConfig.branding.outro !== null,
    },
    transitions: {
      crossfadeSeconds: CROSSFADE_SECONDS,
    },
  };

  // Defense in depth on top of TypeScript's own static check - same "validate before returning"
  // convention buildEffectiveRenderConfig()/buildOutputProfile() already follow.
  return renderPlanSchema.parse(renderPlan);
}
