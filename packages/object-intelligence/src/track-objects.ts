import type {
  CameraMotionDirectionType,
  ObjectDetection,
  ObjectSample,
  ObjectTrack,
} from '@speedora/contracts';

// Object Intelligence roadmap, Batch OI-1 - cross-frame object TRACKING,
// entirely in TypeScript over the already-persisted raw `objects` array (no
// changes to detect_objects.py at all) - same "all of this clip's samples
// already exist upfront, no reason to duplicate tracking logic inside the
// subprocess" reasoning as @speedora/ocr-intelligence's trackOcrText()
// (Batch OCR-2), which this module directly generalizes.
//
// Genuinely MULTI-object from the start (N active tracks vs. M per-frame
// detections, greedy lowest-cost-first assignment) - unlike Face
// Intelligence Batch 4's FaceTracker, which only ever tracks the single
// most prominent face (a real-time Kalman filter + a literal 1x1 Hungarian
// assignment). A frame here can have many simultaneous objects, the same
// reason OCR's tracker (not Face's) is the right precedent.
//
// The one real difference from trackOcrText()'s cost function: `category`
// is a HARD gate here, not a weighted cost term - a "car" detection must
// never merge into a "person" track. IoU alone decides the match cost among
// same-category candidates, since there's no text-similarity analog to
// blend in.

type BoundingBox = ObjectDetection['boundingBox'];

// Match-cost/tolerance constants - reasonable guesses, not calibrated
// against real footage, same "kejujuran skala" as every other threshold in
// this pipeline. MATCH_COST_THRESHOLD of 0.7 means "at least 0.3 IoU
// overlap required to continue a track" - lenient enough to tolerate real
// object motion between ~1-second samples (this module has no Kalman-style
// position prediction to extrapolate through a gap, unlike Face
// Intelligence's real-time tracker - see this file's own module comment).
const MATCH_COST_THRESHOLD = 0.7;
// Consecutive missed samples a track tolerates before it's considered
// ended - a bit more lenient than OCR's MAX_MISS_SAMPLES (1), since a
// moving/occluded object is more likely to have a brief real gap in
// detection than static on-screen text.
const MAX_MISS_SAMPLES = 2;
// Batch OI-2 - average frame-to-frame bounding-box-center movement at/above
// which an object reads as "maximally fast" - a reasonable guess (objects
// generally move more per ~1-second sample than static on-screen text, so
// this is larger than @speedora/ocr-intelligence's own MOTION_CAP of 0.1),
// not calibrated against real footage, same caveat as every other threshold
// in this file.
const OBJECT_MOTION_CAP = 0.15;
// Batch OI-2 - classification thresholds for motionDirection, same
// reasoning/values as @speedora/scene-intelligence's ZOOM_THRESHOLD/
// PAN_TILT_THRESHOLD (a bounding box's own size-change ratio and centroid
// delta are both fractions of frame width/height, same units as camera
// motion's dx/dy/scale) - not calibrated against real footage.
const OBJECT_ZOOM_THRESHOLD = 0.02;
const OBJECT_PAN_TILT_THRESHOLD = 0.01;
// Batch OI-4 - center-to-center distance (normalized frame units) at/above
// which two objects read as "not near each other at all" (proximity 0) - a
// reasonable guess (roughly a third of the frame's diagonal), not
// calibrated against real footage, same caveat as every other threshold in
// this file. Deliberately a DIFFERENT metric from occlusionScore's IoU -
// two people standing close and talking would score above 0 here (small
// center distance) while scoring exactly 0 on occlusion (no box overlap at
// all). Reused as the normalization scale for the distance-trend
// ("convergence") component too - see computeInteractionConfidence().
const INTERACTION_DISTANCE_CAP = 0.4;
// Batch OI-5 - distinct co-occurring "partner" tracks (see
// computeCoOccurringPartnerScore()) at/above which an object reads as
// "maximally social" - a reasonable guess (three or more simultaneous
// nearby tracks is already a crowded frame), not calibrated against real
// footage, same caveat as every other threshold in this file.
const PARTNER_COUNT_CAP = 3;
// Batch OI-5 - observed appearances (appearsFrames) at/above which a
// track's attentionScore reading is treated as "fully backed by evidence" -
// a reasonable guess (at ~1 sample/second this is roughly 5 seconds of
// actual observation), not calibrated against real footage. Deliberately
// frame-count-based rather than persistenceScore-based - see
// objectTrackSchema's attentionConfidence comment for why.
const CONFIDENCE_FRAME_CAP = 5;

