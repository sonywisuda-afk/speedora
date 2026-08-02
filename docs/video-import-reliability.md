# Video Import Reliability (Download Reliability Framework)

Extends the existing `import-youtube` pipeline (`worker.md`, `queue.md`) with a second, job-level
retry layer, a health-check gate, richer failure categorization, and alerting — all additive on top
of what already existed (in-process exponential backoff, deterministic/idempotent storage keys, the
`IMPORTING`-status idempotency guard, Redis-backed metrics). No new subsystem, no second download
engine. See `ARCHITECTURE.md` for the JSON-contract pattern `@speedora/video-import-engine` already
follows — this framework doesn't change that pattern, it extends the adapter (`apps/worker`'s
`import-youtube.worker.ts`) and the shared job-options/metrics types around it.

## Two-layer retry

1. **In-process** (`packages/video-import-engine/src/retry.ts`, unchanged) — a handful of quick
   retries with exponential backoff *within one BullMQ job execution*, for a blip that resolves in
   seconds (`VIDEO_IMPORT_MAX_RETRIES`, default 2, i.e. 3 attempts total).
2. **Job-level** (`IMPORT_YOUTUBE_RETRY_OPTIONS` in `packages/shared/src/types/job.ts`) —
   `{ attempts: 3, backoff: { type: 'exponential', delay: 60_000 } }`, passed at both
   `importYoutubeQueue.add()` call sites (`VideosService.importFromYoutube`/`retry`). This is the
   layer that survives a **worker process crash or restart** mid-job — something the in-process
   layer alone can't, since its retry state lives only in that one process's memory.

Only categories in `RETRYABLE_CATEGORIES` (`network`, `rate_limited`, `timeout`, `internal`) are
retried at either layer. For anything else, `import-youtube.worker.ts` throws BullMQ's own
`UnrecoverableError` instead of the original error, which skips all remaining job-level attempts
immediately — so a non-retryable category (e.g. `private`, `unsupported`) never wastes a 60s+120s
backoff cycle on a retry that can't possibly succeed.

**Idempotency-guard coordination**: the worker only writes `Video.status = FAILED` (and only fires
the `RENDER_FAILED` notification) when the current attempt is genuinely final —
`!isRetryable || job.attemptsMade + 1 >= (job.opts.attempts ?? 1)` — mirroring the pattern already
proven in `publish-clip.worker.ts`. On a non-final retryable failure, `Video.status` stays
`IMPORTING`, so the worker's own `status !== IMPORTING` idempotency guard doesn't skip the next
BullMQ-scheduled attempt as "already handled." This also closes a pre-existing gap: the flat
`RENDER_FAILED` notification path has no dedup of its own, so without this gating, every automatic
retry would have spammed a fresh notification.

## Health-check gate

Before `fetchMetadata`/`download` run, the worker checks the engine's cached health
(`engine.checkVersion()`, cached at module scope for `VIDEO_IMPORT_HEALTH_CACHE_TTL_MS`, default 5
minutes). If `status === 'unreachable'` (missing/non-executable/corrupt binary), it throws a
retryable `internal`-category error *before* spawning any subprocess — the job fails this attempt
cleanly, and the job-level backoff naturally defers the retry, giving the environment time to
recover (e.g. an antivirus scan finishing) instead of wasting a download attempt.

This is deliberately a **per-job gate that reuses existing retry/backoff machinery**, not a
`Worker.pause()`/`resume()` — pausing the whole worker would need a separate background poller to
decide when to resume. The gate is cached (not a live check every job) so it adds no per-job
subprocess overhead beyond the TTL window.

## Failure categories

`ImportFailureCategory` (`packages/contracts/src/video-import.ts`, mirrored without a package
dependency in `packages/shared/src/utils/video-import-metrics.ts`):

