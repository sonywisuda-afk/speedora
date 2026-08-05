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
# Also needs soundfile (audio decoding, same as diarize_speakers.py/
# detect_vocal_emotion.py) - NOTE: soundfile/pyannote.audio/transformers/
# torch are NOT currently in this image's pip install at all, a pre-existing
# gap predating this change (Speaker Diarization and Vocal Emotion Detection
# are exercised in local dev but this Docker image has never actually
# installed their dependencies) - not fixed here, flagged for a separate pass.
RUN pip install --no-cache-dir --break-system-packages mediapipe opencv-python-headless yt-dlp scipy pytesseract webrtcvad
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
