import {
  renderManifestSchema,
  type BuildRenderManifestInput,
  type RenderManifest,
} from '@speedora/contracts';

// Render Fidelity & Composition Execution Engine, Phase 7 - see render-manifest.ts's own module
// comment (packages/contracts) for the full scope-boundary/architectural-position reasoning. This
// module ASSEMBLES already-resolved values into one deterministic post-execution snapshot - it
// makes no new rendering decisions, recomputes no existing algorithm, calls no detector, and
// performs no I/O (no ffprobe, no filesystem, no checksum computation of its own).

// The module's fourth entry point (alongside buildEffectiveRenderConfig/buildOutputProfile/
// buildRenderPlan) - pure and synchronous, no `deps` parameter. Every field on `input` is already
// a fully-resolved value from the existing pipeline (the real post-hoc outcome, not intent - see
// this contract's own module comment on why Render Manifest has no pre-execution twin); this
// function only arranges them into RenderManifest's shape.
export function buildRenderManifest(input: BuildRenderManifestInput): RenderManifest {
  const {
    clipId,
    videoId,
    outputProfile,
    passes,
    trimApplied,
    reactionHoldInstants,
    reactionHoldDurationSeconds,
    introApplied,
    outroApplied,
    outputKey,
    sizeBytes,
    checksumMd5,
  } = input;

  const renderManifest: RenderManifest = {
    version: 1,
    clipId,
    videoId,
    execution: {
      passes,
      trimApplied,
      reactionHoldCount: reactionHoldInstants.length,
      reactionHoldDurationSeconds,
      introApplied,
      outroApplied,
    },
    expectedOutput: outputProfile,
    file: {
      outputKey,
      sizeBytes,
      checksumMd5,
    },
  };

  // Defense in depth on top of TypeScript's own static check - same "validate before returning"
  // convention every earlier phase's own build function already follows.
  return renderManifestSchema.parse(renderManifest);
}
