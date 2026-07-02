#!/usr/bin/env python3
"""
Samples frames from a clip's time range in a source video and runs
MediaPipe face detection on each sample. Prints a JSON array to stdout:

  [{"t": <seconds from clip start>, "box": {"xCenter", "yCenter", "width", "height"} | null}, ...]

Box coordinates are normalized (0-1) relative to frame width/height, not
pixels - apps/worker/src/faceDetection.ts converts to the source video's
actual pixel dimensions before building the ffmpeg crop filter.

When a frame has more than one face, picks the largest by bounding-box area
(the "most prominent face" heuristic - see CLAUDE.md's Fase 2 decision;
true active-speaker detection via mouth movement + audio correlation is
deliberately out of scope for this phase).

Uses MediaPipe's Tasks API (mediapipe.tasks.python.vision.FaceDetector) -
the older mp.solutions.face_detection API has been removed from recent
mediapipe releases. The Tasks API needs a .tflite model file downloaded
separately (see apps/worker/Dockerfile) - it isn't bundled in the pip
package.

Usage: detect_faces.py <video_path> <start_seconds> <end_seconds> <interval_seconds> <model_path>
"""
import json
import sys

import cv2
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions


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

    options = vision.FaceDetectorOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        min_detection_confidence=0.5,
    )

    with vision.FaceDetector.create_from_options(options) as detector:
        t = start
        while t < end:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            if not ok:
                results.append({"t": round(t - start, 3), "box": None})
                t += interval
                continue

            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
            detection_result = detector.detect(mp_image)

            box = None
            if detection_result.detections:
                largest = max(
                    detection_result.detections,
                    key=lambda d: d.bounding_box.width * d.bounding_box.height,
                )
                bbox = largest.bounding_box
                frame_height, frame_width = frame.shape[:2]
                box = {
                    "xCenter": (bbox.origin_x + bbox.width / 2) / frame_width,
                    "yCenter": (bbox.origin_y + bbox.height / 2) / frame_height,
                    "width": bbox.width / frame_width,
                    "height": bbox.height / frame_height,
                }

            results.append({"t": round(t - start, 3), "box": box})
            t += interval

    cap.release()
    print(json.dumps(results))


if __name__ == "__main__":
    main()
