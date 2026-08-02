# Operations runbook

Scenario-driven procedures for running Speedora in production. This doc is deliberately thin where
another doc already covers the mechanism in depth - it cross-references rather than duplicates, and
focuses on "what do I actually do when X happens."

Before anything else in an incident, check:

- `GET /health` (`apps/api`) - Postgres/Redis/storage reachability
- `GET /alerts` (`docs/alerting.md`) - what's currently wrong, and since when
- `GET /queues` + `GET /workers` (`docs/monitoring.md`) - queue backlog, stalled jobs, connected workers
- `GET /backups` (`docs/backup-restore.md`) - backup freshness

## Backup

Automated (Postgres `pg_dump` + object-storage `mc mirror`), verified, retained, and health-checked
- see `docs/backup-restore.md` for the full mechanism, configuration, and manual-verification
commands. Quick facts:

- Runs on `BACKUP_INTERVAL_HOURS` (default 24), immediately on container start too.
- Retained for `BACKUP_RETENTION_DAYS` (default 14).
- Health: `GET /backups` - `stale: true` means the last run failed or is older than
  `BACKUP_STALE_AFTER_HOURS` (default 48).
- **Off-box copies are a manual step, not automated yet** - see `backup-restore.md`'s last section.
  Do this periodically; it's the one piece of the backup story this repo can't automate for you
  (the "where off-box" is an infrastructure decision, not a code one).

## Restore

Full step-by-step commands are in `docs/backup-restore.md`. Summary:

1. Identify the backup to restore from - `docker compose -f docker-compose.prod.yml run --rm --entrypoint ls backup /backups/postgres` (or `/backups/storage`).
2. Verify it first (`verify-postgres-backup.sh` / `verify-storage-backup.sh`) - never restore an
   unverified backup if you can avoid it.
3. Restore (`restore-postgres.sh` / `restore-storage.sh`, both require `--yes`).
4. For Postgres specifically: run `prisma migrate status` (`packages/database`) against the
   restored database before pointing `apps/api`/`apps/worker` at it - the dump may predate
   migrations applied since it was taken.
5. Restart `api`/`worker` (`docker compose -f docker-compose.prod.yml restart api worker`) so every
   process reconnects cleanly rather than holding a stale connection/prepared-statement cache
   against the just-restored database.

Both restore scripts were exercised end-to-end while building this (restored into a scratch
database and a scratch bucket, confirmed rows/objects landed correctly) - this is a tested
procedure.

## Disaster recovery scenarios

### Redis is lost

