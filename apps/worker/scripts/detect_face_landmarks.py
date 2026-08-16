#!/usr/bin/env python3
"""
AI Fusion roadmap - Face Intelligence initiative, Batch 1 (+ Batch 2's iris
points, Batch 3's image-quality/occlusion metrics - all the same subprocess
call). Samples frames from a clip's time range, runs MediaPipe's
FaceLandmarker Task (468 face-mesh points + 10 iris points + 52 blendshape
scores + a facial transformation matrix per detected face) on each one,
crops the face region from the SAME already-read frame for a few pixel-
level OpenCV measurements, and prints a JSON array to stdout:

  [{
    "t": <seconds from clip start>,
    "blendshapes": {"eyeBlinkLeft", "eyeBlinkRight", "mouthSmileLeft",
                     "mouthSmileRight", "jawOpen"} | null,
    "rotation": {"pitch", "yaw", "roll"} (degrees) | null,
    "boundingBox": {"xCenter", "yCenter", "width", "height"} (normalized) | null,
    "leftIris" / "rightIris": {"x", "y", "z"} | null,
    "leftEyeInnerCorner" / "leftEyeOuterCorner" /
    "rightEyeInnerCorner" / "rightEyeOuterCorner": {"x", "y", "z"} | null,
    "sharpness": <float, raw Laplacian variance> | null,
    "brightness": <float, 0-255 mean grayscale> | null,
    "mouthContrastRatio": <float> | null,
    "faceDescriptor": [<float>, ...] (9 scale-invariant ratios) | null,
    "trackId": <int> | null,
    "mouthWidth": <float, scale-invariant ratio> | null
  }, ...]

null across every field means "no face found in this sampled frame" - same
convention as detect_faces.py/detect_facial_emotion.py, never crashes the
whole process over one bad sample.

Uses the SAME "most prominent face" heuristic as detect_faces.py (Fase 2)
when more than one face is detected in a frame - picked by bounding-box
area derived from the landmark cloud's own min/max extent (FaceLandmarker's
output has no separate detection-confidence bounding box the way
FaceDetector does).

Needs a SEPARATE model file from detect_faces.py's blaze_face_short_range -
FaceLandmarker's own `.task` bundle (not a bare `.tflite`), downloaded from
MediaPipe's model zoo (see apps/worker/README.md for the URL). Passed as a
CLI arg, same "deployment config flows through deps + CLI args" convention
as every other script here.

Landmark indices for eye corners/iris centers below (33/133/362/263 for eye
corners, 468/473 for iris centers) are MediaPipe's own published canonical
Face Mesh indices (stable across the "with attention"/iris-refinement model
variant this script requires) - "left"/"right" is ANATOMICAL (the subject's
own left/right eye, matching MediaPipe's own landmark map naming), not
image-left/image-right.

Head pose (pitch/yaw/roll) is decomposed from FaceLandmarker's own 4x4
facial transformation matrix via the standard XYZ rotation-matrix-to-Euler
decomposition (see rotation_matrix_to_euler_degrees below) - yaw=pitch=
roll=0 means looking straight at the camera.

Batch 3 (Blur/Sharpness/Lighting/Occlusion) - `sharpness` is the Laplacian
variance (cv2.Laplacian(...).var()) of the WHOLE face crop in grayscale, a
standard, widely-used blur-detection measurement (higher = sharper; this
one raw number serves BOTH "Blur Detection" and "Face Sharpness Score" from
the original feature list - they're the same underlying measurement read
in opposite directions, not two separate things to compute).
`brightness` is the crop's mean grayscale pixel value (0-255) - "Face
Lighting Score"'s raw input. `mouthContrastRatio` is the mouth region's OWN
local Laplacian variance divided by the whole-face-crop's variance - a
COARSE occlusion proxy (a hand/object covering the mouth tends to be much
smoother/flatter than the surrounding textured face, producing a low
ratio), NOT a trained occlusion detector; see
deriveFaceLandmarkFeatures's own comment on how this becomes
`occlusionRate`. Mouth region cropped from 4 canonical outer-lip landmark
indices (61/291 corners, 13/14 upper/lower lip).

Batch 4 (Face Re-identification/Tracking, AI Fusion roadmap) - explicit user
architectural direction: strengthen single-object tracking with a Kalman
Filter (motion prediction/smoothing through brief misdetections) + Hungarian
Assignment (scipy.optimize.linear_sum_assignment, a principled cost-matrix
matching decision) + IoU (bounding-box overlap) + pose consistency (head-
rotation continuity), rather than a plain frame-to-frame threshold. This
project still only detects the SINGLE most prominent face per frame
(num_faces=1 above, unchanged) - there's no multi-face data association
problem to solve here, but the SAME formal cost-matrix + Hungarian-solver
machinery used for real multi-object tracking still adds genuine value in
this single-track case: the Kalman filter coasts the track THROUGH brief
gaps (a frame or two where detection fails) instead of a gap spuriously
looking like "the speaker left and a new one appeared", and the fused
IoU+descriptor+pose cost is a more principled same-track/new-track decision
than a single raw threshold on any one signal alone. See FaceTracker below.
`trackId` (a simple incrementing integer, new track each time the tracker
decides "this is not a continuation") is this script's ONLY new raw output
field for Batch 4 - @speedora/facial-intelligence's deriveFaceLandmarkFeatures
derives speakerChangeCount/dominantSpeakerConsistency from the resulting
sequence of trackIds, and (Speaker Face Selection's "real" version, replacing
Fase 2's plain largest-bounding-box heuristic) speakerAudioSyncRate by
correlating this script's own jawOpen blendshape against the clip's
transcript segments' audio loudness (Fase 25) - that correlation happens in
TypeScript (render-clip.worker.ts already has both in scope at the same
point it calls this script), not here, since this script has no access to
audio/transcript data at all.

The geometric descriptor used for the "appearance" half of the tracking cost
(FACE_DESCRIPTOR_LANDMARKS below) is a set of scale-invariant inter-landmark
distance RATIOS (each divided by inter-ocular distance, the standard face-
geometry normalization unit) - explicitly NOT a trained face-recognition
embedding (see CLAUDE.md's Fase 36 section for why: explicit user direction
to avoid a new heavy ML dependency like dlib/face_recognition). This is a
real accuracy/simplicity trade-off: geometric ratios are far less
discriminative between two similar-looking individuals than a trained
embedding would be, particularly across head-rotation, which is the reason
pose consistency is ALSO folded into the tracking cost (partially
compensating by trusting appearance less when the head has turned a lot
between frames).

Batch 5A (Lip Activity, AI Fusion roadmap) - pure TypeScript derivation from
the existing jawOpen blendshape sequence (averageLipVelocity/
speakingIntensity/pauseCount/articulationRate, see
@speedora/facial-intelligence's deriveFaceLandmarkFeatures) - no changes to
this script at all for that sub-batch.

Batch 5B (Smile & Laugh, AI Fusion roadmap) - user's own split of the
original "Batch 5" plan into 5A/5B/5C/5D. Adds 4 more of MediaPipe's 52
blendshape categories to TRACKED_BLENDSHAPES (cheekSquintLeft/Right,
eyeSquintLeft/Right - the orbicularis-oculi "eye crinkle"/cheek-raise
markers of a GENUINE, "Duchenne" smile, as opposed to a posed one that only
activates the mouth), plus a new raw field `mouthWidth` - corner-to-corner
mouth distance normalized by inter-ocular baseline (mouth_width_ratio()
below), the SAME scale-invariant normalization convention as
face_descriptor()'s ratios, computed as its OWN independent function rather
than reused from inside face_descriptor()'s opaque array (that one is
documented as a tracking-only fingerprint, not meant to be read field-by-
field; mouthWidth here is a genuinely meaningful, independently-named
feature). @speedora/facial-intelligence's deriveFaceLandmarkFeatures derives
averageMouthWidth/averageCheekRaise/averageEyeSquint plus a `genuineSmileRate`
heuristic (fraction of "smiling" samples that ALSO show cheek-raise + eye-
squint) from these - see that module's own honest caveat on why this is a
coarse threshold heuristic, not a trained/validated Duchenne-smile classifier.

Batch 5C (Blink & Eye Behavior, AI Fusion roadmap) - pure TypeScript
derivation from data already collected since Batch 1 (blink blendshapes)
and Batch 2 (iris/eye-corner landmarks) - blinkFrequencyPerMinute/
prolongedClosureCount/gazeStabilityScore, see
@speedora/facial-intelligence's deriveFaceLandmarkFeatures - no changes to
this script at all for that sub-batch either.

Batch 5D (Emotion Heuristic, AI Fusion roadmap) - the last sub-batch of
user's 5A/5B/5C/5D split. Adds 5 more blendshape categories to
TRACKED_BLENDSHAPES (browDownLeft/Right, browInnerUp, browOuterUpLeft/
Right - eyebrow movement, tracked as an undirected MAGNITUDE, not "raised
vs furrowed", per user's own explicit safety requirement below) plus a new
raw field `averageHeadMovementRate` derivation input (this script already
emits `rotation` per sample - no NEW raw field needed here, the head-
movement RATE is computed in TypeScript from the existing rotation
sequence). @speedora/facial-intelligence's deriveFaceLandmarkFeatures
combines Smile (Batch 1/5B) + Jaw/Speaking (Batch 1/5A) + Eyebrow (this
batch) + Head movement (this batch, from existing rotation) into a
`dominantAffect` heuristic label - user's explicit instruction: "Jangan
langsung mengklaim 'sedih' atau 'marah', tetapi gunakan label seperti:
positive affect, high energy, low energy, expressive, neutral" - so the
output vocabulary is deliberately restricted to those 5 safe labels, never
a discrete emotion name, and the whole thing is a simple deterministic
decision tree (not a trained classifier) - see that module's own caveat.

PENDING REAL-MACHINE VERIFICATION: written in a sandbox with neither Python
nor a real video file available, same honest gap as every other MediaPipe-
based script in this pipeline (detect_faces.py/detect_facial_emotion.py/
detect_gestures.py). Specifically unverified before trusting this in
production: (1) that facial_transformation_matrixes' rotation submatrix
actually follows the XYZ convention this decomposition assumes - MediaPipe's
own docs don't spell out the exact Euler convention, only that it's a
right-handed transform matrix; (2) that the eye-corner/iris/mouth/descriptor
landmark indices above are exactly right for THIS model variant (canonical
Face Mesh indices are stable and well-published, but only cross-referenced
against documentation here, never run against a real face); (3) that
mouthContrastRatio's threshold (see the deriving module) actually
distinguishes real occlusion from a closed, naturally-smooth mouth/chin -
the least-confident heuristic in this script; (4) the tracking cost weights/
MATCH_THRESHOLD/MAX_MISSES below (Batch 4) are reasonable starting guesses,
not calibrated against any real multi-speaker footage.

Usage: detect_face_landmarks.py <video_path> <start_seconds> <end_seconds> <interval_seconds> <model_path>
"""
import json
import math
import sys

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions
from scipy.optimize import linear_sum_assignment

