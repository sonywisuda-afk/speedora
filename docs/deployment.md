# Deployment

Production runs via `docker-compose.prod.yml`. See `docker.md` for image-build details and
`architecture.md` for the general service topology (api/worker/web + Postgres/Redis/object
storage).

## Bringing up production

```bash
docker compose -f docker-compose.prod.yml up --build
```

`docker-compose.prod.yml` has an explicit `name: speedora-prod` so it never collides with
`docker-compose.yml` (dev) if both happen to run on the same machine in the same directory —
without it, compose derives the project name from the folder, and `postgres`/`redis` in both
files would be treated as the same containers (a `down` on one could delete the other's data).

## Migration-before-boot ordering

`packages/database/Dockerfile` builds a one-shot `migrate` service; both `api` and `worker`
services declare `depends_on: { migrate: { condition: service_completed_successfully } }`, so
neither app starts against a database that hasn't been migrated yet.

## Env var sourcing

Two files, layered via `env_file` as a **list** on the `api`/`worker` services:

```yaml
env_file:
  - .env
  - .env.production
```

Later files win on shared keys. `.env` is the single source for everything that's the *same* value
in dev and prod (`JWT_SECRET`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `MIDTRANS_*`, etc.) — it is not
copied into any Docker image; these values come from the real environment the compose file is run
in. `.env.production` (gitignored, start from the tracked `.env.production.example`) overrides
just `STORAGE_*`, because `.env`'s copy points at the dev-only MinIO container (`docker.md`) which
doesn't exist in the prod compose stack. `DATABASE_URL`/`REDIS_URL`/`FFMPEG_PATH` are overridden
directly in the compose file itself (compose network service names / the container's own ffmpeg
binary), not sourced from either env file.

Forgetting to populate `.env.production` before a prod deploy does **not** fail boot — `STORAGE_*`
isn't validated at startup (see `backend.md`'s boot-time guarantees) — but every upload/download
will fail trying to reach `localhost:9000`, which doesn't exist inside the prod container network.
Check this explicitly before/after a deploy, it will not surface as a boot error.

## Storage: MinIO (dev) vs. R2/S3 (prod)

See `docker.md` for the full MinIO story. The only thing that differs between dev and prod is the
`STORAGE_*` env values — `packages/storage`'s client code is fully generic over any S3-compatible
endpoint and needs zero changes either way.

## Hybrid Oracle Cloud Free deployment (Fase 1-2)

An audit of this stack's actual resource footprint (docker-compose.prod.yml's own comments,
`subprocessLimiter.ts`, the FFmpeg/MediaPipe pipeline in `apps/worker`) found that only one
service — `worker` — is genuinely CPU/memory-heavy; `web`, `api`, `postgres`, and `redis` are
light, mostly I/O-bound processes. That split is exactly what Oracle Cloud's Always Free tier (4
OCPU / 24 GB Ampere A1, splittable across up to 4 instances) is a good fit for: run `web`+`api`
(+`postgres`+`redis`) on one free instance and `worker` on a second, instead of paying for a
single larger box sized for `worker`'s peak.

`docker-compose.oracle-web-api.yml` and `docker-compose.oracle-worker.yml` are
`docker-compose.prod.yml` split along exactly that line — same services, same images, same env
layering (`.env` + `.env.production`), nothing rewritten. `docker-compose.prod.yml` itself is
untouched and remains the single-host reference stack.

### Prerequisites (do these before bringing either stack up)

1. **Real passwords.** `POSTGRES_PASSWORD`/`REDIS_PASSWORD` default to a committed placeholder
   (`viralclip`) — harmless in `docker-compose.prod.yml`, where neither port ever leaves the
   compose network, but `docker-compose.oracle-web-api.yml` publishes both ports to the host so a
   second instance can reach them. Set real values for both in `.env` first.
2. **Network isolation, not just passwords.** Put both Oracle instances in the same VCN and use
   the web-api instance's *private* IP as `ORACLE_WEB_API_HOST` below — never a public IP/DNS name
   if it can be avoided. Then restrict the web-api instance's Security List (or an OS-level
   firewall) so inbound Postgres (5432) and Redis (6379) are only reachable from the worker
   instance's IP, not the whole internet. Compose's `ports:` mapping only controls
   container-to-host binding; it has no opinion on host-to-internet exposure — that's this step,
   done in the Oracle Cloud console, not in this repo.

### Bringing it up

```bash
# On the web-api instance:
docker compose -f docker-compose.oracle-web-api.yml up --build

# On the worker instance (ORACLE_WEB_API_HOST is required - the compose file
# fails loudly at parse time if it's unset):
ORACLE_WEB_API_HOST=<web-api instance's private IP> \
  docker compose -f docker-compose.oracle-worker.yml up --build
```

### Selective queue startup (`WORKER_QUEUES`)

`apps/worker/src/main.ts` starts all 16 BullMQ queues in one process by default — identical
behavior to `docker-compose.prod.yml` today. Setting `WORKER_QUEUES` (comma-separated
`QueueName` values, e.g. `WORKER_QUEUES=render-clip,detect-clips,probe-video`) restricts a given
worker process to only that subset; `apps/worker/src/env.ts`'s `validateEnv()` rejects an unknown
queue name at boot with a clear error rather than silently starting zero workers for it (see
`workerQueueSelection.ts`). `docker-compose.oracle-worker.yml` leaves it unset — Fase 2 moves the
whole worker process to its own host as one unit, it does not split `render-clip` out yet.

This exists ahead of need: it's the mechanism a future Fase 3 (GPU worker) reuses to run only
`render-clip-gpu` on a GPU-backed host once that queue exists, without touching this file's
CPU-only worker at all. See the infrastructure audit artifact referenced in project history for
the full hybrid/GPU-routing design this prepares for.
