# Monitoring

Lightweight operational visibility on `apps/api` - deliberately **no Prometheus, OpenTelemetry, or
Grafana**: every endpoint below is a plain JSON response computed from data this stack already has
(BullMQ's own queue state, Postgres, the existing render-graph telemetry, Node's own process APIs).
If a real metrics backend is adopted later, `apps/api/src/monitoring/metrics-registry.ts` is the one
place that would start pushing to it instead of just counting in memory - everything else here can
be scraped as-is by whatever's doing the scraping.

All endpoints are unauthenticated and unthrottled, same posture as `/health` - a load balancer,
uptime checker, or on-call engineer needs to reach them without a session, and none of them return
video/user data, only operational numbers.

## `GET /metrics`

Four sections in one response:

- **`process`** - uptime, memory (`rssBytes`/`heapUsedBytes`/`heapTotalBytes`), CPU time
  (`userMs`/`systemMs`, cumulative since process start - diff two snapshots for a rate). All Node
  built-ins, no dependency.
- **`http`** - cumulative request count by status class (`2xx`/`3xx`/`4xx`/`5xx`) for **this
  process only** (see the in-memory-counter caveat below).
- **`pipeline`** - a 24-hour rollup reusing data already being recorded elsewhere rather than a
  parallel metrics path: `videosByStatus` (from `Video.status`), `videoFailures` (from
  `VideoStatusEvent` where `toStatus = FAILED`), `renderJobs` (count + average duration from
  `JobExecution.totalDurationMs` - the render-graph telemetry documented in `worker.md`), and
  `nodeExecutions` (per-status counts and failure rate from `NodeExecution`).