| Category | Retryable | Typical cause |
|---|---|---|
| `network` | yes | HTTP 403/5xx, connection reset, generic "unable to download" |
| `rate_limited` | yes | HTTP 429 / yt-dlp's own rate-limit wording |
| `timeout` | yes | subprocess exceeded `VIDEO_IMPORT_TIMEOUT_MS` |
| `internal` | yes | empty-stderr crash (e.g. AV-scan interference), or the health-check gate |
| `extractor` | no | unrecognized yt-dlp failure (fallback category — site/format issue a retry won't fix) |
| `unavailable` | no | "Video unavailable" / removed |
| `private` | no | private video |
| `age_restricted` | no | "Sign in to confirm your age" |
| `authentication` | no | anti-bot "Sign in to confirm..." / login-wall wording distinct from the age gate |
| `geo_restricted` | no | "...not available in your country" |
| `unsupported` | no | domain not in `YTDLP_ALLOWED_DOMAINS` (pre-flight, before any subprocess) |
| `storage` | no | downloaded file exceeds `VIDEO_IMPORT_MAX_FILE_SIZE_BYTES` |
| `disk` | no | `ENOSPC` from the scratch-dir `mkdir`, or the equivalent yt-dlp stderr wording |
| `permission` | no | `EACCES`/`EPERM` from the scratch-dir `mkdir`, or the equivalent yt-dlp stderr wording |
| `invalid_url` | no | yt-dlp itself rejects the URL as malformed (rare — the allowlist check usually catches this first as `unsupported`) |
| `cancelled` | no | `AbortSignal` fired (job-level timeout, or a future explicit cancel action) |

**Verification caveat**: `disk`/`permission`/`geo_restricted`/`authentication`/`invalid_url`'s
stderr-regex matching (`categorizeExitFailure` in `ytDlpEngine.ts`) is written from documented/
expected yt-dlp wording, not confirmed against a real failing download in this environment — unlike
`unavailable`/`internal`, which were fixed from real production output (see that function's own
comments). Confirm against real production logs before treating the regexes as authoritative;
adjust if yt-dlp's actual wording differs.

`disk`/`permission` are classified in **two** places: `categorizeExitFailure` (yt-dlp's own stderr,
rare — yt-dlp writes the file, so it usually hits the OS error first) and
`classifyNodeError()`/`reserveScratchPath()` (this module's own `mkdir` call, the more likely path).

## Metrics (`GET /metrics`'s `videoImport` section — see `monitoring.md`)

All-time Redis counters, unchanged in shape, now joined by 5 derived fields computed at read time
(no new Redis keys): `retryRate`/`avgRetries` (both `retryCount / totalImports` — same computation
under the two names the reliability requirements used), `internalCrashCount`/`extractorFailureCount`
(read off the existing `failuresByCategory` hash), `topFailureReason` (the category with the highest
count). See `monitoring.md` for the full field list and example response.

## Alerting

A new `videoImportInternalCrashSpikeRule` in `apps/worker/src/workers/alert-engine.worker.ts`'s
`ALERT_RULES` array — see `alerting.md`'s "AlertRule / alert-engine" section for how this mechanism
works and how the new rule fits in.

## Structured logging

`import-youtube.worker.ts`'s log lines now include `workerHost` (`os.hostname()`), `engineVersion`,
and — on failure — `attempt`/`maxAttempts`/`retries`/`willRetry`. Combined with the existing
`videoId`/`category`/`exitCode`/`stderrExcerpt`, this is enough to reconstruct a full attempt
timeline for a given import from logs alone, without a new persisted column (see "Deliberately not
implemented" below).

## Deliberately not implemented

- **Durable per-video attempt/failure-category columns** (`Video.importAttempts`,
  `lastImportFailureCategory`) — no consumer beyond logs/metrics exists yet; add only alongside a
  real UI that needs to show a specific video's retry history, not speculatively.
- **A second download engine / binary fallback** — real architecture change; the health-check gate
  (defer + retry later) is the deliberate substitute.
- **A pull-based `GET /alerts` condition** for video-import (parallel to the new `AlertRule`) — the
  notifying `AlertRule` is the actionable surface; skipped to keep this pass bounded.
- **Storage-upload-failure classification** — `uploadObject()` failures stay generic/unclassified
  (default-retryable at the job level); that's `packages/storage`'s own concern.

## Manual verification (not exercisable in this environment)

- **Health-check gate**: temporarily rename/remove the `yt-dlp` binary (or point `YTDLP_PATH` at a
  nonexistent path) and confirm a queued import fails fast with `category: internal` and no
  subprocess spawn, then recovers automatically once the binary is restored and the job-level
  backoff fires the next attempt.
- **Disk category**: fill the `VIDEO_IMPORT_SCRATCH_DIR` volume (or point it at a read-only/
  zero-quota path) and confirm the import fails with `category: disk`, not an unclassified error.
- **Real geo/age/auth-restricted videos**: run an import against a known age-restricted, known
  geo-blocked, and known private video, and confirm the resulting `VideoStatusEvent.errorMessage`/
  logs show the expected category — this is the step that would catch a wrong regex the way the
  original `unavailable` bug was caught (see `categorizeExitFailure`'s own comment).
- **Worker crash recovery**: kill the worker process mid-download (`kill -9` / task manager) and
  confirm BullMQ's stalled-job recovery + `IMPORT_YOUTUBE_RETRY_OPTIONS` together resume the import
  without a duplicate `Video` row, duplicate storage object, or duplicate notification.
