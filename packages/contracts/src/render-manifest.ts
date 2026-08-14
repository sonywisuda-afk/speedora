import { z } from 'zod';
import { outputProfileSchema } from './output-profile';

// Render Fidelity & Composition Execution Engine, Phase 7 (Render Manifest) - see
// render-plan.ts/render-plan-compiler.ts's own module comments for Phase 3/4's scope boundaries.
// RenderManifest is the THIRD and last thing this pipeline's own layered naming
// (EffectiveRenderConfig -> RenderPlan -> FFmpeg Compiler -> Render Manifest -> ffprobe
// verification) still owed: a deterministic, POST-EXECUTION summary of what a render actually
// did and what its delivered file is expected to look like. It is not another decision layer
// (that's RenderPlan's job) and not another execution layer (that's the FFmpeg Compiler/executor's
// job) - it is a SNAPSHOT, built once everything else has already happened, the same "assemble
// already-resolved values, decide/compute nothing new" discipline every phase before this one has
// followed.
//
// ARCHITECTURAL POSITION (why this has no pre-execution twin, unlike RenderPlan in Phase 5):
// RenderPlan needed a pre-execution variant because Phase 5's executor had to be DRIVEN by a plan
// built before any pass ran. RenderManifest's entire purpose is the opposite - describing what
// GENUINELY happened - so it only ever makes sense post-execution, built from the real outcome
// (trimApplied/reactionHoldInstants/the real executed pass list), never from intent. There is
// exactly one RenderManifest per render, always outcome-faithful.
//
// SCOPE BOUNDARY (deliberate, same discipline as every earlier phase's contract):
// - Does NOT reconcile against Clip.durationSeconds in the database - that belongs to a separate,
//   not-yet-scoped "Clip Count & Duration Precision Engine" initiative (docs/ai/
//   render-fidelity-matrix.md's own Recommendation section lists it as a distinct future item,
//   not part of Render Manifest).
// - Does NOT itself ffprobe the real uploaded file or compare it against anything - that is the
//   pipeline's own NEXT, still-unbuilt stage ("ffprobe verification" / "a real-FFmpeg verification
//   harness", the same doc's Recommendation section). `expectedOutput` below states what the file
//   SHOULD look like, given OutputProfile and everything that actually ran - it does not confirm
//   the file actually looks that way yet.
// - No new checksum/size computation - `file.sizeBytes`/`file.checksumMd5` are carried straight
//   through from values render-clip.worker.ts already computes for its own upload step
//   (computeFileMd5Hex()/stat()), never recomputed a second time.
// - `execution.passes` is a flat list of pass-name strings (e.g. `['renderClip','trimCutRanges',
//   'concatBrandSegment:start']`), the exact same shape the existing RENDER_EXECUTION_PLAN_COMPILED
//   log already uses - not the full FfmpegExecutionPlan (whose per-pass `args` are worker-local,
//   execution-only data with no cross-package meaning, and are not determinism-safe to embed here
//   the same reason RenderPlan's own overlays.broll excludes ephemeral scratch paths).

export const renderManifestExecutionSchema = z.object({
  passes: z.array(z.string()),
  trimApplied: z.boolean(),
  reactionHoldCount: z.number(),
  reactionHoldDurationSeconds: z.number(),
  introApplied: z.boolean(),
  outroApplied: z.boolean(),
});
export type RenderManifestExecution = z.infer<typeof renderManifestExecutionSchema>;

export const renderManifestFileSchema = z.object({
  outputKey: z.string(),
  sizeBytes: z.number().nonnegative(),
  checksumMd5: z.string(),
});
export type RenderManifestFile = z.infer<typeof renderManifestFileSchema>;

export const buildRenderManifestInputSchema = z.object({
  clipId: z.string(),
  videoId: z.string(),
  // Embedded verbatim, same "Phase 1/2's own objects, not rebuilt" convention RenderPlan already
  // established - see this file's own module comment.
  outputProfile: outputProfileSchema,
  passes: z.array(z.string()),
  trimApplied: z.boolean(),
  reactionHoldInstants: z.array(z.number()),
  reactionHoldDurationSeconds: z.number(),
  introApplied: z.boolean(),
  outroApplied: z.boolean(),
  outputKey: z.string(),
  sizeBytes: z.number().nonnegative(),
  checksumMd5: z.string(),
});
export type BuildRenderManifestInput = z.infer<typeof buildRenderManifestInputSchema>;

export const renderManifestSchema = z.object({
  // Bumped only on a real breaking shape change - same convention as every earlier phase's own
  // version field.
  version: z.literal(1),
  clipId: z.string(),
  videoId: z.string(),
  execution: renderManifestExecutionSchema,
  // What the delivered file SHOULD look like, given OutputProfile and the passes that actually
  // ran - see this file's own module comment for why this is a declaration, not a verified fact.
  expectedOutput: outputProfileSchema,
  file: renderManifestFileSchema,
});
export type RenderManifest = z.infer<typeof renderManifestSchema>;
