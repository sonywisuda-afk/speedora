#!/usr/bin/env python3
"""
Runs pyannote.audio's speaker diarization pipeline on a full audio track and
prints a JSON array of speaker turns to stdout:

  [{"start": <seconds>, "end": <seconds>, "speaker": "SPEAKER_00"}, ...]

Times are seconds from the start of the given audio file - the caller
(apps/worker/src/diarization.ts) is responsible for mapping these onto
whatever timeline the audio file itself represents (currently: the whole
video, extracted once via ffmpeg.ts's extractAudio() - see
transcribe.worker.ts). Speaker labels are pyannote's own raw IDs
("SPEAKER_00", "SPEAKER_01", ...), numbered in order of first appearance
within this one file - not stable/comparable across different videos.

pyannote/speaker-diarization-community-1 is a gated model on Hugging Face:
the account behind HUGGINGFACE_TOKEN must have accepted its terms at
https://huggingface.co/pyannote/speaker-diarization-community-1 before this
will work - otherwise Pipeline.from_pretrained raises a 403 (GatedRepoError).

Uses "community-1", NOT the older/more commonly documented
"speaker-diarization-3.1" checkpoint - discovered via a real failing run,
not from pyannote's own docs: pyannote.audio 4.x (the version pip resolves
for this project's Python 3.14) hardcodes its SpeakerDiarization pipeline
class defaults (clustering + PLDA scorer) to reference
speaker-diarization-community-1 regardless of which checkpoint you load,
and the older 3.1 checkpoint's own config.yaml never overrides that
(it predates this refactor). Loading "-3.1" on this library version means
mixing 3.1's segmentation/embedding with community-1's PLDA/clustering
defaults anyway - loading community-1 directly avoids that mismatch AND
only requires accepting ONE gated repo's terms instead of two
(community-1 bundles its own segmentation+embedding+plda, one gated repo,
rather than -3.1 + the separate pyannote/segmentation-3.0 dependency).

Audio is decoded via soundfile, NOT handed to pyannote as a bare file path -
discovered via a real failing run: pyannote's own file-path loading goes
through torchaudio/torchcodec, and torchcodec's native DLLs
(libtorchcodec_core{4..8}.dll) fail to load on this Windows Python 3.14
setup (no matching system FFmpeg shared libraries - a static ffmpeg.exe
binary on PATH, which the rest of this project already depends on, isn't
what torchcodec looks for). soundfile bundles its own decoder (libsndfile)
with no such system-library dependency, and pyannote's own Pipeline.__call__
accepts a pre-decoded {"waveform": tensor, "sample_rate": int} dict as an
explicit alternative to a file path for exactly this kind of situation.

Usage: diarize_speakers.py <audio_path>
Requires HUGGINGFACE_TOKEN in the environment.

Speaker Intelligence Phase 0 (Production Diarization Foundation) - every
failure path now prints one structured JSON object to stderr before exiting
non-zero, instead of letting a bare Python traceback (or a generic
RuntimeError message) reach the caller as unstructured text:

  {"error": true, "category": "<category>", "message": "<detail>"}

apps/worker/src/diarization.ts parses this into a DiarizationError with a
typed `.category`, which the caller (transcribe.worker.ts) records via
recordDiarizationOutcome() before falling back to "no speaker labels" - the
fallback behavior is UNCHANGED (this remains an optional signal, never a
job failure), but the failure is no longer silent at the ops/metrics level.
category is one of:
  - "dependency_missing" - torch/pyannote.audio/soundfile isn't installed in
    this Python environment at all (the exact bug this phase fixes in
    apps/worker/Dockerfile - if this category is EVER seen in production
    after this phase ships, the image build is broken again).
  - "missing_token"       - HUGGINGFACE_TOKEN isn't set. Expected/benign in
    a deployment that hasn't configured diarization yet.
  - "model_access_denied" - the gated model's terms haven't been accepted by
    the account behind HUGGINGFACE_TOKEN (a 403/GatedRepoError).
  - "network"             - couldn't reach Hugging Face to fetch the model.
  - "internal"             - anything else (corrupt audio, unexpected
    pyannote/torch exception, ...).
"""
import json
import os
import sys


def _emit_error(category: str, message: str) -> None:
    print(json.dumps({"error": True, "category": category, "message": message}), file=sys.stderr)


try:
    import soundfile as sf
    import torch
    from pyannote.audio import Pipeline
except ImportError as exc:
    _emit_error("dependency_missing", str(exc))
    sys.exit(1)


def _classify_load_error(exc: BaseException) -> str:
    # Imported lazily, inside the function that needs it - huggingface_hub
    # is a transitive dependency of pyannote.audio, always present once the
    # top-level imports above have already succeeded.
    from huggingface_hub.utils import GatedRepoError, HfHubHTTPError

    if isinstance(exc, GatedRepoError):
        return "model_access_denied"
    if isinstance(exc, HfHubHTTPError):
        return "network"
    return "internal"


def main() -> None:
    audio_path = sys.argv[1]
    token = os.environ.get("HUGGINGFACE_TOKEN")
    if not token:
        _emit_error("missing_token", "HUGGINGFACE_TOKEN is not set")
        sys.exit(1)

    try:
        # pyannote.audio 4.x renamed from_pretrained's auth kwarg from
        # use_auth_token (3.x) to token, matching huggingface_hub's own
        # current convention - discovered via a real run against
        # pyannote.audio 4.0.7 (the version pip resolves for this project as
        # of writing), not from docs (pyannote's own README/model card still
        # show the old 3.x kwarg).
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-community-1", token=token
        )

        # always_2d keeps mono and multi-channel audio on the same code path
        # - shape (time, channels) - transposed below to the
        # (channels, time) pyannote/torch convention.
        samples, sample_rate = sf.read(audio_path, dtype="float32", always_2d=True)
        waveform = torch.from_numpy(samples.T)

        # pyannote.audio 4.x wraps the result in a DiarizeOutput object
        # (instead of returning the classic pyannote.core.Annotation
        # directly) - .speaker_diarization is that same Annotation, with
        # itertracks() intact.
        output = pipeline({"waveform": waveform, "sample_rate": sample_rate})
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see _classify_load_error
        _emit_error(_classify_load_error(exc), str(exc))
        sys.exit(1)

    turns = [
        {"start": round(turn.start, 3), "end": round(turn.end, 3), "speaker": speaker}
        for turn, _, speaker in output.speaker_diarization.itertracks(yield_label=True)
    ]
    print(json.dumps(turns))


if __name__ == "__main__":
    main()
