#!/usr/bin/env python3
"""
Samples frames from a clip's time range in a source video and runs
MediaPipe's Gesture Recognizer Task on each sample. Prints a JSON array to
stdout:

  [{"t": <seconds from clip start>, "gesture": <label> | null, "confidence": <float> | null}, ...]

gesture/confidence are both null when NO hand was detected in that sampled
frame at all - not the same as the "none" label, which means a hand WAS
detected but didn't match any of the 7 recognized built-in gestures
(Closed_Fist, Open_Palm, Pointing_Up, Thumb_Down, Thumb_Up, Victory,
ILoveYou - lower-cased with underscores here to match
packages/contracts/src/gesture-intelligence.ts's GESTURES taxonomy exactly).

When more than one hand is detected in a frame, picks the one with the
highest gesture confidence score - the "most confident gesture" heuristic,
same "pick the most prominent/confident signal" philosophy as
detect_faces.py's largest-bounding-box heuristic (Fase 2).

Uses MediaPipe's Tasks API (mediapipe.tasks.python.vision.GestureRecognizer)
- needs its own .task model file (gesture_recognizer.task), downloaded
separately (see apps/worker/README.md) - NOT the same model file face
detection/facial emotion reuse, this is a different MediaPipe Task entirely.

PENDING REAL-MACHINE VERIFICATION: written in a sandbox with neither Python
nor a real video file available - has NOT been run against a real model/
video. See CLAUDE.md's Fase 30 section.

Usage: detect_gestures.py <video_path> <start_seconds> <end_seconds> <interval_seconds> <model_path>
"""
import json
import sys

import cv2
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions

# MediaPipe's own label spelling -> this project's lower_snake_case
# taxonomy (packages/contracts/src/gesture-intelligence.ts's GESTURES).
LABEL_MAP = {
    "None": "none",
    "Closed_Fist": "closed_fist",
    "Open_Palm": "open_palm",
    "Pointing_Up": "pointing_up",
    "Thumb_Down": "thumb_down",
    "Thumb_Up": "thumb_up",
    "Victory": "victory",
    "ILoveYou": "i_love_you",
}


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

    options = vision.GestureRecognizerOptions(
        base_options=BaseOptions(model_asset_path=model_path),
    )

    with vision.GestureRecognizer.create_from_options(options) as recognizer:
        t = start
        while t < end:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            clip_relative_t = round(t - start, 3)
            if not ok:
                results.append({"t": clip_relative_t, "gesture": None, "confidence": None})
                t += interval
                continue

            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
            recognition_result = recognizer.recognize(mp_image)

            gesture = None
            confidence = None
            if recognition_result.gestures:
                best_hand = max(
                    recognition_result.gestures,
                    key=lambda categories: categories[0].score if categories else 0.0,
                )
                if best_hand:
                    top = best_hand[0]
                    gesture = LABEL_MAP.get(top.category_name, top.category_name.lower())
                    confidence = round(top.score, 3)

            results.append({"t": clip_relative_t, "gesture": gesture, "confidence": confidence})
            t += interval

    cap.release()
    print(json.dumps(results))


if __name__ == "__main__":
    main()
