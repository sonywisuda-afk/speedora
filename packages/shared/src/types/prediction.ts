// Sprint 6J (Predicted performance) - workspace-level diagnostic,
// transparency into why per-clip predictions are or aren't available for
// this workspace. Echoes /ops/ai/correlation's exact shape
// (hasEnoughSamples/sampleCount/minSamplesRequired), just scoped to one
// workspace's own published clips instead of pooled system-wide.
export interface WorkspacePredictionModelDto {
  hasEnoughSamples: boolean;
  sampleCount: number;
  minSamplesRequired: number;
  correlation: number | null;
}
