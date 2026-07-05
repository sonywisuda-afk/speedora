#!/usr/bin/env python3
"""
Runs a vocal (audio-based) speech emotion classifier over a list of time
segments within one audio file, and prints a JSON array to stdout, aligned
by index to the input segments:

  [{"emotion": "hap", "score": 0.83}, null, ...]

null for a segment shorter than MIN_SEGMENT_SECONDS - too little audio for a
meaningful classification, not an error.

Uses superb/wav2vec2-base-superb-er (IEMOCAP's 4-class taxonomy: neu/hap/
ang/sad) via transformers' "audio-classification" pipeline - a small
(~360MB), publicly downloadable model, NOT gated on Hugging Face (unlike
diarize_speakers.py's model - no HUGGINGFACE_TOKEN needed here at all).

Honesty note (see CLAUDE.md's "Vocal Emotion Detection" section): this is a
narrow 4-class heuristic trained on IEMOCAP, a scripted/acted-emotion
dataset recorded by actors - real spontaneous conversational speech (the
overwhelming majority of what this app processes) is a meaningfully
different distribution than what the model was trained on. Treat this as a
noisy supplementary signal, not a reliable prediction - same spirit as
Fase 2's face detection and Fase 12's diarization: useful when right,
silently skippable when wrong, never load-bearing on its own.

Audio is decoded via soundfile (not handed to the pipeline as a bare file
path) - the same torchcodec-avoidance workaround discovered while building
diarize_speakers.py (Fase 12): torchcodec's native DLLs fail to load on
this Windows setup, and transformers' own audio pipeline would otherwise
try the same broken path when given a file path directly.

Usage: detect_vocal_emotion.py <audio_path> <segments_json_path>
segments_json_path: a JSON file containing [{"start": <seconds>, "end": <seconds>}, ...],
in the same timeline as audio_path itself (absolute seconds from the start
of that file).
"""
import json
import sys

import soundfile as sf
from transformers import pipeline

MODEL_NAME = "superb/wav2vec2-base-superb-er"
# Below this, there's too little audio for the model to produce a
# meaningful vector - matches this model's own expected minimum input
# length in practice (a fraction-of-a-second clip is mostly padding/noise).
MIN_SEGMENT_SECONDS = 0.5


def main() -> None:
    audio_path = sys.argv[1]
    segments_path = sys.argv[2]

    with open(segments_path, "r", encoding="utf-8") as f:
        segments = json.load(f)

    samples, sample_rate = sf.read(audio_path, dtype="float32", always_2d=True)
    # Average to mono - this model (like the rest of this pipeline) expects
    # single-channel audio; the source is already mono in practice (see
    # ffmpeg.ts's extractAudio), so this is a no-op in the common case.
    mono = samples.mean(axis=1)

    classifier = pipeline("audio-classification", model=MODEL_NAME)

    results = []
    for segment in segments:
        start_sample = max(0, round(segment["start"] * sample_rate))
        end_sample = min(len(mono), round(segment["end"] * sample_rate))
        duration = (end_sample - start_sample) / sample_rate

        if duration < MIN_SEGMENT_SECONDS:
            results.append(None)
            continue

        clip = mono[start_sample:end_sample]
        predictions = classifier(clip, sampling_rate=sample_rate)
        top = max(predictions, key=lambda p: p["score"])
        results.append({"emotion": top["label"], "score": round(top["score"], 3)})

    print(json.dumps(results))


if __name__ == "__main__":
    main()
