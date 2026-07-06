import type { FusionWeights } from '@speedora/contracts';

// Default per-signal weights - explicit values given by the user, sized so
// audio/scene/facial/ocr/llm sum to exactly 1.0. Injectable (see
// computeHighlightScore's `weights` parameter): Checkpoint 5 of the AI
// Fusion roadmap ("Training, Weight Optimization") is expected to replace
// this table with values learned from real engagement data, not hardcode
// forever.
//
// `gesture` is deliberately 0 here, not absent - it's collected (raw +
// derived features both exist, see @speedora/gesture-intelligence) and
// still shows up in `contributions` for transparency/future calibration,
// but doesn't move highlightScore yet. This matches the roadmap's existing
// note that gesture has "low standalone value" on its own; giving it a
// real weight is a decision for later once there's data to justify one.
//
// `ocr`/`llm` are reserved keys with no corresponding fusionInputSchema
// field yet (no module produces those features) - present here so the
// weight table's shape doesn't need to change again once those modules
// exist, only gain a real contribution.
export const DEFAULT_FUSION_WEIGHTS: FusionWeights = {
  audio: 0.35,
  scene: 0.3,
  facial: 0.2,
  gesture: 0,
  ocr: 0.1,
  llm: 0.05,
};
