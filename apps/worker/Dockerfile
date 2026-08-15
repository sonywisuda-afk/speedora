# Build from the repo root: docker build -f apps/worker/Dockerfile .
# This is a pnpm workspace - packages/shared, packages/database, and
# packages/storage are real source dependencies of apps/worker, not
# published packages, so the build context has to be the whole monorepo.

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Pre-existing bug found and fixed during VideoImportEngine verification: this
# used to hand-list only 3 of apps/worker's ~30 workspace package
# dependencies (shared/database/storage), which happened to be enough back
# when the Dockerfile was written but silently went stale as more packages
# were added (e.g. @speedora/social, @speedora/audio-intelligence,
# @speedora/speaker-diarization, @speedora/subtitle-translate -
# pre-existing, unrelated to video-import) - a real `docker build --no-cache`
# failed with "Cannot find module '@speedora/social'" etc. Building every
# package first, same "./packages/**" pattern the root package.json's own
# `pnpm build` script already uses successfully, is correct regardless of
# how apps/worker's dependency list changes in the future.
RUN pnpm --filter "./packages/**" build \
    && pnpm --filter @speedora/worker build
# Bundles apps/worker's dist output with only its production dependencies
# (workspace deps included as real copies, not symlinks) into a
# self-contained directory - see https://pnpm.io/cli/deploy. --ignore-scripts
# because this reruns packages/database's postinstall (`prisma generate`),
# and the prod-only install here has already stripped out the `prisma` CLI
# (a devDependency) - the generated client from the build step above is
# already sitting in packages/database/dist and gets copied over as-is.
RUN pnpm --filter @speedora/worker deploy --prod --ignore-scripts /out

FROM node:22-slim AS runtime
ENV NODE_ENV=production
# node:20-slim (Debian/glibc), not node:20-alpine, specifically for this
# image - MediaPipe's PyPI wheels have no musl (Alpine) build at all, only
# glibc. render-clip shells out to both ffmpeg (apps/worker/src/ffmpeg.ts)
# and a Python/MediaPipe subprocess (apps/worker/src/faceDetection.ts,
# apps/worker/scripts/detect_faces.py) for smart-reframe face tracking -
# see CLAUDE.md's Fase 2 decision.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    # Pre-existing gap found and fixed during VideoImportEngine verification
    # (unrelated to video-import): webrtcvad (Speaker Intelligence's Voice
    # Activity Detection dependency, installed via pip below) ships no
    # prebuilt Linux wheel and compiles a small C extension at install time -
    # a real `docker build --no-cache` failed first with "gcc: No such file
    # or directory" (fixed by build-essential), then with "Python.h: No such
    # file or directory" once gcc actually ran (fixed by python3-dev,
    # gcc needs Python's headers to compile a CPython extension, a separate
    # apt package from the python3/python3-pip runtime already listed here).
    # Confirms this Dockerfile's own longstanding comment further down
    # (soundfile/pyannote.audio/transformers/torch were already flagged as
    # never verified here) - this image's Python dependency chain hadn't
    # been exercised end-to-end in a while.
    build-essential \
    python3-dev \
    # Brand Kit roadmap (P3a) - libass (ffmpeg's `subtitles` filter) resolves
    # caption fonts through the system's fontconfig index. Without this
    # package (and the font files installed below), build-ass.ts's Fontname
    # falls back to whatever fontconfig-less default libass picks, which is
    # NOT guaranteed to be any particular font - see build-ass.ts's own
    # comment on this previously-unverified gap.
    fontconfig \
    # Provides pgrep, used by this image's own HEALTHCHECK below - this
    # image has no HTTP server to probe (see that HEALTHCHECK's comment),
    # so liveness is "is the process still running" instead.
    procps \
    # opencv-python-headless still dynamically links these even in headless
    # mode - without them it fails at import time with a missing .so error,
    # not at install time, so this list was found by trial and error against
    # a real container rather than copied from a single canonical source.
    libxcb1 \
    libxext6 \
    libsm6 \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libxrender1 \
    libegl1 \
    libgles2 \
    # AI Fusion roadmap's OCR initiative, Batch OCR-1 - the actual OCR
    # binary + English trained data (pytesseract below is just a thin
    # subprocess wrapper around this, not a bundled/vendored copy of it).
    tesseract-ocr \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*
