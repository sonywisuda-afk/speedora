# Build from the repo root: docker build -f apps/worker/Dockerfile .
# This is a pnpm workspace - packages/shared, packages/database, and
# packages/storage are real source dependencies of apps/worker, not
# published packages, so the build context has to be the whole monorepo.

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @viral-clip-app/shared build \
    && pnpm --filter @viral-clip-app/database build \
    && pnpm --filter @viral-clip-app/storage build \
    && pnpm --filter @viral-clip-app/worker build
# Bundles apps/worker's dist output with only its production dependencies
# (workspace deps included as real copies, not symlinks) into a
# self-contained directory - see https://pnpm.io/cli/deploy. --ignore-scripts
# because this reruns packages/database's postinstall (`prisma generate`),
# and the prod-only install here has already stripped out the `prisma` CLI
# (a devDependency) - the generated client from the build step above is
# already sitting in packages/database/dist and gets copied over as-is.
RUN pnpm --filter @viral-clip-app/worker deploy --prod --ignore-scripts /out

FROM node:20-slim AS runtime
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
    && rm -rf /var/lib/apt/lists/*
# --break-system-packages: Debian 12's system Python enforces PEP 668
# (no unmanaged global pip installs) - fine to override in a single-purpose
# container that only ever runs this one script.
RUN pip install --no-cache-dir --break-system-packages mediapipe opencv-python-headless
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
WORKDIR /app
COPY --from=build /out .
# No .env file is copied into the image on purpose - config comes entirely
# from real environment variables passed at `docker run`/orchestrator level.
# main.ts's dotenv config() call just no-ops when the file isn't found, same
# as it already does in CI where DATABASE_URL etc. also aren't a file.
USER node
# No HTTP server here (apps/worker only consumes BullMQ jobs), so there's no
# endpoint to HEALTHCHECK against. Liveness is the process itself: if it
# crashes, the container exits non-zero and the orchestrator restarts it -
# see validateEnv() in env.ts for the fail-fast-at-boot half of that story.
CMD ["node", "dist/main.js"]
