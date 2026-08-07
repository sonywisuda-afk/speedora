// AI Intelligence v4, Phase 1 - follows isFusionV3Enabled()'s exact shape
// (packages/fusion-ml/src/feature-flags.ts), this codebase's only prior
// feature-flag precedent (ADR D8): a boolean env var, read lazily (function
// body, not a module-level const) so it isn't captured before dotenv's
// config() call runs elsewhere in the process.
//
// This flag gates EXPOSURE (whether GET /clips/:id/intelligence populates
// `hookPrediction` or returns null), not computation - the render-graph node
// still runs and persists Clip.hookPrediction regardless, matching how
// weight-0 Fusion Engine signals are already "collected but inert." This
// means flipping the flag on later needs no backfill.
export function isHookPredictionEnabled(): boolean {
  return process.env.HOOK_PREDICTION_ENABLED === 'true';
}
