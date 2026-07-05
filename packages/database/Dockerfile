# One-shot migration runner, not a long-running service - meant to be run
# once against a fresh database before apps/api/apps/worker start (see the
# `migrate` service in docker-compose.prod.yml). Build from the repo root:
# docker build -f packages/database/Dockerfile .
#
# Deliberately a single stage with the full (non --prod) install: `prisma`
# itself is a devDependency, and `prisma migrate deploy` needs the real CLI,
# not just the generated client apps/api and apps/worker ship with.
FROM node:20-alpine
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
CMD ["pnpm", "--filter", "@speedora/database", "db:migrate:deploy"]
