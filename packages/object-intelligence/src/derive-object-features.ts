import type { ObjectFeatures, ObjectTrack } from '@speedora/contracts';

// Object Intelligence roadmap, Batch OI-1 - the dense, Fusion-Engine-ready
// summary derived from trackObjects()'s already-built tracks, same "raw/
// tracks/features" three-layer convention as @speedora/ocr-intelligence's
// deriveOcrFeatures() (raw = objects, tracks = objectTracks, features =
// this).

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const EMPTY_FEATURES: ObjectFeatures = {
  objectCount: null,
  dominantObject: null,
  averageObjectsPerFrame: null,
  averageTrackingConfidence: null,
  averagePersistence: null,
  averageMotionSpeed: null,
  averageOcclusionScore: null,
  averageInteractionConfidence: null,
  averageAttentionScore: null,
  averageAttentionConfidence: null,
};

// Pure, synchronous. `totalSamples` is the ORIGINAL raw `objects` sample
// count (not tracks.length) - needed to turn appearsFrames counts into a
// duration-comparable density, same convention as deriveOcrFeatures().
// `totalSamples === 0` (analysis never ran/failed) returns all-null - a
// real `0` is reserved for "analysis ran fine and found nothing", same
// distinction as every other *Features module here. Within that: `tracks`
// being empty (zero objects ever detected) still gives a real `objectCount`
// of 0 and `averageObjectsPerFrame` of 0 (both are legitimately zero
// counts/rates), but `averageTrackingConfidence`/`averagePersistence` stay
// null (there is nothing to average, distinct from "the average is 0").
export function deriveObjectFeatures(tracks: ObjectTrack[], totalSamples: number): ObjectFeatures {
  if (totalSamples === 0) return EMPTY_FEATURES;

  const objectCount = tracks.length;
  const averageObjectsPerFrame =
    tracks.reduce((sum, track) => sum + track.appearsFrames, 0) / totalSamples;

  if (tracks.length === 0) {
    return {
      objectCount,
      dominantObject: null,
      averageObjectsPerFrame,
      averageTrackingConfidence: null,
      averagePersistence: null,
      averageMotionSpeed: null,
      averageOcclusionScore: null,
      averageInteractionConfidence: null,
      averageAttentionScore: null,
      averageAttentionConfidence: null,
    };
  }

  // Most frequent category weighted by appearsFrames (not just track
  // count, so one long-lived object outweighs several one-frame
  // misdetections) - first-occurrence tie-break, same convention as
  // deriveOcrFeatures' dominantTextCategory.
  const weightedCounts = new Map<string, number>();
  for (const track of tracks) {
    weightedCounts.set(track.category, (weightedCounts.get(track.category) ?? 0) + track.appearsFrames);
  }
  let dominantObject = tracks[0].category;
  let dominantWeight = 0;
  for (const track of tracks) {
    const weight = weightedCounts.get(track.category) ?? 0;
    if (weight > dominantWeight) {
      dominantWeight = weight;
      dominantObject = track.category;
    }
  }

  const averageTrackingConfidence = average(tracks.map((track) => track.confidence));
  const averagePersistence = average(tracks.map((track) => track.persistenceScore));
  // Batch OI-2 - only tracks with a computable motionSpeed (2+ appearances)
  // contribute; a single-appearance track is excluded, not treated as 0
  // speed (same "nothing to average, not a real zero" distinction as
  // averageTrackingConfidence/averagePersistence above when tracks is
  // empty).
  const motionSpeeds = tracks
    .map((track) => track.motionSpeed)
    .filter((speed): speed is number => speed !== null);
  const averageMotionSpeed = motionSpeeds.length > 0 ? average(motionSpeeds) : null;
  // Batch OI-3 - occlusionScore is never null per-track (unlike
  // motionSpeed), so this only needs the "zero tracks" guard already
  // handled above.
  const averageOcclusionScore = average(tracks.map((track) => track.occlusionScore));
  // Batch OI-4 - interactionConfidence is never null per-track either, same
  // reasoning as averageOcclusionScore above.
  const averageInteractionConfidence = average(tracks.map((track) => track.interactionConfidence));
  // Batch OI-5 - attentionScore/attentionConfidence are never null per-track
  // either, same "zero tracks" guard already handled above, no per-track
  // null-filtering needed.
  const averageAttentionScore = average(tracks.map((track) => track.attentionScore));
  const averageAttentionConfidence = average(tracks.map((track) => track.attentionConfidence));

  return {
    objectCount,
    dominantObject,
    averageObjectsPerFrame,
    averageTrackingConfidence,
    averagePersistence,
    averageMotionSpeed,
    averageOcclusionScore,
    averageInteractionConfidence,
    averageAttentionScore,
    averageAttentionConfidence,
  };
}
