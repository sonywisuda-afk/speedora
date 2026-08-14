import type { RenderPlan } from '@speedora/contracts';
import { totalCutSeconds, type CutRange } from '@speedora/cutlist';
import { REACTION_HOLD_EXTENSION_SECONDS } from './ffmpeg';
import type {
  BrandSegmentAsset,
  BRollOverlay,
  ReframeOptions,
  renderClip,
  trimCutRanges,
  applyReactionHolds,
  concatBrandSegment,
} from './ffmpeg';

// Render Fidelity & Composition Execution Engine, Phase 4 (FFmpeg Execution Compiler) - see
// docs/ai/render-fidelity-matrix.md's Phase 0 audit and RenderPlan's own module comment
// (packages/contracts/src/render-plan.ts) for the full initiative context. This is a deliberate
// architectural boundary: WORKER-LOCAL, not a packages/render-config export - ReframeOptions/
// BRollOverlay/the exact FFmpeg execution argument shapes all live in apps/worker/src/ffmpeg.ts,
// which packages/* can never depend on. Duplicating them into a package would create a second,
// driftable copy of types this file's own imports below prove are unnecessary to duplicate at
// all (see the Parameters<>/type-only-import technique used throughout).
//
// compileRenderPlan() translates RenderPlan (Phase 3's "WHAT to execute") into an
// FfmpegExecutionPlan (this file's own "HOW to execute") - which of the existing ffmpeg.ts passes
// run, in what order, with what exact argument values. It reimplements NO rendering algorithm:
// every crop-math/xfade-offset/tpad-freeze/ASS-generation/B-roll-search computation stays exactly
// where it already correctly lives, inside ffmpeg.ts's own functions and their upstream callers -
// this file only assembles already-resolved values into those functions' own, unchanged parameter
// shapes.
//
// PURE AND SYNCHRONOUS - no DB/filesystem/ffprobe/subprocess/network/queue access. Every
// ffmpeg.ts function is imported `import type` ONLY (see below) - a deliberate, structural
// guarantee that this file cannot accidentally call/execute ffmpeg, not just a convention.
// REACTION_HOLD_EXTENSION_SECONDS and totalCutSeconds() are the two real (non-type-only) imports
// in this file - a plain exported numeric constant and a pure arithmetic helper, neither one I/O.
//
// KNOWN GAPS (found during Phase 4 implementation, not silently worked around - see this file's
// own CompilerResolvedInputs comment for where each is threaded through): RenderPlan's own
// Phase 1-3 approved contract does not carry every value the existing ffmpeg.ts functions need as
// real, positional arguments. Four gaps, all resolved the same way - as additional fields on this
// file's own CompilerResolvedInputs (which the Phase 4 approval's own resolvedPaths parameter
// already established as "external, adapter-resolved data, not part of RenderPlan's contract") -
// rather than by silently reopening RenderPlan's already-approved, already-committed schema:
//   1. cuts: CutRange[] - trimCutRanges() needs the real cut ranges, not just the
//      before/after duration delta RenderPlan.timeline already captures.
//   2. sourceAudioChannels (RAW, unclamped) - renderClip()'s own downmix decision specifically
//      needs the source's real channel count, distinct from RenderPlan.outputProfile.audioChannels
//      (already clamped to MAX_OUTPUT_AUDIO_CHANNELS, correct for every OTHER pass but not this
//      one - see resolveAudioEncodeArgs()'s own comment in ffmpeg.ts for why the two differ).
//   3. reframe: ReframeOptions - RenderPlan.framing.cropPath is the raw keyframe data (useful for
//      audit/observability), but building the actual ReframeOptions renderClip() needs (the
//      static-crop branch needs sourceWidth/sourceHeight/the source-bounded crop rectangle, none
//      of which RenderPlan/OutputProfile carry; the dynamic-crop branch needs a sendCmd script
//      already WRITTEN TO DISK, which this compiler is forbidden from doing) is genuinely a
//      separate, already-resolved value the adapter must supply, the same way it already does
//      today via buildReframePlan()'s own return value.
//   4. Per-pass output paths (trimmedPath/reactionHoldPath/introConcatPath/outroConcatPath) - the
//      Phase 4 approval's own resolvedPaths example listed one generic `outputPath`, but the real
//      pipeline chains FIVE distinct passes, each writing its own scratch file that becomes the
//      NEXT pass's input. Scratch paths are randomUUID-based (reserveScratchPath()) - generating
//      them inside this file would break the "deterministic" requirement, so they must come from
//      the adapter, which already computes them today.
// A future RenderPlan revision could fold gaps 1-3 into the contract properly; not attempted here
// per Phase 4's own explicit boundary ("do not modify Phase 1/2/3 history").

// Reuses the EXACT existing FFmpeg argument shapes via TypeScript's own Parameters<>/typeof
// utilities - zero duplication, zero drift risk (a future ffmpeg.ts signature change is a
// compile error here, not a silent mismatch). Every named import above this point that isn't
// REACTION_HOLD_EXTENSION_SECONDS/totalCutSeconds is `import type` only.
export type RenderClipArgs = Parameters<typeof renderClip>[0];
export type TrimCutRangesArgs = Parameters<typeof trimCutRanges>;
export type ApplyReactionHoldsArgs = Parameters<typeof applyReactionHolds>;
export type ConcatBrandSegmentArgs = Parameters<typeof concatBrandSegment>;