- **`videoImport`** - all-time (not windowed) counters for the YouTube import subsystem
  (`@speedora/video-import-engine`/`YtDlpEngine`), written by `apps/worker`'s
  `import-youtube.worker.ts` after every import and read back via `@speedora/shared`'s
  `readVideoImportMetrics()`: `totalImports`/`successfulImports`/`failedImports`/`successRate`,
  `retryCount`, `avgDurationMs`, `timeoutCount`, `cancellationCount`, a `failuresByCategory` breakdown
  (`network`/`extractor`/`unavailable`/`private`/`age_restricted`/`rate_limited`/`unsupported`/
  `timeout`/`cancelled`/`storage`/`internal`, plus the Download Reliability Framework's
  `disk`/`permission`/`geo_restricted`/`authentication`/`invalid_url` — see
  `video-import-reliability.md` for what each means), the current `engineName`/`engineVersion`/
  `engineHealthStatus` (`healthy`/`stale`/`unreachable`, from the engine's `checkVersion()`), and
  `lastSuccessfulImportAt`. **Download Reliability Framework** added 5 fields derived from the above
  at read time (no new Redis keys): `retryRate`/`avgRetries` (both `retryCount / totalImports` -
  same number under the two names the reliability requirements used),
  `internalCrashCount`/`extractorFailureCount` (read off `failuresByCategory`), and
  `topFailureReason` (the category with the highest count, `null` if none yet).

```json
{
  "process": { "uptimeSeconds": 102, "memory": { "rssBytes": 220618752, "heapUsedBytes": 135794272, "heapTotalBytes": 142757888 }, "cpu": { "userMs": 12843, "systemMs": 8406 } },
  "http": { "totalRequests": 8, "byStatusClass": { "2xx": 8, "3xx": 0, "4xx": 0, "5xx": 0, "other": 0 } },
  "pipeline": { "windowHours": 24, "videosByStatus": { "RENDERED": 1 }, "videoFailures": 7, "renderJobs": { "count": 7, "avgDurationMs": 93915 }, "nodeExecutions": { "byStatus": { "FALLBACK": 35, "SUCCESS": 182 }, "failureRate": 0 } },
  "videoImport": { "totalImports": 12, "successfulImports": 11, "failedImports": 1, "successRate": 0.9166666666666666, "retryCount": 2, "avgDurationMs": 48213, "timeoutCount": 0, "cancellationCount": 0, "failuresByCategory": { "network": 1 }, "engineName": "yt-dlp", "engineVersion": "2025.06.30", "engineHealthStatus": "healthy", "lastSuccessfulImportAt": "2026-07-26T01:15:32.209Z", "retryRate": 0.16666666666666666, "avgRetries": 0.16666666666666666, "internalCrashCount": 0, "extractorFailureCount": 0, "topFailureReason": "network" }
}
```

**Caveat**: `http` counters (`apps/api/src/monitoring/metrics-registry.ts`) are process-local, same
limitation as `apps/worker`'s `subprocessLimiter.ts` - with N horizontally-scaled `apps/api`
replicas, each one reports only its own share of requests. Fine as a quick "is this instance under
load" signal; not a substitute for a real aggregated backend if that's ever adopted. `videoImport` is
**not** subject to this caveat - it's backed by Redis `INCR`/`HINCRBY` (see `docs/redis.md`), so it
stays correct across worker restarts and multiple worker replicas.

## `GET /queues`

Per-queue job counts (`waiting`/`active`/`completed`/`failed`/`delayed`/`paused`) for **every**
queue in the system - all 17 as of PR #45 (16 as of Fase 3's Queue Metrics pass, which completed
the `queue.module.ts` registration list - `ALERT_ENGINE`/`SYNC_FOLLOWER_COUNT`/
`TELEGRAM_CHAT_DISCOVERY` were missing entirely, this endpoint covered only 7 before that - and
injected the rest into `MonitoringController`; PR #45 added the 17th, `metrics-snapshot`, see
`deployment.md`'s "Production Metrics Collection" section). Several queues `apps/api` never
produces into (e.g. `schedule-publish-clip`/`sync-publish-stats`/`alert-engine`/`metrics-snapshot`)
are registered read-only, purely so this endpoint has the full picture rather than just the queues
`apps/api` happens to enqueue into.

Also reports:

- `likelyStalled`: jobs that have been `active` for more than 5 minutes with no progress, checked
  over at most the 100 most-recently-active jobs per queue (bounded so this endpoint can never
  itself become a slow query). A **visibility heuristic**, not BullMQ's actual stalled-job recovery
  mechanism (`maxStalledCount` on the `Worker` side), which already exists and handles the real
  recovery independently of this endpoint.
- `failureRate` - `failed / (failed + completed)` from the same `getJobCounts()` call above (no
  extra Redis round-trips), `null` if there's no completed/failed data yet.
- `avgProcessingTimeMs` / `retriedJobs` (Fase 3 - Queue Metrics) - sampled over each queue's 50
  most recent completed/failed jobs (same bounded-sample shape as `likelyStalled` above, via
  `computeRecentJobMetrics()`), since BullMQ doesn't expose these as O(1) aggregates the way
  waiting/active/completed/failed are. `avgProcessingTimeMs` averages `finishedOn - processedOn`
  across the sampled completed jobs; `retriedJobs` counts sampled jobs whose `attemptsMade > 1`. The
  pure computation (`computeFailureRate`/`computeAvgProcessingTimeMs`/`countRetriedJobs`) lives in
  `@speedora/shared`'s `queue-metrics.ts`, unit-tested without a real Queue/Redis - the controller
  only fetches raw job data and calls these functions.

## `GET /workers`

Connected worker count per queue, read from BullMQ's own worker registry (`Queue.getWorkers()`) -
not a separate worker-registration mechanism, since BullMQ already tracks this. Per-**queue**, not
per-worker-**process** - see `GET /workers/health` below for that.

## `GET /workers/health`

Oracle Cloud Free hybrid deployment, Fase 3 (Health Endpoint). Per-worker-**process** visibility,
which `GET /workers` above can't provide (it reports "N clients connected to queue X", not "here is
process Y and everything it's responsible for"). `apps/worker` has no HTTP server of its own (see
`CLAUDE.md`), so each worker process instead writes a small heartbeat into Redis on startup and
every 15s (`apps/worker/src/workerHeartbeat.ts`), with a 45s TTL so a crashed (not gracefully
stopped) process's entry disappears on its own rather than lying stale forever. This endpoint reads
those heartbeats back (`speedora:worker:heartbeat:*`, key format shared via `@speedora/shared`'s
`worker-heartbeat.ts` so the writer and reader can't drift) and joins each one against that
worker's queues' current `active`/`waiting` counts:

```json
[
  {
    "worker": "worker-render",
    "queues": ["render-clip"],
    "jobsActive": 2,
    "jobsWaiting": 5,
    "startedAt": "2026-08-02T09:10:00.000Z",
    "heartbeatTtlSeconds": 41
  }
]
```

`WORKER_ID` (env var, see `.env.example`) is what names each entry - the Oracle worker-specialization
compose files (`docker-compose.oracle-worker-{light,ai,render}.yml`) set it explicitly
(`worker-light`/`worker-ai`/`worker-render`) since a container's hostname is normally a random
container id, not something an operator recognizes here. Unset, it falls back to `hostname-pid`.

Uses `KEYS speedora:worker:heartbeat:*`, not `SCAN` - safe here because cardinality is bounded by
the number of worker **processes** (single digits to low tens even at scale), not a general Redis
keyspace scan; the same judgment call `GET /redis`'s reachability check already makes for a single
key `GET`.

## `GET /storage`

Object-storage reachability (reuses `checkStorageConnection`) plus aggregate usage
(`objectCount`/`totalSizeBytes`) via `packages/storage`'s `getBucketUsage()`. S3-compatible storage
has no cheap "aggregate bucket size" API - this pages through the key listing (`ListObjectsV2`,
1000 keys/page) up to 20 pages. A bucket bigger than that comes back with `truncated: true` and a
count/size that's a lower bound, not the true total - flagged explicitly rather than silently
under-reporting.

## `GET /database`

Reachability + round-trip latency (`SELECT 1` via Prisma).

## `GET /redis`

Reachability + round-trip latency + `usedMemoryBytes` (parsed from Redis's own `INFO` output).
Uses BullMQ's adapter-agnostic `IRedisClient` interface (same one `HealthController` uses) rather
than assuming ioredis-specific methods like `ping()` - a `GET` on a key that will never exist is the
shared interface's equivalent reachability/latency probe.

## Related

`GET /backups` (backup freshness) lives in `docs/backup-restore.md`, not here, since it's about
backup health specifically rather than general operational monitoring. `docs/alerting.md` builds on
top of everything above.
