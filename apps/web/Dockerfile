# Build from the repo root: docker build -f apps/web/Dockerfile .
# This is a pnpm workspace - packages/shared is a real source dependency of
# apps/web, not a published package, so the build context has to be the
# whole monorepo.

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @speedora/shared build
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, not
# read at container-run time, so this has to be a build arg rather than a
# `docker run -e`. Rebuild the image to point it at a different API URL.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Same "build arg, not runtime env" reasoning as above - only needed for the
# premium (OpenAI Whisper) checkout button to load Midtrans's Snap.js;
# left blank the button just fails with a clear error until set.
ARG NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=
ENV NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=$NEXT_PUBLIC_MIDTRANS_CLIENT_KEY
ARG NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION=false
ENV NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION=$NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION
# Turns on next.config.mjs's output: 'standalone' - off by default so a
# plain local `pnpm build` doesn't need Windows Developer Mode (or an
# elevated process) just to recreate pnpm's symlinked node_modules.
ENV DOCKER_BUILD=1
RUN pnpm --filter @speedora/web build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# next.config.mjs's output: 'standalone' traces the minimal server + deps
# needed to run (workspace deps resolved as real files, not symlinks) into
# .next/standalone, mirroring the monorepo's directory layout. static/
# isn't included in that trace and needs copying separately - see
# https://nextjs.org/docs/app/api-reference/config/next-config-js/output.
# (No public/ dir exists in this app, so nothing to copy for it.)
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
