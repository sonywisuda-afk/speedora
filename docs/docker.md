# Docker

## App images

Each of `apps/web`, `apps/api`, `apps/worker` has its own multi-stage `Dockerfile`, built from the
repo root (workspace deps need access to `packages/*`). All use
`pnpm deploy --prod --ignore-scripts` to bundle `dist` + production deps into a self-contained
directory without workspace symlinks (`--ignore-scripts` because otherwise `packages/database`'s
postinstall — `prisma generate` — reruns during the `--prod` install using the pruned devDeps,
even though the already-built generated client from the build stage was already copied in).

- **`apps/worker`** — see `worker.md`'s Docker section for the full Python/MediaPipe/Tesseract
  dependency list. `node:22-slim` (Debian), not Alpine — MediaPipe has no musl wheel.
- **`apps/web`** — Next.js `output: 'standalone'`. `NEXT_PUBLIC_API_URL` is a **build arg**, not a
  runtime env var — `NEXT_PUBLIC_*` values are inlined into the client bundle at `next build` time.
- **`apps/api`** — standard NestJS build.

No `.env` file is ever copied into any image — `dotenv.config()`/`envFilePath` calls are no-ops
when the file doesn't exist (same behavior as CI), and every config value comes from real
environment variables supplied at container run time.

## Migration job

`packages/database/Dockerfile` (single-stage, full install so the `prisma` CLI is present) builds
a one-shot `migrate` container that runs before `apps/api`/`apps/worker` start —
`docker-compose.prod.yml`'s `migrate` service uses `condition: service_completed_successfully` so
both apps wait for migrations to finish before booting.

## Local dev object storage — MinIO

`docker-compose.yml` (dev) runs a local S3-compatible bucket via `minio`/`minio-init` (the second
a one-shot `mc mb --ignore-existing` bootstrap so a fresh `docker compose up` needs no manual
console step). Added because this project's dev ISP intermittently blackholed Cloudflare R2's IP
range, making every dev upload/preview/download fail unpredictably — a network problem, not an
application bug, so the fix removes the external-network dependency for day-to-day dev rather than
adding retries that wouldn't help against a genuinely blocked route.

Point `STORAGE_ENDPOINT=http://localhost:9000` at MinIO (credentials `minioadmin`/`minioadmin` by
default, overridable via `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`). `packages/storage`'s client is
already fully generic over any S3-compatible endpoint (`STORAGE_*` env vars, not `R2_*` — see
`architecture.md`), so this required **zero application code changes**, purely a compose/env
addition. A one-off script (`.dev-storage/migrate-r2-to-minio.cjs`) exists to copy pre-existing dev objects
from R2 to MinIO if needed. **`.dev-storage/` is gitignored specifically because scripts like this
tend to carry hardcoded one-time-use credentials** (this one does) — never commit it or copy
credentials out of it into a tracked file.

## Production storage — R2/S3

Production (`docker-compose.prod.yml`) keeps using real R2/S3. Because `.env`'s `STORAGE_*` now
points at dev-only MinIO, `docker-compose.prod.yml` layers a second env file:
`env_file: [.env, .env.production]` (a **list** — later files win on shared keys) — every secret
except `STORAGE_*` still comes from the one shared `.env`; `.env.production` (gitignored, copied
from the tracked `.env.production.example`) overrides just the storage credentials for the real
bucket. See `deployment.md`. Forgetting to fill in `.env.production` doesn't fail boot
(`STORAGE_*` isn't boot-validated — see `backend.md`), it just makes every upload/download in prod
fail trying to reach `localhost:9000`, which doesn't exist inside the prod container network.