# --break-system-packages: Debian 12's system Python enforces PEP 668
# (no unmanaged global pip installs) - fine to override in a single-purpose
# container that only ever runs this one script.
# yt-dlp alongside mediapipe/opencv here (not a separate RUN layer) - same
# pip, same --break-system-packages override, no reason to split it out.
# import-youtube.worker.ts (Fase 7) shells out to the yt-dlp binary this
# installs, then hands the downloaded file to this image's existing ffmpeg
# install (--merge-output-format mp4) exactly like render-clip already does
# for its own ffmpeg calls.
# scipy - AI Fusion roadmap's Face Intelligence initiative, Batch 4 (Face
# Re-identification/Tracking) - detect_face_landmarks.py's single-object
# tracker uses scipy.optimize.linear_sum_assignment (Hungarian algorithm)
# to solve the detection-to-track assignment cost matrix each frame. A
# plain numerical library (not a heavy ML framework like dlib/TensorFlow -
# deliberately avoided per explicit user direction, see CLAUDE.md's Fase 36
# section), so it's added alongside mediapipe/opencv here rather than a
# separate RUN layer.
# pytesseract - AI Fusion roadmap's OCR initiative, Batch OCR-1
# (detect_ocr_text.py) - a thin subprocess wrapper around the tesseract-ocr
# binary installed above, not an OCR engine itself.
# webrtcvad - Speaker Intelligence roadmap, Milestone A (Voice Activity
# Detection, detect_voice_activity.py) - a small classic DSP/GMM-based
# library (NOT a neural model), explicit user choice over Silero VAD
# specifically to avoid adding torch as a dependency for this one detector.
RUN pip install --no-cache-dir --break-system-packages mediapipe opencv-python-headless yt-dlp scipy pytesseract webrtcvad
# Speaker Intelligence Phase 0 (Production Diarization Foundation) - closes
# the gap the comment above used to document here: soundfile/pyannote.audio/
# transformers/torch were NOT previously in this image's pip install at all,
# so diarize_speakers.py (Speaker Diarization), detect_vocal_emotion.py, and
# detect_facial_emotion.py (both use transformers.pipeline, which needs a
# torch/tensorflow backend) silently no-opped in every production deploy -
# each shells out, fails on import, and the caller's existing "diarization/
# emotion unavailable, continue without it" fallback (see diarization.ts,
# transcribe.worker.ts) swallowed it as if the signal just wasn't computed,
# not as a broken environment.
#
# torch is installed from PyTorch's own CPU-only wheel index, in its own
# layer, BEFORE pyannote.audio/transformers/soundfile - this image has no
# CUDA runtime (node:22-slim, no nvidia base image, no GPU in this
# deployment), and pip's default index resolves a much larger CUDA-enabled
# torch build unless told otherwise.
#
# PINNED to an exact version (torch==2.9.1+cpu, not a bare "torch") - found
# necessary the hard way verifying this exact change: an UNPINNED first
# install resolved to torch-2.5.1+cpu (pip's own resolver quirk, not
# investigated further), which is too old for pyannote.audio's own
# transitive dependency `torch-audiomentations>=0.12.0` (needs torch>=2.8.0).
# The second pip install below then "helpfully" upgraded torch to satisfy
# that floor - from PyPI's DEFAULT index, since it has no CPU-index
# awareness of its own - silently downloading a 526MB CUDA-enabled wheel
# and defeating the entire point of this two-step CPU-only install. Pinning
# an EXACT version here that already clears every known floor in this
# dependency tree means pip treats "torch" as already satisfied by the
# second install and never re-resolves it - confirmed against the real
# pyannote.audio release on PyPI, not assumed.
#
# --extra-index-url (ADDS the CPU index alongside PyPI's default), NOT
# --index-url (which would REPLACE PyPI entirely) - found necessary the
# hard way: PyTorch's own wheel index has inconsistent package metadata for
# some of torch's own transitive deps (e.g. typing-extensions's wheel
# filename normalizes the name with an underscore while its embedded
# METADATA Name field uses a hyphen), which pip's strict consistency check
# rejects outright with "No matching distribution found" when that index is
# the ONLY one available. Keeping PyPI's default index in play lets pip
# fall back to it for everything except torch itself (torch is pinned
# below to an exact "+cpu"-suffixed version, so PyPI's own, larger
# CUDA-bundled "torch" package is never a candidate).
#
# torchaudio is ALSO pinned here, alongside torch - found necessary the hard
# way: pyannote.audio only declares `torchaudio>=2.8.0` with no upper bound,
# so leaving it unpinned let the second pip install below resolve whatever
# is newest (torchaudio 2.11.0 at the time this was verified) regardless of
# which torch version is actually installed. torch/torchaudio wheels are
# NOT cross-version compatible - torchaudio's compiled extension
# (_torchaudio.abi3.so) links against a specific torch ABI, and a
# newer-than-torch torchaudio fails at IMPORT time with "OSError: Could not
# load this library", not at pip-install time - confirmed via a real failing
# build, not assumed. Pinning both to the SAME PyTorch release line (2.9.1)
# keeps them ABI-compatible.
#
# --timeout=100 (pip's default socket timeout is 15s) on both installs below
# - found necessary the hard way verifying this exact change: pip's default
# is too aggressive against a slow/rate-limited registry connection and
# aborts an in-progress multi-hundred-MB wheel download with a
# ReadTimeoutError that looks like a real failure but is purely a transient
# network condition. A generous timeout here is the same "bound the worst
# case, don't cut off a slow-but-working transfer" reasoning as
# diarization.ts's own DIARIZATION_TIMEOUT_MS.
#
# Deliberately NOT --no-cache-dir here (unlike every other pip install in
# this file) - found the hard way that pip's own dependency-resolution pass
# downloads each wheel once just to read its metadata, then the actual
# install pass downloads the SAME wheel a second time when there's no local
# cache to serve it from - doubling network transfer for torch's own 184MB
# wheel specifically. `pip cache purge` in the same RUN layer (so the cache
# never lands in a committed image layer) gets the caching benefit within
# this one command's lifetime without leaving anything behind - same final
# image size as `--no-cache-dir`, half the download traffic.
RUN pip install --break-system-packages --timeout=100 torch==2.9.1+cpu torchaudio==2.9.1+cpu \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    && pip cache purge
RUN pip install --break-system-packages --timeout=100 pyannote.audio transformers soundfile \
    && pip cache purge
