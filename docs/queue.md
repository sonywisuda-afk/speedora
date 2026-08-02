# Queue (BullMQ)

BullMQ backed by Redis. Redis is queue + cache only — Postgres is the durable source of truth (see
`database.md`). All queues are defined in `apps/worker/src/queues.ts`. See `worker-architecture.md`
for how this queue layer, the atomic-write Snapshot pattern, and stage-inferred retry compose into
one flow — this doc covers queue/retry mechanics in isolation.

## Pipeline queues (self-chained inside `apps/worker`)

`IMPORT_YOUTUBE → TRANSCRIBE → DETECT_CLIPS → RENDER_CLIP` — each stage's own worker enqueues the
next stage on success. `apps/api` only ever enqueues the *first* stage (`TRANSCRIBE` on upload,
`IMPORT_YOUTUBE` on a YouTube URL submission); it never enqueues `DETECT_CLIPS`/`RENDER_CLIP`
directly. This keeps pipeline orchestration entirely inside `apps/worker`.

`DETECT_CLIPS`'s success enqueues **one `RENDER_CLIP` job per candidate clip**, not a single batch
job — each clip renders independently, so one clip's render failure never blocks its siblings, and
retrying a failed video only re-renders the clips that actually need it (see `database.md`'s retry
section).

## Publish queues

`PUBLISH_CLIP` — enqueued by `apps/api` (`ClipsService.publish()`) for an immediate publish, or by
`apps/worker`'s `schedule-publish-clip` repeatable job once a `SCHEDULED` row's time arrives. The
only queue with BullMQ's built-in retry (`attempts: 3`, exponential backoff, `PUBLISH_RETRY_OPTIONS`
shared from `packages/shared` so both enqueue sites use identical retry config) — every other
pipeline job fails once and waits for a user-triggered retry.

## Repeatable jobs

- **`schedule-publish-clip`** (60s interval) — polls `PublishRecord` rows with
  `status: SCHEDULED AND scheduledAt <= now()`, claims each atomically via
  `updateMany({ where: { id, status: SCHEDULED }, data: { status: QUEUED } })` and only enqueues
  `PUBLISH_CLIP` if `count === 1` — makes concurrent/overlapping poll firings safe without a
  distributed lock.
- **`sync-publish-stats`** (6h interval) — refreshes analytics snapshots per `PublishRecord`,
  isolates failures per-record (one broken token/deleted video doesn't stop the rest of the batch).

## Job payload convention

Every job payload is minimal — IDs and the few fields genuinely needed at enqueue time (e.g.
`RenderClipJobData` carries `transcript`/`keywords`/`scores` snapshotted from `detect-clips`, since
re-querying them per render would just reproduce the same data) — never a full snapshot of
mutable state. Workers re-fetch current DB state rather than trusting what was true at enqueue
time. `publish-clip` carries only `{ publishRecordId }`; the worker fetches the record plus its
`clip`/`socialAccount` relations in one `include`.

Job data types are defined in `packages/shared` but BullMQ's `new Queue(name, opts)` doesn't
enforce them at the type level for every producer — adding a required field to a job payload type
is **not** guaranteed to be caught by `tsc` at every enqueue call site. Grep for all `queue.add(...)`
calls for a given job type manually when changing its payload shape (this has caused at least one
real latent bug — see `docs/ai/fusion.md`'s Fusion Engine v2.1 note on `RenderClipJobData.scores`).

## Retry semantics

Pipeline jobs (`transcribe`/`detect-clips`/`render-clip`) fail once and stop — `VideosService.retry`
infers which stage to redo from what data already exists, not from a stored "failed at" marker
(see `database.md`). `publish-clip` and, since the Download Reliability Framework, `import-youtube`
are the exceptions with automatic BullMQ retry, because their failure modes (platform API rate
limits/5xx for publish; network blips, transient antivirus/OS interference, or a worker crash
mid-download for import) are judged not to need user judgment the way a pipeline stage failure does.

`import-youtube`'s `IMPORT_YOUTUBE_RETRY_OPTIONS` (`packages/shared/src/types/job.ts`) is
`{ attempts: 3, backoff: { type: 'exponential', delay: 60_000 } }` — a second, outer retry layer on
top of the engine's own in-process retry (`packages/video-import-engine/src/retry.ts`), added
specifically because that in-process layer's state doesn't survive a worker process crash/restart.
Only `VideoImportError.retryable` categories (`network`/`rate_limited`/`timeout`/`internal`) actually
get retried at this layer — the worker throws BullMQ's `UnrecoverableError` for anything else, which
skips all remaining attempts immediately regardless of `attempts`. See `video-import-reliability.md`
for the full design (including how this coordinates with the `IMPORTING`-status idempotency guard so
a mid-retry job doesn't get skipped as "already handled").
