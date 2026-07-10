#!/usr/bin/env python3
"""
Object Intelligence roadmap, Batch OI-1 (Foundation). Samples frames from a
clip's time range in a source video and runs MediaPipe's Object Detector
Task (EfficientDet-Lite0, pretrained on the 80-class COCO taxonomy) on each
sample. Prints a JSON array to stdout:

  [{"t": <seconds from clip start>, "objects": [
      {"category": <str>, "boundingBox": {"xCenter": <float>, "yCenter": <float>,
       "width": <float>, "height": <float>}, "confidence": <float>}, ...
  ]}, ...]

An empty `objects` array is a real result ("nothing detected in this
sampled frame"), not a failure - same convention as detect_ocr_text.py's
empty textBlocks. Unlike detect_faces.py/detect_gestures.py (which report
at most one measurement per sample), a frame can have multiple simultaneous
objects, so this reports an ARRAY per sample - same shape as
detect_ocr_text.py's multiple text blocks per frame.

MediaPipe's ObjectDetector reports each detection's bounding_box in
ABSOLUTE PIXEL coordinates (origin_x/origin_y/width/height from the
top-left corner), unlike FaceDetector/GestureRecognizer's already-normalized
landmarks - this script divides by the frame's own width/height to convert
to the same normalized [0, 1] xCenter/yCenter/width/height convention every
other detector in this pipeline already uses (see
packages/contracts/src/face-landmarks.ts's boundingBox).

EfficientDet-Lite0 chosen over YOLOv8/Ultralytics explicitly for licensing
(Apache 2.0 vs. YOLOv8's AGPL-3.0, which would require open-sourcing this
entire codebase or an Enterprise license for commercial use) - see
CLAUDE.md's Object Intelligence roadmap section. Needs its own model file
(efficientdet_lite0.tflite, downloaded separately, see
apps/worker/README.md) - a different MediaPipe Task from every other
detector in this pipeline.

SCORE_THRESHOLD/MAX_RESULTS_PER_FRAME below are reasonable starting
guesses, NOT calibrated against real footage - same "kejujuran skala"
honesty as every other threshold in this pipeline.

PENDING REAL-MACHINE VERIFICATION: written in a sandbox with neither Python
nor a real video file available - has NOT been run against a real model/
video. See CLAUDE.md's "Known verification gap" section.

Usage: detect_objects.py <video_path> <start_seconds> <end_seconds> <interval_seconds> <model_path>
"""
import json
import sys

import cv2
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions

# A detection below this confidence is dropped entirely, not just reported
# with a low score - MediaPipe's own detector-level filter.
SCORE_THRESHOLD = 0.5
# Caps how many objects are reported per sampled frame (MediaPipe's own
# top-K limit) - bounds the output size for a busy frame, same "reasonable
# guess" honesty as SCORE_THRESHOLD.
MAX_RESULTS_PER_FRAME = 10


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

    options = vision.ObjectDetectorOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        score_threshold=SCORE_THRESHOLD,
        max_results=MAX_RESULTS_PER_FRAME,
    )

    with vision.ObjectDetector.create_from_options(options) as detector:
        t = start
        while t < end:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            clip_relative_t = round(t - start, 3)
            if not ok:
                results.append({"t": clip_relative_t, "objects": []})
                t += interval
                continue

            frame_height, frame_width = frame.shape[:2]
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
            detection_result = detector.detect(mp_image)

            objects = []
            for detection in detection_result.detections:
                if not detection.categories:
                    continue
                top = detection.categories[0]
                box = detection.bounding_box
                objects.append(
                    {
                        "category": top.category_name,
                        "boundingBox": {
                            "xCenter": round((box.origin_x + box.width / 2) / frame_width, 4),
                            "yCenter": round((box.origin_y + box.height / 2) / frame_height, 4),
                            "width": round(box.width / frame_width, 4),
                            "height": round(box.height / frame_height, 4),
                        },
                        "confidence": round(top.score, 3),
                    }
                )

            results.append({"t": clip_relative_t, "objects": objects})
            t += interval

    cap.release()
    print(json.dumps(results))


if __name__ == "__main__":
    main()
