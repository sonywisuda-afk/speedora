#!/usr/bin/env python3
"""
Batch SC-3 (Scene Intelligence taxonomy expansion, continuing SC-1/SC-2) -
samples frames from a clip's time range (~1/sec, same cadence as
detect_facial_emotion.py/detect_gestures.py/detect_face_landmarks.py) and
estimates the GLOBAL camera transform (translation/scale/rotation) between
each consecutive pair via OpenCV's ECC (Enhanced Correlation Coefficient)
image alignment (cv2.findTransformECC, MOTION_AFFINE). Prints a JSON array
to stdout:

  [{"t": <seconds from clip start>, "dx": <float>|null, "dy": <float>|null,
    "scale": <float>|null, "rotation": <float>|null, "ecc": <float>|null}, ...]

This script computes ONLY the raw per-sample transform - classifying it
into pan/tilt/zoom/shake scores is @speedora/scene-intelligence's
deriveCameraMotionFeatures()'s job (pure TypeScript), per explicit user
design direction (same "raw vs. features" split as every other module in
this pipeline).

Chosen over ffmpeg's vidstabdetect (libvidstab) after an explicit user
decision between the two: libvidstab is an OPTIONAL ffmpeg component whose
availability in this project's ffmpeg build was never verified, and its
transform output goes to a file (not stderr), which would break the
"parse stderr" pattern every other scene-intelligence detector uses.
OpenCV's ECC needs no new Python dependency (cv2/numpy already installed
since Batch 1 Face Landmarker) and is a standard, well-documented API for
exactly this: aligning two images and returning the transform between them.

The first sample (t=0, no previous frame) and any sample where ECC failed
to converge (cv2.error, e.g. insufficient texture/contrast to align on) get
null for every transform field - "null means no signal, not zero", same
convention as detect_facial_emotion.py.

PENDING REAL-MACHINE VERIFICATION: written in a sandbox with neither Python
nor a real video file available - cv2.findTransformECC's convergence
behavior and the warp-matrix decomposition below have NOT been run against
real footage. In particular, whether MOTION_AFFINE's default iteration
count/epsilon (see ECC_CRITERIA below) converges reliably on typical
talking-head/handheld footage (vs. needing more iterations, or falling back
to MOTION_TRANSLATION/MOTION_EUCLIDEAN for speed) is unconfirmed.

Usage: detect_camera_motion.py <video_path> <start_seconds> <end_seconds> <interval_seconds>
"""
import json
import math
import sys

import cv2
import numpy as np

# Downscaled working width for ECC alignment - motion direction/scale/
# rotation don't need full source resolution, and ECC is expensive relative
# to this pipeline's other per-frame subprocess work (MediaPipe inference,
# simple pixel-stat filters), so a smaller working frame keeps per-clip
# processing time bounded. A reasonable guess, not benchmarked against real
# footage.
WORKING_WIDTH = 320

# cv2.findTransformECC's stopping criteria - conventional defaults used in
# most ECC alignment examples/documentation, not tuned by this project.
ECC_MAX_ITERATIONS = 50
ECC_EPSILON = 1e-4


def to_working_gray(frame: np.ndarray) -> np.ndarray:
    height, width = frame.shape[:2]
    scale = WORKING_WIDTH / width
    working_height = max(1, int(height * scale))
    resized = cv2.resize(frame, (WORKING_WIDTH, working_height))
    return cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)


def decompose_warp(warp: np.ndarray, frame_width: int, frame_height: int):
    a, b, tx = warp[0]
    c, d, ty = warp[1]
    scale_x = math.hypot(a, c)
    scale_y = math.hypot(b, d)
    scale = (scale_x + scale_y) / 2
    rotation = math.degrees(math.atan2(c, a))
    # Normalized to a FRACTION of (working) frame width/height, not raw
    # pixels - comparable across source resolutions regardless of
    # WORKING_WIDTH, same reasoning as FaceLandmarkFeatures' scale-invariant
    # ratios (packages/facial-intelligence).
    dx = tx / frame_width
    dy = ty / frame_height
    # warp's entries (a, b, tx, c, d, ty) are numpy.float32 (cv2.findTransformECC's own dtype),
    # so dx/dy - plain division, never passed through a math.* function - stay numpy.float32
    # too. json.dumps() can't serialize that (a real bug this project hit on a real, longer
    # clip - see docs/ai/phase-d-benchmark.md's own finding). scale/rotation already come out
    # native via math.hypot()/math.degrees(), but cast explicitly here too rather than relying
    # on that implicitly - one place, no doubt left for a future numpy/OpenCV version to break.
    return float(dx), float(dy), float(scale), float(rotation)


def main() -> None:
    video_path = sys.argv[1]
    start = float(sys.argv[2])
    end = float(sys.argv[3])
    interval = float(sys.argv[4])

    results = []
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps(results))
        return

    criteria = (
        cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT,
        ECC_MAX_ITERATIONS,
        ECC_EPSILON,
    )

    prev_gray = None
    t = start
    while t < end:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        clip_relative_t = round(t - start, 3)

        if not ok:
            results.append(
                {"t": clip_relative_t, "dx": None, "dy": None, "scale": None, "rotation": None, "ecc": None}
            )
            prev_gray = None
            t += interval
            continue

        gray = to_working_gray(frame)

        if prev_gray is None:
            # First sample, or the previous frame failed to read - no
            # transform to compute yet.
            results.append(
                {"t": clip_relative_t, "dx": None, "dy": None, "scale": None, "rotation": None, "ecc": None}
            )
        else:
            try:
                warp = np.eye(2, 3, dtype=np.float32)
                cc, warp = cv2.findTransformECC(prev_gray, gray, warp, cv2.MOTION_AFFINE, criteria)
                dx, dy, scale, rotation = decompose_warp(warp, gray.shape[1], gray.shape[0])
                results.append(
                    {
                        "t": clip_relative_t,
                        "dx": dx,
                        "dy": dy,
                        "scale": scale,
                        "rotation": rotation,
                        "ecc": float(cc),
                    }
                )
            except cv2.error:
                # ECC failed to converge (e.g. insufficient texture/contrast
                # to align on) - isolate this one sample, don't fail the
                # whole clip's analysis over it.
                results.append(
                    {"t": clip_relative_t, "dx": None, "dy": None, "scale": None, "rotation": None, "ecc": None}
                )

        prev_gray = gray
        t += interval

    cap.release()
    print(json.dumps(results))


if __name__ == "__main__":
    main()
