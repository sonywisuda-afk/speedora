import { z } from 'zod';
import { CAMERA_MOTION_DIRECTION_TYPES } from './scene-intelligence';

// Object Intelligence roadmap, Batch OI-1 (Foundation) - detects individual
// entities (people, vehicles, products, animals, everyday objects) within a
// clip via MediaPipe's Object Detector task (EfficientDet-Lite0, COCO
// 80-class, Apache 2.0 - chosen explicitly over YOLOv8/Ultralytics, whose
// AGPL-3.0 license would require open-sourcing this entire codebase or an
// Enterprise license for commercial use). Same "Python subprocess, JSON
// stdout" convention as every other MediaPipe-based detector in this
// pipeline (detectFaces/detectFacialEmotion/detectGestures/
// detectFaceLandmarks) - see @speedora/object-intelligence's detectObjects.
//
// This is a SEPARATE package from @speedora/scene-intelligence by explicit
// user direction: scene-intelligence covers global scene/camera
// characteristics (motion energy, camera motion, cuts); object-intelligence
// covers individual entities - detection, tracking, and per-object
// behavioral features. Mirrors how Face/Gesture/OCR Intelligence are each
// their own package around one foundational detector.

export const detectObjectsInputSchema = z.object({
  sourcePath: z.string().min(1),
  startTime: z.number(),
  endTime: z.number(),
});