# MediaPipe's Tasks API (mediapipe.tasks.python.vision.FaceDetector) needs
# this model file locally - it isn't bundled in the pip package, and isn't
# committed to the repo either (see .gitignore) since it's a binary asset
# better fetched from its canonical source than tracked in git. Short-range
# model: tuned for faces within ~2m of the camera (talking-head content,
# same as what detect-clips already targets) and faster than the full-range
# model. Local dev needs the same file at apps/worker/models/ - see
# README.md's prerequisites.
RUN mkdir -p /app/models && curl -sL -o /app/models/blaze_face_short_range.tflite \
    https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite
# FaceLandmarker's OWN `.task` bundle (Face Intelligence initiative, Batch 1
# - detect_face_landmarks.py) - a SEPARATE model file from blaze_face_short_
# range.tflite above, NOT bundled in the pip package either. Missed in this
# Dockerfile when Batch 1 first shipped (README.md's local-dev prerequisites
# were updated, this production image step was not) - fixed here, found
# while wiring Batch 4 into the same script.
RUN curl -sL -o /app/models/face_landmarker.task \
    https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
# GestureRecognizer's OWN `.task` bundle (Gesture Intelligence, ARCHITECTURE.md's own "needs its
# OWN MediaPipe model file" note) and ObjectDetector's OWN EfficientDet-Lite0 `.tflite` (Object
# Intelligence Batch OI-1) - the SAME class of gap as face_landmarker.task above (missed when each
# initiative first shipped, this production image step never added), found for real this time by
# Phase D's real-video benchmark (docs/ai/phase-d-benchmark.md) actually exercising the full render
# graph against a real clip - every prior test/harness fixture used short synthetic clips that
# never triggered either detector's real subprocess call.
RUN curl -sL -o /app/models/gesture_recognizer.task \
    https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task