// Same "duplicate the literal, note why" precedent RenderPlan's own transitions.crossfadeSeconds
// already established (build-render-plan.ts's own CROSSFADE_SECONDS comment) for exactly the same
// reason: render-clip.worker.ts's own EXPORT_QUALITY_PRESETS map is a private, unexported
// constant, and this is a genuinely different file/module (not the same "duplicate one literal
// number" case - a 3-entry lookup table) where exporting the real one would mean touching
// render-clip.worker.ts's source in Phase 4, which the mission brief's own safety boundary
// ("the current render pipeline must continue executing exactly as it does today") argues against
// doing merely to satisfy an internal helper. Carried forward as the SAME technical debt as
// CROSSFADE_SECONDS - see this file's own final "known technical debt" note.
const EXPORT_QUALITY_PRESETS: Record<string, { preset: string; crf: number }> = {
  maximum_quality: { preset: 'slow', crf: 18 },
  balanced: { preset: 'fast', crf: 23 },
  small_size: { preset: 'veryfast', crf: 28 },
};

function resolveQualityArgs(
  qualityPreset: RenderPlan['outputProfile']['qualityPreset'],
): { preset: string; crf: number } | null {
  return qualityPreset ? (EXPORT_QUALITY_PRESETS[qualityPreset] ?? null) : null;
}

// Everything the compiler needs beyond RenderPlan itself - opaque, adapter-resolved data (real
// local file paths, and the four KNOWN GAP values above). The compiler never checks whether a
// path exists, never probes/stats it - that's the adapter's own responsibility, exactly as the
// Phase 4 approval's own "resolvedPaths are opaque inputs" instruction states.
export interface CompilerResolvedInputs {
  sourcePath: string;
  // renderClip()'s own output - the input to whichever pass runs next (trimCutRanges if there
  // were cuts, else applyReactionHolds if there were holds, else the intro/outro passes, else
  // this is simply the final delivered file).
  outputPath: string;
  // The real per-pass scratch paths the existing pipeline already reserves today (KNOWN GAP #4) -
  // only used when the corresponding pass is actually included in the compiled plan.
  trimmedPath: string;
  reactionHoldPath: string;
  introConcatPath: string;
  outroConcatPath: string;
  subtitlesPath: string | null;
  watermarkPath: string | null;
  introPath: string | null;
  outroPath: string | null;
  // Joined against RenderPlan.overlays.broll by (keyword, startTime) - RenderPlan carries
  // {keyword, startTime, endTime} (deterministic, no ephemeral path); this carries the matching
  // {keyword, startTime, filePath} the adapter actually downloaded/prepared. A moment present in
  // one list but not the other (shouldn't happen in practice - both come from the same adapter
  // run) is simply skipped, never a thrown error - same "best-effort, degrade gracefully" posture
  // ffmpeg.ts's own B-roll handling already has.
  brollOverlayPaths: { keyword: string; startTime: number; filePath: string }[];
  // KNOWN GAP #1 - the real cut ranges trimCutRanges() needs as a positional argument.
  cuts: CutRange[];
  // KNOWN GAP #2 - the RAW (unclamped) source channel count, specifically for renderClip()'s own
  // downmix decision. null when the probe failed, same convention as everywhere else in this
  // pipeline.
  sourceAudioChannels: number | null;
  // KNOWN GAP #3 - the fully execution-ready reframe object (including an already-written
  // sendCmdPath when the crop path is dynamic).
  reframe: ReframeOptions;
}

export type CompiledPass =
  | { pass: 'renderClip'; args: RenderClipArgs }
  | { pass: 'trimCutRanges'; args: TrimCutRangesArgs }
  | { pass: 'applyReactionHolds'; args: ApplyReactionHoldsArgs }
  | { pass: 'concatBrandSegment'; position: 'start'; args: ConcatBrandSegmentArgs }
  | { pass: 'concatBrandSegment'; position: 'end'; args: ConcatBrandSegmentArgs };

export interface FfmpegExecutionPlan {
  clipId: string;
  videoId: string;
  // Ordered - array position IS execution order, matching the existing pipeline's own sequence
  // (renderClip -> trimCutRanges -> applyReactionHolds -> intro -> outro). A skipped pass
  // (RenderPlan shows nothing to do) is simply ABSENT from this array, never a null placeholder -
  // makes pass-order and skipped-pass assertions equally trivial to write (see this file's own
  // spec).
  passes: CompiledPass[];
}