Redis holds only in-flight BullMQ scheduling, never durable state (`docs/redis.md`) - every
completed pipeline stage is already committed to Postgres before the next stage is enqueued
(verified in `transcribe.worker.ts`: the transcript insert + `Video.status` update happen in one
`prisma.$transaction`, before the next queue's `.add()` call). Losing Redis mid-pipeline:

- Drops whatever was queued/in-flight at that moment. No completed stage's data is lost.
- There is no queue state left to auto-resume from - an operator must manually trigger a retry
  (`POST` the retry endpoint, or however `VideosService.retry()` is exposed) for any video stuck
  mid-stage. `VideosService.retry()`'s stage-inference logic (`docs/database.md`) figures out which
  stage to re-enqueue from the video's current `status`.
- Bring Redis back up (`docker compose -f docker-compose.prod.yml up -d redis`), then retry stuck
  videos. `GET /queues` will show zero jobs everywhere immediately after - that's expected, not a
  sign of further data loss.

### Postgres is lost

This is the scenario `docs/backup-restore.md` exists for. Follow the **Restore** section above.
Everything downstream (`apps/api`, `apps/worker`) depends on Postgres for its own state (`Video`/
`Clip`/`PublishRecord` rows) - there is no independent recovery path for the application beyond
restoring the database.

### A whole host is lost

1. Provision a new host, install Docker, clone this repo.
2. Populate `.env`/`.env.production` (see `docs/deployment.md`'s env var sourcing section) -
   these are gitignored and must be restored from wherever they're kept outside the repo (a secrets
   manager, an encrypted backup, etc - this repo has no mechanism for this, by design, since they
   contain credentials).
3. Restore the most recent off-box copy of the `backup-data` volume (see `backup-restore.md`) onto
   the new host, or `docker cp`/mount it in before bringing services up.
4. `docker compose -f docker-compose.prod.yml up --build` - `migrate` runs before `api`/`worker`
   start (see `deployment.md`), so a fresh Postgres volume gets schema'd automatically; a *restored*
   Postgres volume is already schema'd, so `migrate` just confirms it's current.
5. Follow **Restore** above for Postgres/storage using the copied `backup-data`.
6. Re-point DNS/load balancer at the new host once `GET /health` reports `ok`.

## Node replacement

"Node" here means the single host `docker-compose.prod.yml` runs on - this stack doesn't currently
have a multi-node orchestrator (no Kubernetes/Swarm), so "replacing a node" is the same as the
**whole host is lost** procedure above, run proactively (e.g. migrating to new hardware) rather than
reactively. The one difference: with the old host still reachable, copy `backup-data` and `.env*`
directly (`scp`/`rsync`) instead of restoring from an off-box backup.

## Worker replacement

`apps/worker` already handles this safely without operator intervention in the common case:

- **Graceful shutdown** (`apps/worker/src/main.ts`): on `SIGTERM`/`SIGINT`, every BullMQ `Worker`
  is closed (waits for in-flight jobs to finish, does not accept new ones), then queues are closed,
  then Prisma disconnects - all bounded by a 30-second timeout, after which the process force-exits
  rather than hanging `docker stop` indefinitely. `docker compose restart worker` / a container
  orchestrator's normal replace-on-deploy both go through this path.
- **If a worker is killed ungracefully** (`docker kill`, OOM, host crash - no time for the SIGTERM
  handler to run): whatever job it was mid-stage on is abandoned. On retry, that job's stage
  guard - e.g. `render-clip.worker.ts`'s "clip is already rendered - skipping duplicate job" check,
  `transcribe.worker.ts`'s equivalent - re-runs the **entire interrupted stage from scratch**, not a
  mid-stage resume. This is deliberate (stages are the retry unit, not sub-stage checkpoints), not a
  bug - but it does mean a killed transcribe job re-transcribes the whole video, not just the
  remaining chunks. Acceptable today; worth knowing if a video seems to "restart from 0%" after a
  worker restart.
- **Scaling worker capacity**: `apps/worker/src/subprocessLimiter.ts`'s concurrency cap
  (`MAX_CONCURRENT_SUBPROCESSES`) is per-process by design - each additional worker replica gets its
  own independent budget, so cluster-wide FFmpeg/Python concurrency scales linearly with replica
  count. Add capacity with `docker compose -f docker-compose.prod.yml up -d --scale worker=<N>`
  (the `worker` service publishes no host ports, so this scales cleanly with no port-conflict
  concern).

**On the Oracle Cloud Free hybrid deployment (`deployment.md`'s Fase 1-3)**, the single `worker`
service above doesn't exist - there's no one `docker compose ... --scale worker=<N>` to run.
Everything above still applies **per role**:

- Replacing/restarting a role: `docker compose -f docker-compose.oracle-worker-{light,ai,render}.yml
  restart worker` on that role's instance - same graceful-shutdown path, same 30-second timeout.
- Scaling a role: run its compose file on an additional instance with a distinct `WORKER_ID` (e.g.
  `WORKER_ID=worker-render-2`) - **do not** leave `WORKER_ID` at its default on a second replica of
  the same role, or its heartbeat silently overwrites the first's key in `GET /workers/health`
  (`monitoring.md`), making one replica invisible to that endpoint even though it's still correctly
  processing jobs (BullMQ itself doesn't care about `WORKER_ID` - only the heartbeat does).
  `MAX_CONCURRENT_SUBPROCESSES` scaling reasoning above is unchanged (still per-process).
- **Which instance is actually down?** `GET /workers/health` names each entry by `WORKER_ID`
  (`worker-light`/`worker-ai`/`worker-render` by default) and disappears once its heartbeat's TTL
  lapses - faster and more specific than checking `GET /workers`'s per-queue connected count when
  three separate instances are in play. See `deployment.md`'s Fase 3 Troubleshooting section for
  more.

## Database recovery

- **Corruption / bad migration**: restore from the most recent backup (see **Restore** above), then
  replay only the migrations that were meant to land after that backup was taken
  (`prisma migrate deploy`, `packages/database`).
- **A migration itself is bad** (deploys cleanly but breaks something): `packages/database`'s
  migration history is append-only via Prisma - the practical fix is a new forward migration that
  corrects the mistake, not editing/reverting a past one in place (editing an already-applied
  migration file doesn't undo its effect on a database that already ran it).
- **Slow queries / index issues**: not a recovery scenario by itself, but see `docs/prisma.md` and
  `docs/database.md` for schema conventions before adding an index under incident pressure - most of
  this schema's indexes were added for a specific, documented query pattern (see e.g.
  `PublishRecord`'s `@@index([status, scheduledAt])`, sized for the 60-second publish-schedule poll).

## Storage recovery

- **A specific object is missing/corrupted**: restore just that key from the most recent storage
  snapshot (`ops/backup/restore-storage.sh` mirrors a whole snapshot back - for a single object,
  `mc cp <snapshot-dir>/<key> speedora-target/<bucket>/<key>` after aliasing, same alias-setup
  pattern the script uses).
- **Whole bucket lost/corrupted**: follow **Restore** above (`restore-storage.sh`).
- **R2 vs. MinIO**: recovery is identical either way - `packages/storage`'s client and every backup/
  restore script are generic over any S3-compatible endpoint (`docs/docker.md`), only the
  `STORAGE_*` env values differ.

## Granting AI Ops access (Milestone 5C-B)

`GET /ops/ai/*` (the AI Operations Dashboard, `docs/backend.md`) is restricted to `ADMIN`/
`AI_ENGINEER`/`OPERATOR` roles - a plain `CREATOR` (every normal signup) gets a 403. There is
deliberately no self-service role-elevation endpoint - that would itself be a privilege-escalation
hole. Grant a role with:

```
cd apps/api && npx ts-node -T src/scripts/grant-role.ts user@example.com ADMIN
```

(`pnpm --filter @speedora/api grant-role -- user@example.com ADMIN` also exists as a package.json
script, but this pnpm version forwards the literal `--` into `process.argv` instead of stripping
it - use the direct `ts-node` form above instead.)

(`apps/api/src/scripts/grant-role.ts` - valid roles: `CREATOR`, `ADMIN`, `AI_ENGINEER`,
`OPERATOR`). Takes effect immediately on the user's next request - `JwtStrategy.validate()` reads
the role fresh from Postgres on every request, not from a JWT claim, so there's no need for the
user to log out/in again.

## Capacity planning quick reference

Sizing rationale already lives as inline comments where the limits are actually set, rather than
duplicated here to drift out of sync:

- Container memory limits and why they're sized that way: `docker-compose.prod.yml` (`api`: 1g,
  `worker`: 4g, `web`: 512m, `backup`: 256m).
- Worker concurrency/lock-duration rationale: `apps/worker/src/workers/transcribe.worker.ts`.
- Subprocess concurrency rationale (the incident that motivated it): `apps/worker/src/subprocessLimiter.ts`.

For capacity trending over time, use `GET /metrics`'s `pipeline` section (`docs/monitoring.md`) -
render job counts/durations and node-execution failure rates over a rolling 24-hour window are the
leading indicators for "this host needs more worker capacity," not a guess.
