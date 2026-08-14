import { totalCutSeconds } from '@speedora/cutlist';
import {
  applyReactionHolds,
  concatBrandSegment,
  REACTION_HOLD_EXTENSION_SECONDS,
  renderClip,
  trimCutRanges,
} from './ffmpeg';
import { forStage } from './logger';
import type { FfmpegExecutionPlan } from './render-plan-compiler';

const logger = forStage('render-clip');

// Render Fidelity & Composition Execution Engine, Phase 5 (Cutover) - see
// docs/ai/render-fidelity-matrix.md and render-plan-compiler.ts's own module comment for the
// full initiative context. This file is the EXECUTION half of the architecture Phase 4 built the
// COMPILATION half for:
//
//   RenderPlan -> compileRenderPlan() -> FfmpegExecutionPlan -> executeCompiledRenderPlan() ->
//   existing ffmpeg.ts functions -> final output
//
// compileRenderPlan() (render-plan-compiler.ts) stays exactly as Phase 4 shipped it - pure,
// deterministic, no I/O, `import type`-only ffmpeg.ts imports so it structurally cannot execute
// anything. This file is the deliberate opposite: it DOES import the real ffmpeg.ts functions
// (value imports, not type-only) and DOES perform real I/O - that's its entire job. The feature
// flag that decides whether this file's own executeCompiledRenderPlan() ever actually RUNS lives
// at the call site in render-clip.worker.ts, not here and not in the compiler - this file itself
// has no opinion about whether it should be used, only about how to run a plan once it's asked to.
//
// FAILURE SEMANTICS - preserves render-clip.worker.ts's own pre-Phase-5 inline behavior exactly,
// pass by pass:
//   - renderClip (pass 1) is REQUIRED, same as it always was: no try/catch here, matching the
//     inline path's own unhandled-throw-propagates-to-the-job's-outer-try/catch behavior. A
//     failure here has always failed (and retried, per BullMQ's own attempts/backoff) the whole
//     render-clip job - this file does not change that.
//   - trimCutRanges/applyReactionHolds/concatBrandSegment (every other pass) are OPTIONAL,
//     best-effort, exactly as the inline `if (...) { try { ... } catch (error) { logger.warn(...) } }`
//     blocks they replace always were: a failure is caught, logged (the SAME log messages/fields
//     the inline code already used, so nothing downstream that greps/aggregates on those strings
//     needs to change), and execution falls back to whatever the previous successful pass already
//     produced - the render still completes and uploads, just without that one optional
//     improvement. This is NOT a new "best-effort rendering path" - it is the SAME one the inline
//     code has always had, carried forward pass-for-pass, never loosened or tightened.
//
// KNOWN GAP #1 (cuts) RESOLUTION, extended for Phase 5: Phase 4 already resolved "where does
// CutRange[] live" (CompilerResolvedInputs, not RenderPlan). Phase 5 surfaced a SECOND, related
// question Phase 4 never had to answer because it only ever compiled a plan AFTER real execution
// already happened: RenderPlan.holds.reactionHoldInstants is, by Phase 3's own already-approved
// design, an OUTCOME field ("only reflects success" - see packages/contracts/src/render-plan.ts).
// Driving execution FROM a plan needs the opposite - INTENT, known BEFORE any pass has run. That
// tension is resolved entirely in render-clip.worker.ts's own call site (see its own comment at
// the Phase 5 branch), not in this file or in render-plan-compiler.ts: the caller builds a
// SEPARATE, pre-execution RenderPlan instance (using intent-shaped inputs for
// trimApplied/reactionHoldInstants/reactionHoldDurationSeconds) purely to drive this file's own
// executeCompiledRenderPlan(), then - once this function returns the REAL outcome - builds the
// SAME, unmodified, outcome-faithful RenderPlan render-clip.worker.ts has always built, in the
// exact position it has always built it, for RENDER_PLAN_RESOLVED/verifyRenderedDuration/the
// post-hoc RENDER_EXECUTION_PLAN_COMPILED log. RenderPlan's own Phase 3 contract and semantics are
// never modified - this file only ever consumes an already-compiled FfmpegExecutionPlan, agnostic
// to which of the caller's two RenderPlan instances produced it.
export interface RenderExecutionOutcome {
  // Post reaction-hold, pre-intro/outro - the SAME thing render-clip.worker.ts's own
  // `renderedPath` local has always meant (thumbnail/blur-placeholder/storyboard extraction read
  // this, not finalOutputPath, so the gallery card matches the clip's own highlight content, not
  // a generic intro/outro card).
  renderedPath: string;
  // Post intro/outro (or equal to renderedPath when neither ran) - the SAME thing
  // render-clip.worker.ts's own `finalOutputPath` local has always meant (MD5/upload read this).
  finalOutputPath: string;
  // Real outcome, not intent - true only if trimCutRanges() actually succeeded, mirroring the
  // inline path's own `trimApplied` local exactly.
  trimApplied: boolean;
  // Real outcome, not intent - [] unless applyReactionHolds() actually succeeded, mirroring the
  // inline path's own `reactionHoldInstants` local exactly (Phase 3's "only reflects success"
  // convention, preserved here at the OUTCOME level even though the plan that drove this
  // execution may have been built from INTENT - see this file's own KNOWN GAP #1 note above).
  reactionHoldDurationSeconds: number;
  reactionHoldInstants: number[];
}

