#!/usr/bin/env python3
"""
Samples frames from a clip's time range in a source video, detects the most
prominent face per frame (same "largest bounding box" heuristic as
detect_faces.py, Fase 2), crops it, and classifies its facial expression.
Prints a JSON array to stdout:

  [{"t": <seconds from clip start>, "emotion": <label> | null, "score": <float> | null}, ...]

A null emotion/score means "no face in this sampled frame" or
"classification failed for this one frame" - never crashes the whole
process over a single bad sample, same "isolate failure per sample"
philosophy as detect_vocal_emotion.py (Fase 13).

Face detection reuses MediaPipe's Tasks API FaceDetector - the same model
file and API already required by detect_faces.py (Fase 2) - rather than
introducing a second face-detection method (e.g. Haar cascades) just for
this script.

Classification uses transformers' "image-classification" pipeline with
"trpakov/vit-face-expression" (public HF model, NOT gated - no HUGGINGFACE_TOKEN
needed, same reasoning as Fase 13's superb/wav2vec2-base-superb-er choice),
a ViT fine-tuned on the standard FER+ 7-class taxonomy (angry, disgust,
fear, happy, neutral, sad, surprise) - see FACIAL_EMOTIONS in
packages/contracts/src/facial-intelligence.ts, which this script's output
labels must match exactly (lower-case).

PENDING REAL-MACHINE VERIFICATION: written in a sandbox with neither Python
nor a real video file available - the MediaPipe crop + transformers pipeline
call chain here has NOT been run against a real model/video. Specifically
unverified before trusting this in production: (1) that
"trpakov/vit-face-expression"'s output labels are exactly the lower-case
FACIAL_EMOTIONS set (transformers pipelines commonly return
capitalized/differently-cased labels - see the .lower() normalization below,
added defensively but not confirmed against the model's real output), and
(2) that a face cropped this tightly (MediaPipe's detection box, no margin)
is what this model expects as input (some face-classification models are
trained on looser crops with padding).

Usage: detect_facial_emotion.py <video_path> <start_seconds> <end_seconds> <interval_seconds> <model_path>

model_path is the SAME MediaPipe .tflite file detect_faces.py already
requires (see apps/worker/README.md for download instructions) - this
script doesn't download or need a second model file, just reuses face
detection's own model to crop to the most prominent face before
classifying it. Passed as a CLI arg (not read from an env var inside this
script) for the same reason detect_faces.py does it that way: all
deployment-specific configuration flows through the TypeScript deps object
(facialIntelligenceDeps.ts) and CLI args, not scattered process.env reads
across scripts.
"""
import json
import sys

import cv2
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions
from PIL import Image
from transformers import pipeline

FACIAL_EMOTION_MODEL = "trpakov/vit-face-expression"


def most_prominent_face_box(detector, frame):
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
    detection_result = detector.detect(mp_image)
    if not detection_result.detections:
        return None
    largest = max(
        detection_result.detections,
        key=lambda d: d.bounding_box.width * d.bounding_box.height,
    )
    bbox = largest.bounding_box
    return bbox.origin_x, bbox.origin_y, bbox.width, bbox.height


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
    classifier = pipeline("image-classification", model=FACIAL_EMOTION_MODEL)

    with vision.FaceDetector.create_from_options(options) as detector:
        t = start
        while t < end:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            clip_relative_t = round(t - start, 3)
            if not ok:
                results.append({"t": clip_relative_t, "emotion": None, "score": None})
                t += interval
                continue

            box = most_prominent_face_box(detector, frame)
            if box is None:
                results.append({"t": clip_relative_t, "emotion": None, "score": None})
                t += interval
                continue

            x, y, w, h = box
            frame_height, frame_width = frame.shape[:2]
            x0, y0 = max(0, int(x)), max(0, int(y))
            x1, y1 = min(frame_width, int(x + w)), min(frame_height, int(y + h))
            face_crop = frame[y0:y1, x0:x1]

            if face_crop.size == 0:
                results.append({"t": clip_relative_t, "emotion": None, "score": None})
                t += interval
                continue

            try:
                rgb_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2RGB)
                image = Image.fromarray(rgb_crop)
                predictions = classifier(image)
                top = max(predictions, key=lambda p: p["score"])
                results.append(
                    {
                        "t": clip_relative_t,
                        "emotion": top["label"].lower(),
                        "score": round(top["score"], 3),
                    }
                )
            except Exception:
                results.append({"t": clip_relative_t, "emotion": None, "score": None})

            t += interval

    cap.release()
    print(json.dumps(results))


if __name__ == "__main__":
    main()