function buildRenderClipArgs(
  renderPlan: RenderPlan,
  resolved: CompilerResolvedInputs,
  quality: { preset: string; crf: number } | null,
): RenderClipArgs {
  const broll: BRollOverlay[] = renderPlan.overlays.broll.flatMap((moment) => {
    const match = resolved.brollOverlayPaths.find(
      (path) => path.keyword === moment.keyword && path.startTime === moment.startTime,
    );
    return match
      ? [{ filePath: match.filePath, startTime: moment.startTime, endTime: moment.endTime }]
      : [];
  });

  const branding = renderPlan.effectiveRenderConfig.branding;
  const watermark =
    branding.watermark && resolved.watermarkPath
      ? {
          filePath: resolved.watermarkPath,
          opacity: branding.watermark.opacity,
          scale: branding.watermark.scale,
          margin: branding.watermark.margin,
          position: branding.watermark.position,
        }
      : null;

  return {
    inputPath: resolved.sourcePath,
    startTime: renderPlan.timeline.requestedStartTime,
    endTime: renderPlan.timeline.requestedEndTime,
    subtitlesPath: resolved.subtitlesPath,
    outputPath: resolved.outputPath,
    reframe: resolved.reframe,
    broll,
    watermark,
    quality,
    sourceAudioChannels: resolved.sourceAudioChannels,
  };
}

function buildBrandSegmentAsset(
  branding: RenderPlan['effectiveRenderConfig']['branding'],
  position: 'intro' | 'outro',
  filePath: string | null,
): BrandSegmentAsset | null {
  const decision = branding[position];
  if (!decision || !filePath) return null;
  return {
    filePath,
    type: decision.type,
    imageDurationSeconds: decision.imageDurationSeconds,
  };
}

// The module's single entry point (mirroring @speedora/render-config's own "one exported
// build/compile function per file" convention, kept worker-local per this file's own module
// comment). Pure and synchronous - assembles already-resolved values into the exact, unchanged
// argument shapes ffmpeg.ts's own functions already expect; makes no new rendering decision and
// recomputes nothing RenderPlan already decided.
export function compileRenderPlan(
  renderPlan: RenderPlan,
  resolved: CompilerResolvedInputs,
): FfmpegExecutionPlan {
  const passes: CompiledPass[] = [];
  const quality = resolveQualityArgs(renderPlan.outputProfile.qualityPreset);

  // 1. renderClip - always runs, the existing pipeline's own unconditional first pass.
  passes.push({ pass: 'renderClip', args: buildRenderClipArgs(renderPlan, resolved, quality) });
  let currentPath = resolved.outputPath;

  // 2. trimCutRanges - skipped (absent) when there are no cuts, matching the existing pipeline's
  // own `if (cuts.length > 0)` gate.
  if (resolved.cuts.length > 0) {
    const totalOutputDuration =
      renderPlan.timeline.requestedDurationSeconds - totalCutSeconds(resolved.cuts);
    passes.push({
      pass: 'trimCutRanges',
      args: [
        currentPath,
        resolved.trimmedPath,
        resolved.cuts,
        totalOutputDuration,
        quality,
        renderPlan.outputProfile.fps,
        renderPlan.outputProfile.audioChannels,
      ],
    });
    currentPath = resolved.trimmedPath;
  }

  // 3. applyReactionHolds - skipped (absent) when there are no hold instants, matching
  // applyReactionHolds()'s own "the caller should skip calling this entirely when there is
  // nothing to hold" contract (it throws otherwise).
  if (renderPlan.holds.reactionHoldInstants.length > 0) {
    passes.push({
      pass: 'applyReactionHolds',
      args: [
        currentPath,
        resolved.reactionHoldPath,
        renderPlan.holds.reactionHoldInstants,
        REACTION_HOLD_EXTENSION_SECONDS,
        quality,
        renderPlan.outputProfile.audioChannels,
      ],
    });
    currentPath = resolved.reactionHoldPath;
  }

  // 4/5. concatBrandSegment (start, then end) - skipped (absent) when not configured, matching
  // the existing pipeline's own `if (introPath && intro)`/`if (outroPath && outro)` gates.
  const branding = renderPlan.effectiveRenderConfig.branding;
  const introAsset = buildBrandSegmentAsset(branding, 'intro', resolved.introPath);
  if (introAsset) {
    passes.push({
      pass: 'concatBrandSegment',
      position: 'start',
      args: [
        'start',
        currentPath,
        introAsset,
        renderPlan.outputProfile.width,
        renderPlan.outputProfile.height,
        resolved.introConcatPath,
        quality,
        renderPlan.outputProfile.fps,
        renderPlan.outputProfile.audioChannels,
      ],
    });
    currentPath = resolved.introConcatPath;
  }

  const outroAsset = buildBrandSegmentAsset(branding, 'outro', resolved.outroPath);
  if (outroAsset) {
    passes.push({
      pass: 'concatBrandSegment',
      position: 'end',
      args: [
        'end',
        currentPath,
        outroAsset,
        renderPlan.outputProfile.width,
        renderPlan.outputProfile.height,
        resolved.outroConcatPath,
        quality,
        renderPlan.outputProfile.fps,
        renderPlan.outputProfile.audioChannels,
      ],
    });
    currentPath = resolved.outroConcatPath;
  }

  return {
    clipId: renderPlan.clipId,
    videoId: renderPlan.videoId,
    passes,
  };
}