// One detected entity within a single sampled frame. `category` is a plain
// string (not a z.enum of the 80 COCO labels) - COCO's label set is an
// externally-fixed model vocabulary, not a small taxonomy this codebase
// designed (unlike FACIAL_EMOTIONS/CAMERA_MOTION_TYPES) - a string avoids a
// brittle enum that has to stay in lockstep with whichever model file is
// deployed.
export const objectDetectionSchema = z.object({
  category: z.string().min(1),
  // Normalized [0, 1] bounding box, same convention as face-landmarks.ts's
  // boundingBox / ocr.ts's ocrTextBlockSchema.boundingBox.
  boundingBox: z.object({
    xCenter: z.number(),
    yCenter: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  confidence: z.number().min(0).max(1),
});

// A sampled frame's worth of object detections - an EMPTY array (not null)
// means "no objects found in this sampled frame", same "empty is a real
// result, not a failure" convention as ocrSampleSchema.textBlocks. A frame
// can have multiple simultaneous objects (two people, a person and a car),
// so this is an ARRAY per sample, same reasoning as OCR's multiple
// simultaneous text blocks.
export const objectSampleSchema = z.object({
  t: z.number(),
  objects: z.array(objectDetectionSchema),
});

export const detectObjectsOutputSchema = z.array(objectSampleSchema);

export type DetectObjectsInput = z.infer<typeof detectObjectsInputSchema>;
export type ObjectDetection = z.infer<typeof objectDetectionSchema>;
export type ObjectSample = z.infer<typeof objectSampleSchema>;
export type DetectObjectsOutput = z.infer<typeof detectObjectsOutputSchema>;

// One tracked object across its full lifetime in the clip -
// @speedora/object-intelligence's trackObjects() groups raw per-frame
// objectDetectionSchema entries into this, generalizing
// @speedora/ocr-intelligence's trackOcrText() (Batch OCR-2) into a genuine
// MULTI-object tracker (N active tracks vs. M per-frame detections, greedy
// lowest-cost-first assignment, track birth/death via a miss-tolerance
// counter) rather than Face Intelligence Batch 4's single-track Kalman
// tracker - a frame here can have many simultaneous objects, the same
// reason OCR's tracker (not Face's) is the right precedent. The one
// difference from OCR's match cost: `category` is a HARD gate here, not a
// weighted cost term - a "car" detection must never merge into a "person"
// track, since there's no text-similarity analog to fall back on.
export const objectTrackSchema = z.object({
  trackId: z.number().int(),
  // Every detection in a track shares this category (a hard constraint of
  // trackObjects()'s assignment cost, not just the first detection's
  // reading), so this is one representative value, not an average/vote.
  category: z.string().min(1),
  // Average bounding box/confidence across this track's own appearances,
  // same "representative average" convention as ocrTextTrackSchema.
  boundingBox: z.object({
    xCenter: z.number(),
    yCenter: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  confidence: z.number().min(0).max(1),
  // Clip-relative seconds of this track's first/last appearance - this IS
  // the "objectEntryExit" feature from the user's original taxonomy, no
  // extra computation needed beyond the tracker itself.
  startTime: z.number(),
  endTime: z.number(),
  // endTime - startTime - can be larger than appearsFrames-worth-of-samples
  // if the track survived a brief occlusion gap (a miss tolerance, see
  // MAX_MISS_SAMPLES in track-objects.ts) - not the same as
  // appearsFrames * sample interval.
  durationSeconds: z.number().min(0),
  appearsFrames: z.number().int().min(1),
  // appearsFrames / total samples in the WHOLE clip - "what fraction of the
  // entire clip was this object visible for". This IS the
  // "objectPersistence" feature from the user's original taxonomy.
  persistenceScore: z.number().min(0).max(1),
  // Batch OI-2 - "objectMotionSpeed" from the user's original taxonomy.
  // Average frame-to-frame bounding-box-center movement across this track's
  // own appearances, normalized to [0, 1] - same shape and same
  // normalize-at-derive-time convention as @speedora/ocr-intelligence's
  // ocrTextTrackSchema.motionScore (see track-objects.ts's own
  // OBJECT_MOTION_CAP comment for the normalization threshold). Null when
  // this track only appeared in a single frame (nothing to measure movement
  // between).
  motionSpeed: z.number().min(0).max(1).nullable(),
  // Batch OI-2 - "objectMotionDirection" from the user's original taxonomy.
  // Net movement direction from this track's first to last appearance,
  // classified with the SAME zoom-then-pan/tilt priority logic as
  // deriveCameraMotionFeatures() (packages/scene-intelligence) - reuses
  // CameraMotionDirectionType directly rather than a near-duplicate object-
  // specific enum, since the taxonomy is genuinely the same concept: screen-
  // space movement plus toward/away-from-camera (a shrinking/growing
  // bounding box is this track's analog of camera zoom in/out). Null under
  // the same single-appearance condition as motionSpeed above.
  motionDirection: z.enum(CAMERA_MOTION_DIRECTION_TYPES).nullable(),
  // Batch OI-3 - "objectOcclusion" from the user's original taxonomy.
  // Average, across this track's own appearances, of the highest IoU
  // between this track's detection and any OTHER SIMULTANEOUS detection in
  // the same sampled frame (any category - a person can occlude another
  // person just as easily as a car can occlude a person, unlike
  // trackObjects()'s own category hard-gate for continuing a track). An
  // honest PROXY for occlusion, not a real depth/z-order signal - two
  // overlapping bounding boxes doesn't prove one is actually behind the
  // other, only that they're close together in the frame (same "coarse
  // proxy, not ground truth" caveat as @speedora/facial-intelligence's
  // mouthContrastRatio). Never null - every track has at least one
  // appearance, and a frame with no other objects simply scores 0 for that
  // appearance (a real "not occluded", not "unknown").
  occlusionScore: z.number().min(0).max(1),
  // Batch OI-4 - "objectInteraction" from the user's original taxonomy,
  // deliberately named/exposed as `interactionConfidence` rather than a bare
  // "interactionScore" or "isInteracting" - this pipeline has NO depth
  // estimation, pose estimation, or action recognition, so it cannot
  // determine that two entities are actually interacting (touching, holding,
  // conversing, etc.). The name is chosen to be honest about what this
  // number IS: a confidence/likelihood heuristic that interaction is
  // PLAUSIBLE, built entirely from geometry/timing already available, never
  // a semantic claim of real interaction. A composite of three independently
  // unweighted [0, 1] components (see track-objects.ts's
  // computeInteractionConfidence() for the exact formulas):
  //   1. proximity - closeness to the nearest other simultaneous detection
  //      (same geometric idea as occlusionScore, but center-distance-based
  //      rather than IoU-based, so near-but-not-overlapping objects - e.g.
  //      two people standing close and talking - score meaningfully above 0
  //      here while scoring exactly 0 on occlusion).
  //   2. temporal co-presence - what fraction of this track's own screen
  //      time overlaps with the track it shares the most screen time with.
  //      Two objects that coexist on screen for a long stretch read as more
  //      plausibly interacting than two that each flash by separately, even
  //      before considering how close together they were.
  //   3. distance trend ("convergence") - whether this track's own nearest-
  //      neighbor distance is shrinking (closing in) or growing (moving
  //      apart) across its appearances, using the SAME nearest-distance
  //      series proximity is computed from. 0.5 (neutral) when there isn't
  //      enough appearance history to judge a trend, not null - see #4 below
  //      for why this field stays a plain number even then.
  // Every threshold/cap here is a reasonable, uncalibrated guess - none of
  // this has been validated against real footage or real engagement data,
  // same "kejujuran skala" honesty as every other heuristic in this
  // pipeline. Never null - every track has at least one appearance, and a
  // track with no nearby/co-occurring objects at all simply scores low
  // across all three components (a real "nothing else around"), not
  // "unknown".
  interactionConfidence: z.number().min(0).max(1),
  // Batch OI-5 - "objectAttentionScore" from the user's original taxonomy
  // ("kontribusi objek terhadap fokus visual" - this object's contribution
  // to visual focus). Deliberately NOT a flat average over five raw signals
  // - explicit user redesign mid-batch: a "fusion internal" for Object
  // Intelligence, built the same way the top-level Fusion Engine is built,
  // with an intermediate layer of named, independently-explainable DOMAINS
  // rather than one undifferentiated bag of numbers:
  //
  //   Detection -> Tracking -> Motion -> Occlusion -> Interaction
  //     -> [Visibility, Activity, Social] -> Object Attention
  //
  //   1. Visibility = average(confidence, persistenceScore,
  //      1 - occlusionScore) - "how much and how clearly was this object
  //      actually on screen". Always computable (every track has a
  //      confidence, a persistenceScore, and an occlusionScore).
  //   2. Activity = average of whichever of {motionSpeed,
  //      motionPersistence, directionConsistency} are available - "how much
  //      and how coherently did this object move". 0.5 (neutral) when a
  //      track has only one appearance and none of the three are
  //      computable - same "insufficient history -> neutral, not null"
  //      convention as this file's own convergenceScore, so the three-
  //      domain average below always has a real number to work with.
  //   3. Social = average(interactionConfidence, partnerScore,
  //      coPresenceScore) - "how much did this object share the frame with
  //      others". Always computable (see track-objects.ts).
  //
  //   attentionScore = average(visibilityScore, activityScore, socialScore)
  //
  // This "domain of domains" shape is deliberately easier to explain than a
  // flat five-way average would be - each domain has one clear question it
  // answers, and attentionScore is just "how did this object do across the
  // three questions", not an opaque blend of unrelated numbers. Every
  // cap/threshold behind these components is a reasonable, uncalibrated
  // guess, same "kejujuran skala" honesty as every other heuristic in this
  // pipeline. Never null - every domain is always computable for any track.
  attentionScore: z.number().min(0).max(1),
  // Batch OI-5 - a SEPARATE reliability signal for attentionScore above,
  // not a sixth ingredient folded into it. Same distinction Speaker
  // Intelligence's speakerConfidenceScoreSchema draws between "what is the
  // score" and "how much do we trust it": a track that appears for a single
  // frame can still score high on attentionScore (e.g. large, centered,
  // briefly alone in frame) purely from geometry, but that reading rests on
  // almost no observation - attentionConfidence is what flags that. Based
  // purely on appearsFrames (raw observed-frame count, capped - see
  // track-objects.ts's CONFIDENCE_FRAME_CAP), deliberately NOT
  // persistenceScore - a 3-frame track means the same ~3 seconds of actual
  // observation whether the clip has 5 total samples or 500, while
  // persistenceScore would swing wildly between those two clips for
  // identical evidence. Never null - every track has at least one
  // appearance.
  attentionConfidence: z.number().min(0).max(1),
});

export const detectObjectsTracksOutputSchema = z.array(objectTrackSchema);

export type ObjectTrack = z.infer<typeof objectTrackSchema>;

// Derived summary (see packages/contracts/src/intelligence-signal.ts) - the
// dense per-clip numbers the Fusion Engine actually consumes, computed from
// the tracks above by @speedora/object-intelligence's
// deriveObjectFeatures(). All nullable, null exactly when zero samples were
// ever taken (analysis wasn't run/failed) - a real 0 (e.g. "no objects ever
// detected") is a meaningful value, not "unknown".
export const objectFeaturesSchema = z.object({
  // Count of DISTINCT tracked objects across the whole clip (not a
  // per-frame count) - the "objectCount" feature from the user's original
  // taxonomy.
  objectCount: z.number().int().nonnegative().nullable(),
  // Most frequent category among all tracks, weighted by appearsFrames (not
  // just track count, so one long-lived object outweighs several one-frame
  // misdetections) - same weighting convention as ocrFeaturesSchema's
  // dominantTextCategory. Ties broken by first occurrence. Null when zero
  // tracks were ever found.
  dominantObject: z.string().nullable(),
  // Average number of objects detected per sampled frame - a density (not
  // yet 0-1 bounded, normalized later in fusion-engine), same convention as
  // ocrFeaturesSchema's averageTextBlockCount.
  averageObjectsPerFrame: z.number().nonnegative().nullable(),
  // Mean confidence across all tracks - the "objectTrackingConfidence"
  // feature from the user's original taxonomy.
  averageTrackingConfidence: z.number().min(0).max(1).nullable(),
  // Mean persistenceScore across all tracks - the clip-level rollup of the
  // per-track "objectPersistence" feature above.
  averagePersistence: z.number().min(0).max(1).nullable(),
  // Batch OI-2 - mean motionSpeed across tracks that have a non-null value
  // (single-appearance tracks are excluded, not treated as 0) - "how much
  // movement is happening among tracked objects overall". Null when there
  // are zero tracks with a computable motionSpeed.
  averageMotionSpeed: z.number().min(0).max(1).nullable(),
  // Batch OI-3 - mean occlusionScore across all tracks. Null only when
  // there are zero tracks to average (occlusionScore itself is never null
  // per-track, unlike motionSpeed).
  averageOcclusionScore: z.number().min(0).max(1).nullable(),
  // Batch OI-4 - mean interactionConfidence across all tracks. Null only
  // when there are zero tracks to average (interactionConfidence itself is
  // never null per-track, same convention as averageOcclusionScore).
  averageInteractionConfidence: z.number().min(0).max(1).nullable(),
  // Batch OI-5 - mean attentionScore across all tracks. Null only when
  // there are zero tracks to average (attentionScore itself is never null
  // per-track, same convention as averageOcclusionScore/
  // averageInteractionConfidence). A clip-wide AVERAGE, diluted by any
  // background/incidental objects rather than isolating the single most
  // attention-grabbing one - kept consistent with every other `averageX`
  // aggregate's shape rather than introducing a different (e.g. max-based)
  // aggregation without a clear reason to.
  averageAttentionScore: z.number().min(0).max(1).nullable(),
  // Batch OI-5 - mean attentionConfidence across all tracks. Null only when
  // there are zero tracks to average (attentionConfidence itself is never
  // null per-track). A clip made up mostly of brief, flickering detections
  // will show a low averageAttentionConfidence even if averageAttentionScore
  // itself looks high - the two are meant to be read together, not as one
  // combined number.
  averageAttentionConfidence: z.number().min(0).max(1).nullable(),
});

export type ObjectFeatures = z.infer<typeof objectFeaturesSchema>;
