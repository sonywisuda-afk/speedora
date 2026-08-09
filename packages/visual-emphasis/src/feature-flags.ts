// AI Intelligence v4 Track B, Phase C1 - follows isDynamicCaptionEnabled()'s
// exact shape (ADR D8): a boolean env var, read lazily (function body, not
// a module-level const) so it isn't captured before dotenv's config() call
// runs elsewhere in the process.
//
// Gates GET /clips/:id/intelligence's exposure of `editingSuggestions`,
// not computation - the render-graph node always runs (it's optional:
// false, pure computation, not an LLM call that can fail) and persists
// Clip.editingSuggestions regardless, matching every other v4 pure-derive
// node's flag. Does NOT gate any render-pipeline behavior - Phase C1 has
// none; that's C2-C7's job, each with its own flag/toggle when designed.
export function isVisualEmphasisEnabled(): boolean {
  return process.env.VISUAL_EMPHASIS_ENABLED === 'true';
}

// Visual Emphasis Engine Phase C3 ("Focus Shift" - see docs/ai/
// visual-emphasis-engine.md's "C3 rollout" decision) - a SEPARATE flag from
// isVisualEmphasisEnabled() above, deliberately: that one gates API
// exposure only (ADR D8) and stays off having no effect on rendering; this
// one gates an actual render-pipeline behavior change (render-clip.worker.ts
// passing focus_shift EditingSuggestion windows into
// @speedora/reframe's buildCropPath(), which then snaps the crop path
// instead of smoothly drifting across a detected subject change). Off by
// default, no per-clip toggle (explicit product decision, unlike Subtitle
// Rewriter/Dynamic Captions' smartSegmentation/dynamicCaptions booleans) -
// this phase's own snap-transition aesthetics were never validated against
// real footage in this sandbox (no MediaPipe/Python runtime available,
// same gap Phase C2 already flagged), so a single global kill switch is
// the safest rollout shape until real production footage can confirm it.
// One phase = one flag, same convention as every other v4 rendering
// behavior (SUBTITLE_REWRITE_ENABLED, DYNAMIC_CAPTION_ENABLED) - future
// C4-C7 phases each get their own, not a shared one, so turning on Focus
// Shift never silently toggles an unrelated technique too.
export function isFocusShiftEnabled(): boolean {
  return process.env.VISUAL_EMPHASIS_FOCUS_SHIFT_ENABLED === 'true';
}