# Canonical MediaPipe Face Mesh (with-attention/iris) indices - anatomical
# left/right, see module comment.
LEFT_EYE_INNER_CORNER = 133
LEFT_EYE_OUTER_CORNER = 33
RIGHT_EYE_INNER_CORNER = 362
RIGHT_EYE_OUTER_CORNER = 263
LEFT_IRIS_CENTER = 468
RIGHT_IRIS_CENTER = 473

# Canonical MediaPipe Face Mesh outer-lip landmark indices (Batch 3) - used
# to crop just the mouth region for mouthContrastRatio, not a full lip
# contour (a coarse bounding box across these 4 points is enough for a
# region-level texture comparison, no need for the full ~20-point lip
# outline).
MOUTH_LEFT_CORNER = 61
MOUTH_RIGHT_CORNER = 291
MOUTH_UPPER_LIP = 13
MOUTH_LOWER_LIP = 14

# Batch 4 (Face Re-identification/Tracking) - additional canonical landmark
# indices for the geometric descriptor, beyond the eye/mouth ones already
# named above. NOSE_TIP/CHIN/FOREHEAD_TOP are commonly-cited canonical
# MediaPipe Face Mesh indices (see module docstring's verification caveat).
NOSE_TIP = 1
CHIN = 152
FOREHEAD_TOP = 10


