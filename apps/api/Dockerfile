# Build from the repo root: docker build -f apps/api/Dockerfile .
# This is a pnpm workspace - packages/shared, packages/database, and
# packages/storage are real source dependencies of apps/api, not published
# packages, so the build context has to be the whole monorepo.

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Same pre-existing bug fixed in apps/worker/Dockerfile (see its comment) -
# hand-listing 3 of many workspace package dependencies goes stale as more
# get added. Building every package first, same "./packages/**" pattern the
# root package.json's own `pnpm build` script already uses successfully.
RUN pnpm --filter "./packages/**" build \
    && pnpm --filter @speedora/api build
# Bundles apps/api's dist output with only its production dependencies
# (workspace deps included as real copies, not symlinks) into a
# self-contained directory - see https://pnpm.io/cli/deploy. --ignore-scripts
# because this reruns packages/database's postinstall (`prisma generate`),
# and the prod-only install here has already stripped out the `prisma` CLI
# (a devDependency) - the generated client from the build step above is
# already sitting in packages/database/dist and gets copied over as-is.
RUN pnpm --filter @speedora/api deploy --prod --ignore-scripts /out

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
# No .env file is copied into the image on purpose - config comes entirely
# from real environment variables passed at `docker run`/orchestrator level.
# main.ts's ConfigModule envFilePath just no-ops when the file isn't found,
# same as it already does in CI where DATABASE_URL etc. also aren't a file.
USER node
EXPOSE 3001
# /live (not /health) - a cheap liveness probe with no Postgres/Redis/
# storage round-trip, so Docker's own polling loop doesn't add load to
# those on every interval. depends_on: condition: service_healthy (see
# docker-compose.prod.yml's web service) relies on this signal too - a
# container that's up but can't reach its dependencies still reports
# healthy here, same tradeoff every liveness-vs-readiness probe makes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3001/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