function iou(a: BoundingBox, b: BoundingBox): number {
  const ax0 = a.xCenter - a.width / 2;
  const ay0 = a.yCenter - a.height / 2;
  const ax1 = a.xCenter + a.width / 2;
  const ay1 = a.yCenter + a.height / 2;
  const bx0 = b.xCenter - b.width / 2;
  const by0 = b.yCenter - b.height / 2;
  const bx1 = b.xCenter + b.width / 2;
  const by1 = b.yCenter + b.height / 2;

  const ix0 = Math.max(ax0, bx0);
  const iy0 = Math.max(ay0, by0);
  const ix1 = Math.min(ax1, bx1);
  const iy1 = Math.min(ay1, by1);
  const intersection = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageBoundingBox(boxes: BoundingBox[]): BoundingBox {
  return {
    xCenter: average(boxes.map((box) => box.xCenter)),
    yCenter: average(boxes.map((box) => box.yCenter)),
    width: average(boxes.map((box) => box.width)),
    height: average(boxes.map((box) => box.height)),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Batch OI-2 - average centroid movement between consecutive appearances,
// normalized via OBJECT_MOTION_CAP - same shape as @speedora/ocr-
// intelligence's track-ocr-text.ts motionScore computation.
function computeMotionSpeed(boxes: BoundingBox[]): number {
  const deltas: number[] = [];
  for (let i = 1; i < boxes.length; i++) {
    const a = boxes[i - 1];
    const b = boxes[i];
    deltas.push(Math.hypot(b.xCenter - a.xCenter, b.yCenter - a.yCenter));
  }
  return clamp01(average(deltas) / OBJECT_MOTION_CAP);
}

// Batch OI-2 - net movement direction from the track's first to last
// appearance, same zoom-then-pan/tilt priority classification as
// @speedora/scene-intelligence's classifyDirection() (see that module's own
// comment for the sign convention - positive dx/dy = rightward/downward
// movement, size ratio > 1 = growing/approaching). A NET (first-to-last)
// comparison rather than a per-appearance-pair majority vote, unlike camera
// motion's dominantDirection - a single tracked object's overall
// displacement is the more natural read for "which way did this object
// move" than a frame-by-frame vote would be.
function computeMotionDirection(first: BoundingBox, last: BoundingBox): CameraMotionDirectionType {
  const dx = last.xCenter - first.xCenter;
  const dy = last.yCenter - first.yCenter;
  const firstArea = first.width * first.height;
  const lastArea = last.width * last.height;
  const sizeRatio = firstArea > 0 ? Math.sqrt(lastArea / firstArea) : 1;

  const zoomMagnitude = Math.abs(sizeRatio - 1);
  const panMagnitude = Math.abs(dx);
  const tiltMagnitude = Math.abs(dy);

  if (
    zoomMagnitude >= OBJECT_ZOOM_THRESHOLD &&
    zoomMagnitude >= panMagnitude &&
    zoomMagnitude >= tiltMagnitude
  ) {
    return sizeRatio > 1 ? 'in' : 'out';
  }
  if (panMagnitude >= OBJECT_PAN_TILT_THRESHOLD && panMagnitude >= tiltMagnitude) {
    return dx > 0 ? 'right' : 'left';
  }
  if (tiltMagnitude >= OBJECT_PAN_TILT_THRESHOLD) {
    return dy > 0 ? 'down' : 'up';
  }
  return 'static';
}

// Batch OI-5 - Activity domain component. What FRACTION of this track's own
// consecutive-appearance steps counted as "moving" (centroid delta at/above
// OBJECT_PAN_TILT_THRESHOLD, the same minimum-movement gate
// computeMotionDirection() already uses to decide "static" vs. a real
// direction) - deliberately a DIFFERENT read from motionSpeed's own average
// magnitude: a track that darts, stops, darts, stops has a similar average
// speed to one that drifts continuously, but a much lower motionPersistence.
// Requires >= 2 appearances (same gate as motionSpeed) - null otherwise, not
// fabricated.
function computeMotionPersistence(boxes: BoundingBox[]): number {
  let movingSteps = 0;
  for (let i = 1; i < boxes.length; i++) {
    const delta = Math.hypot(
      boxes[i].xCenter - boxes[i - 1].xCenter,
      boxes[i].yCenter - boxes[i - 1].yCenter,
    );
    if (delta >= OBJECT_PAN_TILT_THRESHOLD) movingSteps++;
  }
  return clamp01(movingSteps / (boxes.length - 1));
}

// Batch OI-5 - Activity domain component. How consistent is this track's
// movement DIRECTION across consecutive steps, as opposed to
// computeMotionDirection()'s single net first-to-last reading - a track that
// moves right, then left, then right again nets out near-static overall but
// has low directional consistency. Computed as the average cosine
// similarity between consecutive (nonzero) displacement vectors, rescaled
// from [-1, 1] (fully reversing to fully aligned) to [0, 1]. Needs at least
// two nonzero displacement steps to compare - null otherwise (a track that
// barely moves has no meaningful direction to be consistent OR inconsistent
// about, same "don't fabricate" reasoning as motionSpeed/motionPersistence).
function computeDirectionConsistency(boxes: BoundingBox[]): number | null {
  const vectors: { dx: number; dy: number }[] = [];
  for (let i = 1; i < boxes.length; i++) {
    const dx = boxes[i].xCenter - boxes[i - 1].xCenter;
    const dy = boxes[i].yCenter - boxes[i - 1].yCenter;
    if (Math.hypot(dx, dy) >= OBJECT_PAN_TILT_THRESHOLD) vectors.push({ dx, dy });
  }
  if (vectors.length < 2) return null;

  const similarities: number[] = [];
  for (let i = 1; i < vectors.length; i++) {
    const a = vectors[i - 1];
    const b = vectors[i];
    const magA = Math.hypot(a.dx, a.dy);
    const magB = Math.hypot(b.dx, b.dy);
    const cosine = (a.dx * b.dx + a.dy * b.dy) / (magA * magB);
    similarities.push(cosine);
  }
  return clamp01((average(similarities) + 1) / 2);
}

// Batch OI-5 - Visibility domain: "how much and how clearly was this object
// actually on screen", combining this track's own detection confidence,
// screen-time share, and inverse occlusion. Always computable - every track
// has all three ingredients.
function computeVisibilityScore(
  confidence: number,
  persistenceScore: number,
  occlusionScore: number,
): number {
  return average([confidence, persistenceScore, 1 - occlusionScore]);
}

// Batch OI-5 - Activity domain: "how much and how coherently did this object
// move". An unweighted mean of whichever of the three motion components are
// available - 0.5 (neutral), not null, when a single-appearance track has
// none of them, same "insufficient history -> neutral" convention as
// computeConvergenceScore(), so this always returns a plain number for the
// three-domain average in computeAttentionScore() below.
function computeActivityScore(
  motionSpeed: number | null,
  motionPersistence: number | null,
  directionConsistency: number | null,
): number {
  const available = [motionSpeed, motionPersistence, directionConsistency].filter(
    (value): value is number => value != null,
  );
  return available.length > 0 ? average(available) : 0.5;
}

// Batch OI-5 - reliability of attentionScore, NOT a component of it. Based
// purely on appearsFrames (see this file's own CONFIDENCE_FRAME_CAP comment
// for why frame count rather than persistenceScore). Never null - every
// track has at least one appearance.
function computeAttentionConfidence(appearsFrames: number): number {
  return clamp01(appearsFrames / CONFIDENCE_FRAME_CAP);
}

// Batch OI-3 - for every detection in one sampled frame, the highest IoU
// against any OTHER detection in that SAME frame (any category - occlusion
// isn't gated by category the way track-matching is). A frame with only one
// detection scores 0 for it (nothing else present to overlap with).
function computeOcclusionScores(detections: ObjectDetection[]): number[] {
  return detections.map((detection, index) => {
    let maxIou = 0;
    for (let other = 0; other < detections.length; other++) {
      if (other === index) continue;
      maxIou = Math.max(maxIou, iou(detection.boundingBox, detections[other].boundingBox));
    }
    return maxIou;
  });
}

// Batch OI-4 - for every detection in one sampled frame, the RAW distance
// (not yet converted to a 0-1 score) to the NEAREST other detection in that
// SAME frame (any category, same reasoning as computeOcclusionScores).
// `Infinity` when no other detection is present that frame - kept raw
// (rather than pre-converted to a closeness score here) because
// buildTrack() needs the actual distance SERIES for two different purposes:
// an average closeness (proximity) AND a first-half-vs-second-half trend
// (convergence) - see computeInteractionConfidence().
function computeNearestDistances(detections: ObjectDetection[]): number[] {
  return detections.map((detection, index) => {
    let nearestDistance = Infinity;
    for (let other = 0; other < detections.length; other++) {
      if (other === index) continue;
      const distance = Math.hypot(
        detection.boundingBox.xCenter - detections[other].boundingBox.xCenter,
        detection.boundingBox.yCenter - detections[other].boundingBox.yCenter,
      );
      nearestDistance = Math.min(nearestDistance, distance);
    }
    return nearestDistance;
  });
}

function proximityFromDistance(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return 1 - clamp01(distance / INTERACTION_DISTANCE_CAP);
}

// Batch OI-4 - average proximity (closeness to the nearest other object)
// across this track's own appearances - the same shape as occlusionScore's
// own per-appearance average, just distance-based instead of IoU-based.
function computeProximityScore(distances: number[]): number {
  return average(distances.map(proximityFromDistance));
}

// Batch OI-4 - is this track's own nearest-neighbor distance shrinking
// ("converging") or growing ("diverging") over the course of its
// appearances? Compares the average distance across the first half of
// appearances-with-a-neighbor-present against the second half - a shrinking
// average reads as "closing the gap" (score above 0.5), a growing one as
// "moving apart" (score below 0.5). Deliberately does NOT require the
// nearest neighbor to be the SAME other track across appearances (this
// module has no per-appearance neighbor-identity tracking) - it's reading
// "is this object trending toward whatever is nearest it, moment to
// moment", a coarser signal than true pairwise convergence but honest about
// what's actually computable without that extra bookkeeping. 0.5 (neutral)
// when fewer than 2 appearances have another object present at all - not
// enough history to judge a trend, and 0.5 (rather than null) keeps this
// component uniformly a plain number for the average() in
// computeInteractionConfidence() below.
function computeConvergenceScore(distances: number[]): number {
  const finite = distances.filter((distance) => Number.isFinite(distance));
  if (finite.length < 2) return 0.5;

  const midpoint = Math.floor(finite.length / 2);
  const firstHalf = finite.slice(0, midpoint);
  const secondHalf = finite.slice(midpoint);
  const closingDistance = average(firstHalf) - average(secondHalf);
  return clamp01(0.5 + closingDistance / INTERACTION_DISTANCE_CAP);
}

// Batch OI-4 - what fraction of THIS track's own screen time overlaps with
// the track it shares the most screen time with. Two objects that coexist
// on screen for a long stretch read as more plausibly interacting than two
// that each flash by separately, independent of how physically close they
// were during that time (that's proximity's job, not this component's).
// Reused as-is for Batch OI-5's Social-domain "coPresence" component - see
// computeSocialScore().
type TrackWithoutSocial = Omit<ObjectTrack, 'interactionConfidence' | 'attentionScore'>;

function computeTemporalOverlapScore(
  track: TrackWithoutSocial,
  allTracks: TrackWithoutSocial[],
): number {
  if (track.durationSeconds <= 0) return 0;

  let maxOverlapSeconds = 0;
  for (const other of allTracks) {
    if (other === track) continue;
    const overlapStart = Math.max(track.startTime, other.startTime);
    const overlapEnd = Math.min(track.endTime, other.endTime);
    maxOverlapSeconds = Math.max(maxOverlapSeconds, Math.max(0, overlapEnd - overlapStart));
  }
  return clamp01(maxOverlapSeconds / track.durationSeconds);
}

// Batch OI-4 - "objectInteraction" from the user's original taxonomy,
// combined into ONE `interactionConfidence` number as an unweighted mean of
// three independent [0, 1] components (proximity, temporal co-presence,
// distance trend) - see objectTrackSchema's own contract comment for why
// each component exists and why this is named/framed as a "confidence"
// heuristic rather than a claim of real interaction. `temporalOverlapScore`
// is passed in rather than recomputed - Batch OI-5's Social domain needs the
// SAME value for its own "coPresence" component, see computeSocialScore().
function computeInteractionConfidence(
  proximityScore: number,
  temporalOverlapScore: number,
  convergenceScore: number,
): number {
  return average([proximityScore, temporalOverlapScore, convergenceScore]);
}

// Batch OI-5 - Social domain component. Count of DISTINCT other tracks this
// track ever shared a SAMPLED FRAME with at close range (center-to-center
// distance under INTERACTION_DISTANCE_CAP, the same closeness scale
// proximityScore uses), normalized via PARTNER_COUNT_CAP. Needs the raw
// per-appearance timestamps/boxes (not the summarized track), unlike every
// other Social/Visibility/Activity component - this is the one place this
// module looks at another track's OWN appearances rather than its finished
// start/end time, because "was near" is a per-moment question, not a
// track-level one the way temporal co-presence is.
function computeCoOccurringPartnerScore(track: ActiveTrack, allTracks: ActiveTrack[]): number {
  const partners = new Set<number>();
  for (const other of allTracks) {
    if (other === track) continue;
    const isPartner = track.appearances.some((appearance) => {
      const sameMoment = other.appearances.find((candidate) => candidate.t === appearance.t);
      if (!sameMoment) return false;
      const distance = Math.hypot(
        appearance.detection.boundingBox.xCenter - sameMoment.detection.boundingBox.xCenter,
        appearance.detection.boundingBox.yCenter - sameMoment.detection.boundingBox.yCenter,
      );
      return distance < INTERACTION_DISTANCE_CAP;
    });
    if (isPartner) partners.add(other.trackId);
  }
  return clamp01(partners.size / PARTNER_COUNT_CAP);
}

// Batch OI-5 - Social domain: "how much did this object share the frame
// with others". Always computable - interactionConfidence is never null,
// and partnerScore/coPresenceScore are always real numbers (0 when nothing
// else was ever nearby/co-present, a real "alone in frame", not "unknown").
function computeSocialScore(
  interactionConfidence: number,
  partnerScore: number,
  coPresenceScore: number,
): number {
  return average([interactionConfidence, partnerScore, coPresenceScore]);
}

// Batch OI-5 - "objectAttentionScore" itself: the average of the three
// domain scores. See objectTrackSchema's own attentionScore comment for the
// full Detection -> ... -> Visibility/Activity/Social -> Attention
// architecture this implements.
function computeAttentionScore(
  visibilityScore: number,
  activityScore: number,
  socialScore: number,
): number {
  return average([visibilityScore, activityScore, socialScore]);
}

interface Appearance {
  t: number;
  detection: ObjectDetection;
  occlusionScore: number;
  nearestDistance: number;
}

interface ActiveTrack {
  trackId: number;
  lastDetection: ObjectDetection;
  misses: number;
  appearances: Appearance[];
}

function buildTrack(
  track: ActiveTrack,
  totalSamples: number,
): {
  track: TrackWithoutSocial;
  proximityScore: number;
  convergenceScore: number;
  visibilityScore: number;
  activityScore: number;
} {
  const { appearances } = track;
  const startTime = appearances[0].t;
  const endTime = appearances[appearances.length - 1].t;
  const boxes = appearances.map((a) => a.detection.boundingBox);
  const distances = appearances.map((a) => a.nearestDistance);

  const hasMotionData = appearances.length >= 2;
  const confidence = average(appearances.map((a) => a.detection.confidence));
  const persistenceScore = appearances.length / totalSamples;
  const occlusionScore = average(appearances.map((a) => a.occlusionScore));
  const motionSpeed = hasMotionData ? computeMotionSpeed(boxes) : null;
  const motionPersistence = hasMotionData ? computeMotionPersistence(boxes) : null;
  const directionConsistency = hasMotionData ? computeDirectionConsistency(boxes) : null;

  return {
    track: {
      trackId: track.trackId,
      category: appearances[0].detection.category,
      boundingBox: averageBoundingBox(boxes),
      confidence,
      startTime,
      endTime,
      durationSeconds: endTime - startTime,
      appearsFrames: appearances.length,
      persistenceScore,
      motionSpeed,
      motionDirection: hasMotionData
        ? computeMotionDirection(boxes[0], boxes[boxes.length - 1])
        : null,
      occlusionScore,
      attentionConfidence: computeAttentionConfidence(appearances.length),
    },
    proximityScore: computeProximityScore(distances),
    convergenceScore: computeConvergenceScore(distances),
    visibilityScore: computeVisibilityScore(confidence, persistenceScore, occlusionScore),
    activityScore: computeActivityScore(motionSpeed, motionPersistence, directionConsistency),
  };
}

// Pure, synchronous - groups raw per-frame objectDetectionSchema entries
// (from detectObjects()'s already-collected samples) into per-object
// tracks.
export function trackObjects(samples: ObjectSample[]): ObjectTrack[] {
  const active: ActiveTrack[] = [];
  const finished: ActiveTrack[] = [];
  let nextTrackId = 0;

  for (const sample of samples) {
    const detections = sample.objects;
    const occlusionScores = computeOcclusionScores(detections);
    const nearestDistances = computeNearestDistances(detections);

    const candidates: { trackIndex: number; detectionIndex: number; cost: number }[] = [];
    for (let ti = 0; ti < active.length; ti++) {
      for (let di = 0; di < detections.length; di++) {
        if (active[ti].lastDetection.category !== detections[di].category) continue;
        const cost = 1 - iou(active[ti].lastDetection.boundingBox, detections[di].boundingBox);
        if (cost <= MATCH_COST_THRESHOLD) {
          candidates.push({ trackIndex: ti, detectionIndex: di, cost });
        }
      }
    }
    candidates.sort((a, b) => a.cost - b.cost);

    const assignedTracks = new Set<number>();
    const assignedDetections = new Set<number>();
    for (const candidate of candidates) {
      if (
        assignedTracks.has(candidate.trackIndex) ||
        assignedDetections.has(candidate.detectionIndex)
      ) {
        continue;
      }
      assignedTracks.add(candidate.trackIndex);
      assignedDetections.add(candidate.detectionIndex);
      const track = active[candidate.trackIndex];
      const detection = detections[candidate.detectionIndex];
      track.appearances.push({
        t: sample.t,
        detection,
        occlusionScore: occlusionScores[candidate.detectionIndex],
        nearestDistance: nearestDistances[candidate.detectionIndex],
      });
      track.lastDetection = detection;
      track.misses = 0;
    }

    for (let ti = active.length - 1; ti >= 0; ti--) {
      if (assignedTracks.has(ti)) continue;
      active[ti].misses++;
      if (active[ti].misses > MAX_MISS_SAMPLES) {
        finished.push(active[ti]);
        active.splice(ti, 1);
      }
    }

    for (let di = 0; di < detections.length; di++) {
      if (assignedDetections.has(di)) continue;
      active.push({
        trackId: nextTrackId++,
        lastDetection: detections[di],
        misses: 0,
        appearances: [
          {
            t: sample.t,
            detection: detections[di],
            occlusionScore: occlusionScores[di],
            nearestDistance: nearestDistances[di],
          },
        ],
      });
    }
  }
  finished.push(...active);

  // Batch OI-4/OI-5 - interactionConfidence, Social domain (coPresence,
  // partnerScore) and attentionScore all need OTHER tracks' finished data
  // (start/end time, or raw appearances for partner detection), so they're
  // computed in a SEPARATE pass over the fully-built tracks, not inline in
  // buildTrack() like occlusionScore/visibilityScore/activityScore.
  const built = finished.map((track) => buildTrack(track, samples.length));
  const tracksWithoutSocial = built.map((b) => b.track);
  return built.map(({ track, proximityScore, convergenceScore, visibilityScore, activityScore }, index) => {
    const temporalOverlapScore = computeTemporalOverlapScore(track, tracksWithoutSocial);
    const partnerScore = computeCoOccurringPartnerScore(finished[index], finished);
    const interactionConfidence = computeInteractionConfidence(
      proximityScore,
      temporalOverlapScore,
      convergenceScore,
    );
    const socialScore = computeSocialScore(interactionConfidence, partnerScore, temporalOverlapScore);
    return {
      ...track,
      interactionConfidence,
      attentionScore: computeAttentionScore(visibilityScore, activityScore, socialScore),
    };
  });
}
