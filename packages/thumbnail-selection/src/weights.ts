import type { ThumbnailWeights } from '@speedora/contracts';

// Default per-signal weights for Level 2 (timestamp) selection. Injectable
// (see selectThumbnailTimestamp's own `weights` parameter), same pattern as
// @speedora/fusion-engine's own weights.ts.
//
// EXPLICIT DEVIATION from that same file's convention, called out on
// purpose: every new Fusion Engine signal ships at weight 0 until
// calibrated against real engagement data (gesture/faceGeometry/object/
// composition/sceneMotion/cameraMotion are all 0 there today). That
// convention does NOT transfer here - highlightScore stays meaningful with
// signals at 0 because other, already-calibrated signals still carry it.
// Thumbnail selection has no calibrated baseline at all: if every weight
// below started at 0, EVERY clip would fall back to the clip midpoint -
// i.e. no observable change from today's behavior, defeating the feature
// entirely. So this table ships non-zero heuristic weights from day one,
// same reasoning @speedora/editing-rhythm used to justify its own heuristic
// 0.05 (see that package's weights history in fusion-engine's weights.ts),
// just applied to the whole table here instead of one entry. Unvalidated
// against real click-through/engagement data on thumbnails - revisit once
// that data exists.
export const DEFAULT_THUMBNAIL_WEIGHTS: ThumbnailWeights = {
  faceClarity: 0.35,
  emotion: 0.25,
  ocrImportance: 0.15,
  composition: 0.15,
  gesture: 0.05,
  motion: 0.05,
};