// Worker-local, execution-boundary-only flag - follows this codebase's established convention
// (packages/fusion-ml/src/feature-flags.ts's isFusionV3Enabled(), packages/hook-prediction's own
// feature-flags.ts, etc.): a boolean env var, read lazily (function body, not a module-level
// const) so it isn't captured before dotenv's config() call runs elsewhere in the process - the
// same load-order-safety reason every other isXEnabled() in this codebase reads process.env
// lazily. Unlike every one of those, this flag has no natural package to live in - it doesn't
// gate a package's own derive function, it gates which of TWO ALREADY-EXISTING, 100%
// worker-local code paths (render-clip.worker.ts's own inline ffmpeg.ts calls vs. this file's
// executeCompiledRenderPlan()) actually runs - so it's colocated here, with the feature it gates,
// the same way each package colocates its own isXEnabled() with its own feature.
//
// Default OFF, non-negotiable per this phase's own approval: when unset (or anything other than
// the literal string 'true'), render-clip.worker.ts's pre-existing inline execution remains the
// actual, only production path - zero behavior change. Turning this on in production, any
// canary/staged rollout, and eventual deletion of the legacy inline path are a later, separately
// requested phase - this flag exists so that phase has a lever to pull, not to pull it itself.
export function isRenderExecutionCompilerEnabled(): boolean {
  return process.env.RENDER_EXECUTION_COMPILER_ENABLED === 'true';
}

// The module's single entry point. Executes `plan.passes` in exact array order (array position
// IS execution order, per FfmpegExecutionPlan's own contract - see render-plan-compiler.ts), each
// pass calling the exact same, unchanged ffmpeg.ts function the pre-Phase-5 inline code already
// called, with the exact args render-plan-compiler.ts already assembled (Phase 4's own regression
// suite proved these args match what the inline code threads through). No rendering algorithm is
// reimplemented here - every crop-math/xfade/tpad-freeze/ASS/B-roll-search computation stays
// exactly where it already lives, inside ffmpeg.ts's own functions and their upstream callers.
export async function executeCompiledRenderPlan(
  plan: FfmpegExecutionPlan,
): Promise<RenderExecutionOutcome> {
  const { clipId } = plan;
  // Tracks whatever the MOST RECENT pass (successful or not) actually produced - seeded by
  // renderClip's own unconditional first pass, exactly like the inline path's own
  // `let renderedPath = outputPath;` seed.
  let currentPath = '';
  let renderedPath = '';
  let trimApplied = false;
  let reactionHoldInstants: number[] = [];
  let reactionHoldDurationSeconds = 0;

  for (const compiledPass of plan.passes) {
    switch (compiledPass.pass) {
      case 'renderClip': {
        // REQUIRED - see this file's own module comment. No try/catch: an unhandled throw
        // propagates straight out of this function, exactly like the inline path's own
        // unwrapped `await renderClip({...})` call always has.
        await renderClip(compiledPass.args);
        currentPath = compiledPass.args.outputPath;
        renderedPath = currentPath;
        break;
      }
      case 'trimCutRanges': {
        // OPTIONAL, best-effort - see this file's own module comment. Same try/catch/fallback/
        // log shape as the inline path's own `if (cuts.length > 0) { try {...} catch {...} }`.
        const [, trimmedPath, cuts] = compiledPass.args;
        try {
          await trimCutRanges(...compiledPass.args);
          currentPath = trimmedPath;
          renderedPath = currentPath;
          trimApplied = true;
          logger.info('removed silence/filler cuts', {
            clipId,
            removedSeconds: Number(totalCutSeconds(cuts).toFixed(1)),
            cutCount: cuts.length,
          });
        } catch (error) {
          logger.warn(
            'silence/filler trim failed, keeping the untrimmed render',
            { clipId },
            error,
          );
        }
        break;
      }
      case 'applyReactionHolds': {
        const [, reactionHoldPath, holdInstants, extensionSeconds] = compiledPass.args;
        try {
          await applyReactionHolds(...compiledPass.args);
          currentPath = reactionHoldPath;
          renderedPath = currentPath;
          reactionHoldInstants = holdInstants;
          reactionHoldDurationSeconds =
            holdInstants.length * (extensionSeconds ?? REACTION_HOLD_EXTENSION_SECONDS);
          logger.info('applied reaction holds', { clipId, holdCount: holdInstants.length });
        } catch (error) {
          logger.warn('reaction hold pass failed, keeping the pre-hold render', { clipId }, error);
        }
        break;
      }
      case 'concatBrandSegment': {
        // Deliberately does NOT update `renderedPath` - matching the inline path's own
        // `finalOutputPath` (not `renderedPath`) reassignment on intro/outro success, since
        // downstream thumbnail/blur-placeholder/storyboard extraction must keep reading the
        // pre-intro/outro render regardless of how this pass turns out.
        const [, , , , , segmentOutputPath] = compiledPass.args;
        try {
          await concatBrandSegment(...compiledPass.args);
          currentPath = segmentOutputPath;
        } catch (error) {
          logger.warn(
            compiledPass.position === 'start'
              ? 'intro concat failed, uploading without one'
              : 'outro concat failed, uploading without one',
            { clipId },
            error,
          );
        }
        break;
      }
    }
  }

  return {
    renderedPath,
    finalOutputPath: currentPath,
    trimApplied,
    reactionHoldInstants,
    reactionHoldDurationSeconds,
  };
}
