import type { FusionWeights } from '@speedora/contracts';

// Default per-signal weights - explicit values given by the user, sized so
// the active (non-zero) weights sum to exactly 1.0. Injectable (see
// computeHighlightScore's `weights` parameter): Checkpoint 5 of the AI
// Fusion roadmap ("Training, Weight Optimization") is expected to replace
// this table with values learned from real engagement data, not hardcode
// forever.
//
// `sceneMotion` (Scene Intelligence taxonomy expansion, Batch SC-2) is also
// deliberately 0, same reasoning as gesture/faceGeometry below - motion-
// energy/static-dynamic classification is brand new and unvalidated, and
// `scene` itself already carries a real weight, so `sceneMotion` stays
// separate and silent until there's data to justify a non-zero value.
// `cameraMotion` (Batch SC-3, directional pan/tilt/zoom/shake) is the same
// story one batch later - collected and visible in `contributions` for
// calibration, contributing nothing to highlightScore yet.
// `editingRhythm` (taxonomy category F - tempo/pacing/acceleration,
// composed from scene/sceneMotion/audio's own already-computed features)
// got the identical "wire in at 0, calibrate later" treatment initially.
// As of 2026-07-10, `check-calibration-coverage.ts` (apps/worker/src/
// scripts) confirmed 0 usable samples exist in production (0 clips have
// both editingRhythmFeatures and a linked PublishRecord with viewCount) -
// nowhere near enough for a real statistical fit. Per explicit user
// direction, this was bumped from 0 to a small HEURISTIC 0.05 anyway
// (reasoned, not fit to data), taken out of `scene`'s share (0.30 -> 0.25)
// to keep the active weights summing to 1.0 - `scene` was chosen as the
// donor because editingRhythm's tempo/pacing features are themselves partly
// derived from scene's own cut data, so the overlap makes it the least
// arbitrary place to borrow from. Re-run check-calibration-coverage.ts as
// production data accumulates and replace this with a fit value once
// there's enough to fit.
//
// `gesture`/`faceGeometry` are deliberately 0 here, not absent - both are
// collected (raw + derived features both exist, see
// @speedora/gesture-intelligence and @speedora/facial-intelligence's
// detectFaceLandmarks) and still show up in `contributions` for
// transparency/future calibration, but don't move highlightScore yet. Same
// "low standalone value until calibrated against real data" reasoning
// gesture already carries - `faceGeometry` (blink/smile/mouth-open/head-
// rotation/framing, AI Fusion roadmap's Face Intelligence initiative Batch
// 1) is new enough that giving it a nonzero weight ahead of any real
// engagement-data validation would just be another unvalidated guess
// layered on top of the ones already acknowledged in this table's own
// history (see the fusion-engine v2/v2.1 sections in CLAUDE.md).
//
// `ocr` was a reserved key with no corresponding fusionInputSchema field
// (no module produced those features) until the AI Fusion roadmap's OCR
// initiative's Batch OCR-2 - it now has a real contribution too, same as
// `llm` (Fase 32) - see feature-pipeline.ts's extractOcrFeatures/
// extractLlmFeatures. The 0.1 weight below is the SAME value given by the
// user back in Fase 31, before any OCR module existed to fill it -
// unvalidated against real engagement data now just as it was reserved
// unvalidated then.
//
// `speaker` (Speaker Intelligence roadmap, Milestone D) - same "collect
// first, calibrate later" treatment as sceneMotion/cameraMotion/gesture/
// faceGeometry above: @speedora/speaker-scoring's dominantSpeakerConfidence/
// Engagement/Importance/averageSpeakerHighlightScore are collected and
// visible in `contributions`, but weight 0 until there's real engagement
// data to calibrate against (same apps/worker/src/scripts/
// check-calibration-coverage.ts checkpoint editingRhythm went through -
// re-run it for this signal once production has real published clips).
//
// `object` (Object Intelligence roadmap, Batch OI-1) - same "collect first,
// calibrate later" treatment as every other recently-added signal above:
// @speedora/object-intelligence's deriveObjectFeatures() output is
// collected and visible in `contributions`, but weight 0 until there's real
// engagement data to calibrate against.
export const DEFAULT_FUSION_WEIGHTS: FusionWeights = {
  audio: 0.35,
  scene: 0.25,
  sceneMotion: 0,
  cameraMotion: 0,
  editingRhythm: 0.05,
  facial: 0.2,
  gesture: 0,
  faceGeometry: 0,
  ocr: 0.1,
  object: 0,
  llm: 0.05,
  speaker: 0,
};