def landmark_xy(landmark):
    return landmark.x, landmark.y


def euclidean_distance(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def face_descriptor(landmarks):
    """Scale-invariant geometric "fingerprint" for the detected face - a
    fixed-length vector of inter-landmark distance RATIOS (each divided by
    inter-ocular distance, the standard face-geometry normalization unit),
    computed in the x/y plane only (z omitted - MediaPipe's z is relative
    to face size with less-standardized scale than x/y, see module
    docstring). Explicitly NOT a trained face-recognition embedding - see
    module docstring's honest trade-off note. Returns None if the ocular
    baseline itself is degenerate (near-zero distance)."""
    left_eye = landmark_xy(landmarks[LEFT_EYE_OUTER_CORNER])
    right_eye = landmark_xy(landmarks[RIGHT_EYE_OUTER_CORNER])
    baseline = euclidean_distance(left_eye, right_eye)
    if baseline < 1e-6:
        return None

    nose = landmark_xy(landmarks[NOSE_TIP])
    chin = landmark_xy(landmarks[CHIN])
    forehead = landmark_xy(landmarks[FOREHEAD_TOP])
    mouth_left = landmark_xy(landmarks[MOUTH_LEFT_CORNER])
    mouth_right = landmark_xy(landmarks[MOUTH_RIGHT_CORNER])

    return [
        euclidean_distance(nose, left_eye) / baseline,
        euclidean_distance(nose, right_eye) / baseline,
        euclidean_distance(nose, chin) / baseline,
        euclidean_distance(mouth_left, mouth_right) / baseline,
        euclidean_distance(mouth_left, nose) / baseline,
        euclidean_distance(mouth_right, nose) / baseline,
        euclidean_distance(chin, left_eye) / baseline,
        euclidean_distance(chin, right_eye) / baseline,
        euclidean_distance(forehead, chin) / baseline,
    ]


def mouth_width_ratio(landmarks):
    """Scale-invariant mouth width - corner-to-corner distance divided by
    the same inter-ocular baseline distance face_descriptor() uses -
    computed independently here (not extracted from face_descriptor()'s own
    return value) since THIS is a genuinely meaningful, individually-named
    feature (Batch 5B), unlike face_descriptor()'s array, which is an opaque
    tracking-only fingerprint not meant to be read field-by-field. Returns
    None if the ocular baseline is degenerate, same guard as
    face_descriptor()."""
    left_eye = landmark_xy(landmarks[LEFT_EYE_OUTER_CORNER])
    right_eye = landmark_xy(landmarks[RIGHT_EYE_OUTER_CORNER])
    baseline = euclidean_distance(left_eye, right_eye)
    if baseline < 1e-6:
        return None
    mouth_left = landmark_xy(landmarks[MOUTH_LEFT_CORNER])
    mouth_right = landmark_xy(landmarks[MOUTH_RIGHT_CORNER])
    return euclidean_distance(mouth_left, mouth_right) / baseline


def descriptor_distance(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def iou(box_a, box_b):
    """Intersection-over-union of two {xCenter, yCenter, width, height}
    boxes (normalized [0,1] coordinates, same convention as boundingBox
    elsewhere in this script)."""
    ax0, ay0 = box_a["xCenter"] - box_a["width"] / 2, box_a["yCenter"] - box_a["height"] / 2
    ax1, ay1 = box_a["xCenter"] + box_a["width"] / 2, box_a["yCenter"] + box_a["height"] / 2
    bx0, by0 = box_b["xCenter"] - box_b["width"] / 2, box_b["yCenter"] - box_b["height"] / 2
    bx1, by1 = box_b["xCenter"] + box_b["width"] / 2, box_b["yCenter"] + box_b["height"] / 2

    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    intersection = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
    area_a = box_a["width"] * box_a["height"]
    area_b = box_b["width"] * box_b["height"]
    union = area_a + area_b - intersection
    return intersection / union if union > 0 else 0.0


def pose_distance(rotation_a, rotation_b):
    """Euclidean distance between two {pitch, yaw, roll} readings, degrees -
    the "pose consistency" cost component: a large head-rotation jump
    between consecutive frames is itself evidence against "same person,
    same pose continuity", independent of appearance/position."""
    return math.sqrt(
        (rotation_a["pitch"] - rotation_b["pitch"]) ** 2
        + (rotation_a["yaw"] - rotation_b["yaw"]) ** 2
        + (rotation_a["roll"] - rotation_b["roll"]) ** 2
    )


# Tracking cost weights and thresholds (Batch 4) - reasonable starting
# guesses, not calibrated against real multi-speaker footage (see module
# docstring's verification caveat). IOU_WEIGHT dominates (position/size is
# the most reliable single cue frame-to-frame); DESCRIPTOR_WEIGHT and
# POSE_WEIGHT are normalized against their own typical scales
# (DESCRIPTOR_NORM/POSE_NORM_DEGREES) before being combined.
IOU_WEIGHT = 0.5
DESCRIPTOR_WEIGHT = 0.35
POSE_WEIGHT = 0.15
DESCRIPTOR_NORM = 0.5
POSE_NORM_DEGREES = 60.0
# Assignment cost above this means "not a match" - start a new track rather
# than continue the old one.
MATCH_THRESHOLD = 0.6
# Consecutive undetected frames after which the tracker gives up predicting
# through the gap (too much time/uncertainty has passed to trust the Kalman
# coast) - the next real detection starts a fresh track rather than
# reconnecting to a track this stale.
MAX_MISSES = 5


class FaceTracker:
    """Single-object tracker (this script only ever has one detection per
    frame - see module docstring on why Hungarian assignment still adds
    value even so): a constant-velocity Kalman filter over
    [xCenter, yCenter, width, height] predicts/smooths the track's
    bounding box every frame, and a fused IoU+descriptor+pose cost (solved
    via scipy's Hungarian algorithm, even though it's a trivial 1x1 matrix
    here) decides whether a new detection continues the current track or
    starts a new one."""

    def __init__(self):
        self.kalman = None
        self.track_id = 0
        self.last_descriptor = None
        self.last_rotation = None
        self.misses = 0
        self.initialized = False

    def _init_kalman(self, box):
        kalman = cv2.KalmanFilter(8, 4)
        kalman.transitionMatrix = np.array(
            [
                [1, 0, 0, 0, 1, 0, 0, 0],
                [0, 1, 0, 0, 0, 1, 0, 0],
                [0, 0, 1, 0, 0, 0, 1, 0],
                [0, 0, 0, 1, 0, 0, 0, 1],
                [0, 0, 0, 0, 1, 0, 0, 0],
                [0, 0, 0, 0, 0, 1, 0, 0],
                [0, 0, 0, 0, 0, 0, 1, 0],
                [0, 0, 0, 0, 0, 0, 0, 1],
            ],
            dtype=np.float32,
        )
        kalman.measurementMatrix = np.array(
            [
                [1, 0, 0, 0, 0, 0, 0, 0],
                [0, 1, 0, 0, 0, 0, 0, 0],
                [0, 0, 1, 0, 0, 0, 0, 0],
                [0, 0, 0, 1, 0, 0, 0, 0],
            ],
            dtype=np.float32,
        )
        kalman.processNoiseCov = np.eye(8, dtype=np.float32) * 1e-3
        kalman.measurementNoiseCov = np.eye(4, dtype=np.float32) * 1e-2
        measurement = np.array(
            [box["xCenter"], box["yCenter"], box["width"], box["height"]], dtype=np.float32
        )
        # cv2.KalmanFilter's statePre/statePost need a real (n, 1) COLUMN VECTOR, not a flat
        # (n,) 1D array - a well-known cv2 Python-binding gotcha (a flat array binds to an
        # ambiguously-shaped Mat, not the 8x1 predict()/correct() itself expects). Without the
        # reshape here, the very next predict() call throws a real
        # "cv::gemm ... a_size.width == len" assertion - found for real by Phase D's benchmark
        # (docs/ai/phase-d-benchmark.md) the first time this tracker ever ran against a real,
        # actually-loaded model + a real trackable face (every prior run either lacked the model
        # file or used a synthetic clip with nothing to track, so this was never exercised).
        state = np.concatenate([measurement, np.zeros(4, dtype=np.float32)])
        kalman.statePre = state.reshape(-1, 1)
        kalman.statePost = state.reshape(-1, 1).copy()
        return kalman

    def _predicted_box(self):
        # predict() now returns a real (8, 1) column vector (matching the corrected statePre/
        # statePost shape above), not the flat (8,) array this code originally assumed -
        # .flatten() first so state[i] below yields a real scalar again, not a (1,)-shaped
        # sub-array (which newer numpy refuses to implicitly convert via float()).
        state = self.kalman.predict().flatten()
        return {
            "xCenter": float(state[0]),
            "yCenter": float(state[1]),
            "width": float(state[2]),
            "height": float(state[3]),
        }

    def update(self, box, descriptor, rotation):
        """Feeds one frame's detection through the tracker, returning the
        trackId this detection belongs to (starting a new one if the cost
        against the current track's prediction is too high, or if the
        track had already gone stale past MAX_MISSES)."""
        if not self.initialized:
            self.kalman = self._init_kalman(box)
            self.initialized = True
            self.misses = 0
            self.last_descriptor = descriptor
            self.last_rotation = rotation
            return self.track_id

        predicted = self._predicted_box()

        cost = IOU_WEIGHT * (1 - iou(predicted, box))
        if descriptor is not None and self.last_descriptor is not None:
            cost += DESCRIPTOR_WEIGHT * min(
                1.0, descriptor_distance(descriptor, self.last_descriptor) / DESCRIPTOR_NORM
            )
        if rotation is not None and self.last_rotation is not None:
            cost += POSE_WEIGHT * min(
                1.0, pose_distance(rotation, self.last_rotation) / POSE_NORM_DEGREES
            )

        # Trivial 1x1 Hungarian assignment - see module docstring on why
        # the formal solver is still used even for a single detection
        # against a single predicted track.
        row_ind, col_ind = linear_sum_assignment(np.array([[cost]]))
        assigned_cost = cost if len(row_ind) > 0 else float("inf")

        is_match = assigned_cost <= MATCH_THRESHOLD and self.misses <= MAX_MISSES
        if is_match:
            # Same (n, 1) column-vector requirement as statePre/statePost in _init_kalman()
            # above - correct() happens not to crash on a flat array in practice, but shaping
            # it explicitly here too removes any doubt for a future cv2 version.
            measurement = np.array(
                [box["xCenter"], box["yCenter"], box["width"], box["height"]], dtype=np.float32
            ).reshape(-1, 1)
            self.kalman.correct(measurement)
        else:
            self.track_id += 1
            self.kalman = self._init_kalman(box)

        self.misses = 0
        self.last_descriptor = descriptor
        self.last_rotation = rotation
        return self.track_id

    def mark_missed(self):
        """No detection this frame - let the Kalman filter coast (predict-
        only, no correct()) rather than immediately breaking the track."""
        if self.initialized:
            self.kalman.predict()
            self.misses += 1

# The blendshape categories Batch 1 (eyeBlink*/mouthSmile*/jawOpen) and
# Batch 5B (cheekSquint*/eyeSquint* - the Duchenne-smile markers, see module
# docstring) derived features actually consume, out of MediaPipe's full
# 52-category ARKit-compatible output - see
# packages/contracts/src/face-landmarks.ts's faceBlendshapesSchema.
TRACKED_BLENDSHAPES = {
    "eyeBlinkLeft",
    "eyeBlinkRight",
    "mouthSmileLeft",
    "mouthSmileRight",
    "jawOpen",
    "cheekSquintLeft",
    "cheekSquintRight",
    "eyeSquintLeft",
    "eyeSquintRight",
    # Batch 5D (Emotion Heuristic) - eyebrow movement magnitude, one of the
    # signals @speedora/facial-intelligence's deriveFaceLandmarkFeatures
    # combines (with Smile/Jaw/Head-movement/Speaking) into a deliberately
    # SAFE, non-diagnostic affect label (positive_affect/high_energy/
    # low_energy/expressive/neutral - explicitly NOT "happy"/"sad"/"angry").
    # Both "up" and "down" directions are tracked and averaged together
    # into one magnitude - this heuristic only cares about HOW MUCH the
    # eyebrows are moving, not which direction, so it can't be
    # misread as a directional (raised=positive) claim.
    "browDownLeft",
    "browDownRight",
    "browInnerUp",
    "browOuterUpLeft",
    "browOuterUpRight",
}


def rotation_matrix_to_euler_degrees(matrix):
    """Standard XYZ (aerospace) Euler decomposition of a 3x3 rotation
    matrix (the top-left 3x3 of MediaPipe's 4x4 facial_transformation_matrix)
    into pitch (X), yaw (Y), roll (Z) degrees. See module docstring's
    verification caveat on this convention."""
    r = matrix
    sy = math.sqrt(r[0][0] * r[0][0] + r[1][0] * r[1][0])
    singular = sy < 1e-6
    if not singular:
        pitch = math.atan2(r[2][1], r[2][2])
        yaw = math.atan2(-r[2][0], sy)
        roll = math.atan2(r[1][0], r[0][0])
    else:
        pitch = math.atan2(-r[1][2], r[1][1])
        yaw = math.atan2(-r[2][0], sy)
        roll = 0.0
    return {
        "pitch": round(math.degrees(pitch), 2),
        "yaw": round(math.degrees(yaw), 2),
        "roll": round(math.degrees(roll), 2),
    }


def point_from_landmark(landmark):
    return {"x": landmark.x, "y": landmark.y, "z": landmark.z}


def bounding_box_from_landmarks(landmarks):
    xs = [lm.x for lm in landmarks]
    ys = [lm.y for lm in landmarks]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    return {
        "xCenter": (x_min + x_max) / 2,
        "yCenter": (y_min + y_max) / 2,
        "width": x_max - x_min,
        "height": y_max - y_min,
    }


def pixel_bbox_from_landmark_indices(landmarks, indices, frame_width, frame_height):
    """Pixel-space (x0, y0, x1, y1) bounding box across just the given
    landmark indices - used for both the whole-face crop (all 468 points)
    and the smaller mouth-region crop (4 points), same conversion either
    way."""
    xs = [landmarks[i].x for i in indices]
    ys = [landmarks[i].y for i in indices]
    x0 = max(0, int(min(xs) * frame_width))
    y0 = max(0, int(min(ys) * frame_height))
    x1 = min(frame_width, int(max(xs) * frame_width))
    y1 = min(frame_height, int(max(ys) * frame_height))
    return x0, y0, x1, y1


def laplacian_variance(gray_crop):
    """Standard OpenCV blur-detection measurement - higher variance means
    more high-frequency detail (sharper); a heavily blurred/smooth region
    has little edge content and a low variance. Serves both "sharpness"
    (read directly) and "mouth contrast ratio" (read relative to the whole
    face crop's own variance) below."""
    return float(cv2.Laplacian(gray_crop, cv2.CV_64F).var())


def main() -> None:
    video_path = sys.argv[1]
    start = float(sys.argv[2])
    end = float(sys.argv[3])
    interval = float(sys.argv[4])
    model_path = sys.argv[5]

    results = []
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps(results))
        return

    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        num_faces=1,
        min_face_detection_confidence=0.5,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
    )

    def empty_sample(t):
        return {
            "t": round(t - start, 3),
            "blendshapes": None,
            "rotation": None,
            "boundingBox": None,
            "leftIris": None,
            "rightIris": None,
            "leftEyeInnerCorner": None,
            "leftEyeOuterCorner": None,
            "rightEyeInnerCorner": None,
            "rightEyeOuterCorner": None,
            "sharpness": None,
            "brightness": None,
            "mouthContrastRatio": None,
            "faceDescriptor": None,
            "trackId": None,
            "mouthWidth": None,
        }

    tracker = FaceTracker()

    with vision.FaceLandmarker.create_from_options(options) as landmarker:
        t = start
        while t < end:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            if not ok:
                results.append(empty_sample(t))
                t += interval
                continue

            try:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
                result = landmarker.detect(mp_image)

                if not result.face_landmarks:
                    tracker.mark_missed()
                    results.append(empty_sample(t))
                    t += interval
                    continue

                # num_faces=1 above already asks MediaPipe for only the
                # most prominent face - no further "largest box" selection
                # needed the way detect_faces.py's FaceDetector needs (that
                # API always returns every detection).
                landmarks = result.face_landmarks[0]

                blendshapes = None
                if result.face_blendshapes:
                    categories = {c.category_name: c.score for c in result.face_blendshapes[0]}
                    blendshapes = {name: round(categories.get(name, 0.0), 4) for name in TRACKED_BLENDSHAPES}

                rotation = None
                if result.facial_transformation_matrixes:
                    m = result.facial_transformation_matrixes[0]
                    rotation_submatrix = [[m[r][c] for c in range(3)] for r in range(3)]
                    rotation = rotation_matrix_to_euler_degrees(rotation_submatrix)

                # Batch 3 - pixel-level measurements on the SAME frame
                # already read above, no extra decode/seek. Reuses the
                # already-converted frame_rgb (grayscale conversion needs
                # actual pixel data, not just landmark coordinates).
                sharpness = None
                brightness = None
                mouth_contrast_ratio = None
                frame_height, frame_width = frame.shape[:2]
                all_indices = range(len(landmarks))
                fx0, fy0, fx1, fy1 = pixel_bbox_from_landmark_indices(
                    landmarks, all_indices, frame_width, frame_height
                )
                face_crop = frame[fy0:fy1, fx0:fx1]
                if face_crop.size > 0:
                    gray_face = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
                    sharpness = laplacian_variance(gray_face)
                    brightness = float(gray_face.mean())

                    mx0, my0, mx1, my1 = pixel_bbox_from_landmark_indices(
                        landmarks,
                        [MOUTH_LEFT_CORNER, MOUTH_RIGHT_CORNER, MOUTH_UPPER_LIP, MOUTH_LOWER_LIP],
                        frame_width,
                        frame_height,
                    )
                    mouth_crop = frame[my0:my1, mx0:mx1]
                    if mouth_crop.size > 0 and sharpness > 0:
                        gray_mouth = cv2.cvtColor(mouth_crop, cv2.COLOR_BGR2GRAY)
                        mouth_contrast_ratio = laplacian_variance(gray_mouth) / sharpness

                # Batch 4 - geometric descriptor + tracking, using the SAME
                # bounding box/rotation already computed above.
                bounding_box = bounding_box_from_landmarks(landmarks)
                descriptor = face_descriptor(landmarks)
                track_id = tracker.update(bounding_box, descriptor, rotation)

                results.append(
                    {
                        "t": round(t - start, 3),
                        "blendshapes": blendshapes,
                        "rotation": rotation,
                        "boundingBox": bounding_box,
                        "leftIris": point_from_landmark(landmarks[LEFT_IRIS_CENTER]),
                        "rightIris": point_from_landmark(landmarks[RIGHT_IRIS_CENTER]),
                        "leftEyeInnerCorner": point_from_landmark(landmarks[LEFT_EYE_INNER_CORNER]),
                        "leftEyeOuterCorner": point_from_landmark(landmarks[LEFT_EYE_OUTER_CORNER]),
                        "rightEyeInnerCorner": point_from_landmark(landmarks[RIGHT_EYE_INNER_CORNER]),
                        "rightEyeOuterCorner": point_from_landmark(landmarks[RIGHT_EYE_OUTER_CORNER]),
                        "sharpness": sharpness,
                        "brightness": brightness,
                        "mouthContrastRatio": mouth_contrast_ratio,
                        "faceDescriptor": descriptor,
                        "trackId": track_id,
                        "mouthWidth": mouth_width_ratio(landmarks),
                    }
                )
            except Exception:
                tracker.mark_missed()
                results.append(empty_sample(t))

            t += interval

    cap.release()
    print(json.dumps(results))


if __name__ == "__main__":
    main()