RUN curl -sL -o /app/models/efficientdet_lite0.tflite \
    https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/latest/efficientdet_lite0.tflite
# Brand Kit roadmap (P3a) - the curated, OFL-licensed caption font list (see
# packages/subtitles' FONT_FAMILIES - this list and that one must be kept in
# sync by hand, there's no build-time link between a Dockerfile and a
# TypeScript const). Fetched from google/fonts' own OFL repo (the canonical
# source, same "fetch from source rather than commit a binary asset"
# reasoning as the MediaPipe models above) into a real fontconfig-scanned
# directory, then indexed with fc-cache - no `fontsdir=` filter argument
# needed at ffmpeg-call time as a result. Inter/Montserrat/Roboto/Oswald/
# Nunito/Open Sans ship only as a single variable-weight TTF upstream (no
# separate static Bold file) - verified these still expose named instances
# (incl. Bold) that fontconfig/libass can resolve; Poppins/Lato ship real
# static Regular+Bold files, fetched as pairs for exact fidelity.
RUN mkdir -p /usr/share/fonts/truetype/speedora \
    && curl -sL -o /usr/share/fonts/truetype/speedora/Inter-Regular.ttf \
        "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf" \
    && curl -sL -o /usr/share/fonts/truetype/speedora/Poppins-Regular.ttf \
        "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Regular.ttf" \
    && curl -sL -o /usr/share/fonts/truetype/speedora/Poppins-Bold.ttf \
        "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf" \
    && curl -sL -o /usr/share/fonts/truetype/speedora/Montserrat-Regular.ttf \
        "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf" \
    && curl -sL -o /usr/share/fonts/truetype/speedora/Roboto-Regular.ttf \
        "https://github.com/google/fonts/raw/main/ofl/roboto/Roboto%5Bwdth,wght%5D.ttf" \
    && curl -sL -o /usr/share/fonts/truetype/speedora/Oswald-Regular.ttf \
        "https://github.com/google/fonts/raw/main/ofl/oswald/Oswald%5Bwght%5D.ttf" \
    && curl -sL -o /usr/share/fonts/truetype/speedora/Nunito-Regular.ttf \
        "https://github.com/google/fonts/raw/main/ofl/nunito/Nunito%5Bwght%5D.ttf" \
    && curl -sL -o /usr/share/fonts/truetype/speedora/OpenSans-Regular.ttf \
        "https://github.com/google/fonts/raw/main/ofl/opensans/OpenSans%5Bwdth,wght%5D.ttf" \
    && curl -sL -o /usr/share/fonts/truetype/speedora/Lato-Regular.ttf \
        "https://github.com/google/fonts/raw/main/ofl/lato/Lato-Regular.ttf" \
    && curl -sL -o /usr/share/fonts/truetype/speedora/Lato-Bold.ttf \
        "https://github.com/google/fonts/raw/main/ofl/lato/Lato-Bold.ttf" \
    && fc-cache -f /usr/share/fonts/truetype/speedora
WORKDIR /app
COPY --from=build /out .
# No .env file is copied into the image on purpose - config comes entirely
# from real environment variables passed at `docker run`/orchestrator level.
# main.ts's dotenv config() call just no-ops when the file isn't found, same
# as it already does in CI where DATABASE_URL etc. also aren't a file.
USER node
# No HTTP server here (apps/worker only consumes BullMQ jobs), so there's no
# endpoint to HEALTHCHECK against the way apps/api's/apps/web's Dockerfiles
# do. If the process crashes outright, the container exits non-zero and the
# orchestrator restarts it on its own (see validateEnv() in env.ts for the
# fail-fast-at-boot half of that story) - no HEALTHCHECK needed for THAT
# case. This HEALTHCHECK instead catches the case Docker's own exit-code
# handling can't: the process wedged but still technically alive (the exact
# "worker stopped making progress but never crashed" shape of tonight's
# incidents) - a plain "is dist/main.js still running" liveness probe, not a
# real dependency check like api's/web's.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD pgrep -f "dist/main.js" || exit 1
CMD ["node", "dist/main.js"]
