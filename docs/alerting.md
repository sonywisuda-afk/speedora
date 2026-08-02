# Alerting foundation

A foundation only, per explicit scope: **no external integrations** (no Slack/PagerDuty/email/etc)
and no background scheduler. `GET /alerts` on `apps/api` evaluates a fixed set of conditions against
the same data `docs/monitoring.md`'s endpoints already compute, on demand, whenever it's polled.
Wiring a real alerting backend to consume this is a later, separate decision - this only builds the
"what conditions exist, and how long has each been true" layer underneath that.

## Conditions and thresholds

Defined as pure functions in `packages/shared/src/utils/alert-conditions.ts` - reusable, testable in
isolation, with no dependency on apps/api's Nest wiring. Thresholds are plain data
(`DEFAULT_ALERT_THRESHOLDS`), not hardcoded inside the predicates, since there's no production data
yet to calibrate "backlogged" or "high failure rate" against (same posture as the Fusion Engine's
own not-yet-calibrated weights - see `CLAUDE.md`).

| Condition | Default threshold | Severity | Source |
|---|---|---|---|
| `queue-backlog:<name>` | `waiting > 100` or `active > 50` | warning | `GET /queues` |
| `queue-stalled:<name>` | any likely-stalled job present | warning | `GET /queues` |
| `queue-failure-rate:<name>` | `failed / (failed + completed) > 20%` | warning | `GET /queues` |
| `worker-offline:<name>` | zero connected workers | critical | `GET /workers` |
| `database-unreachable` | `/database` reports unreachable | critical | `GET /database` |
| `redis-unreachable` | `/redis` reports unreachable | critical | `GET /redis` |
| `storage-unreachable` | `/storage` reports unreachable | critical | `GET /storage` |
| `backup-postgres-stale` | `/backups`' own `stale` flag | critical | `GET /backups` (`docs/backup-restore.md`) |
| `backup-storage-stale` | `/backups`' own `stale` flag | critical | `GET /backups` |
| `heap-pressure` | `heapUsed / heapTotal > 90%` | warning | `GET /metrics` |

**Deliberately not included**: disk-near-full and CPU-saturation conditions the original audit
proposed - this stack doesn't currently collect host-level disk usage or a CPU rate (only
cumulative `cpuUsage()`, which needs two samples over time to become a rate, not a single-point
threshold), so a condition for either would be unmeasurable rather than genuinely evaluated. Add
them once there's a real signal to threshold against, rather than defining a condition that can
never usefully fire.

## Internal alert state

`apps/api/src/monitoring/alert-state.ts`'s `alertStateTracker` is a small in-memory map from alert
id to the timestamp it first became true. Every `GET /alerts` call re-evaluates all conditions:

- A condition that's newly true gets `since: <now>`.
- A condition that's still true from a previous call keeps its original `since`.
- A condition that's no longer true is dropped - if it recurs later, that's a new incident with a
  new `since`, not a resumption of the old one.

This is what turns "is X true right now" into "X has been true since 14:02", without a database
table or a background job - purely computed at request time.

```json
{
  "evaluatedAt": "2026-07-12T07:40:34.347Z",
  "thresholds": { "queueBacklogWaiting": 100, "queueBacklogActive": 50, "failureRate": 0.2, "heapUsageRatio": 0.9 },
  "alerts": [
    { "id": "queue-failure-rate:transcribe", "severity": "warning", "message": "Queue \"transcribe\" failure rate is high (failed=24, completed=4)", "since": "2026-07-12T07:39:53.797Z" },
    { "id": "backup-postgres-stale", "severity": "critical", "message": "Postgres backup is stale, failing, or has never run", "since": "2026-07-12T07:39:53.797Z" }
  ]
}
```

**Caveat**: process-local, same as `metrics-registry.ts` and `subprocessLimiter.ts` - restarting
`apps/api` resets every alert's `since` to "now" the next time it's still true, even if it had
already been active for hours. Acceptable for a foundation with no external sink yet; revisit if
alerts start being persisted or forwarded somewhere that survives a restart.

## AlertRule / alert-engine (push-based, DB-persisted)

A **separate, parallel mechanism** from everything above — this doc's "no background scheduler"
scope note applies to `GET /alerts` specifically, not to this. `apps/worker/src/workers/
alert-engine.worker.ts` polls a BullMQ repeatable trigger (`ALERT_CHECK_INTERVAL_MS`, default 30
min) and evaluates a registered list of `AlertRule`s (`packages/database/src/alert-engine.ts`),
each returning one or more `{ dedupeKey, breached, recipientUserIds, notification }` instances.
`runAlertRules()` persists dedup state in a Postgres `AlertState` row (durable across worker
restarts, unlike `alert-state.ts`'s in-memory tracker above) and calls `recordNotification()` -
a real in-app `Notification` row, not a pull-based JSON response - exactly once per breach, deleting
the `AlertState` row once the condition clears so a later re-breach notifies again.

Registered rules today (`ALERT_RULES` in `alert-engine.worker.ts`):

| Rule | Scope | Condition | `NotificationType` |
|---|---|---|---|
| `storage-warning` | system-wide | object storage usage over `STORAGE_QUOTA_BYTES` | `STORAGE_WARNING` |
| `credit-warning` | per-user | unspent PAID premium-transcription credits reach 0 | `CREDIT_WARNING` |
| `sync-failure-warning` | per-account | `SocialAccount.consecutiveSyncFailures >= SYNC_FAILURE_ALERT_THRESHOLD` (default 3) | `SYNC_FAILURE_WARNING` |
| `video-import-crash-spike` | system-wide | rolling-window `internal`-category video-import failures `>= IMPORT_CRASH_ALERT_THRESHOLD` (default 5, window default 1h) | `IMPORT_FAILURE_SPIKE` |

The last one is the Download Reliability Framework's addition - see `video-import-reliability.md`.
It reads `readRecentInternalCrashCount()` (`packages/shared`'s `video-import-metrics.ts`, a
Redis counter with a real `EXPIRE`-based rolling window, distinct from that module's other all-time
counters) rather than querying Postgres for the condition itself, same "call whatever I/O the
condition needs directly inside `evaluate()`" shape `storage-warning` already uses for
`getBucketUsage()`.

Adding a 5th rule is exactly "write the rule object, push it into `ALERT_RULES`" - no scheduler
change, no new queue, no new plumbing (see that array's own comment).

## What this deliberately does not do

- No Slack/PagerDuty/email/webhook delivery - `GET /alerts` is pull-based; something else (a cron,
  an uptime checker, a human) has to poll it.
- No deduplication/escalation policy beyond the `since` timestamp above.
- No threshold tuning yet - defaults are reasonable guesses, not calibrated against real production
  traffic. Revisit once there's actual data, same as the Fusion Engine's weight-0 signals.
