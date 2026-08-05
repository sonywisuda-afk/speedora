# Database

PostgreSQL via Prisma (`packages/database`), the single source of truth for job/pipeline state —
Redis never persists anything durable. Used by both `apps/api` and `apps/worker`; see `prisma.md`
for client-usage conventions.

## Core models (`packages/database/prisma/schema.prisma`)

- **`User`** — email/password auth.
- **`Video`** — one uploaded/imported video. `status` (state machine, see `architecture.md`),
  `transcribeProgress`/`importProgress` (real-time progress checkpoints), `sourceUrl`/
  `importSourceUrl` (object key / original YouTube URL), `transcriptionProvider`
  (`GROQ`/`OPENAI`), `thumbnailUrl` (Product Experience roadmap — object storage key for a single
  extracted frame, WebP as of Phase 2/`.jpg` for pre-Phase-2 rows never backfilled, set best-effort
  by `transcribe.worker.ts`; never exposed to the client as this raw key, see `backend.md`'s
  `GET /videos/:id/thumbnail`), `thumbnailBlurDataUrl` (Phase 2 — a tiny base64 blur-placeholder
  data URL, inlined directly in the DTO rather than behind its own endpoint like the full
  thumbnail), `storyboardFrameUrls` (Phase 3, `Json?` — object storage keys for N evenly-spaced
  frames, one per independently-best-effort extraction; a real, possibly-short array of whichever
  frames actually succeeded, never a fabricated fixed-N shape), `animatedThumbnailUrl` (Phase 3 —
  object storage key for a short, muted, looping WebP, same best-effort/never-exposed-as-raw-key
  treatment as `thumbnailUrl`), `hoverPreviewUrl` (Phase 3 — same `extractAnimatedPreview()`
  primitive as `animatedThumbnailUrl`, a longer/smoother config and a genuinely separate column
  since it's fetched by the frontend on-demand only on hover/focus, not always shown - see
  `frontend.md`'s `lib/useHoverPreview.ts`).
- **`TranscriptSegment`** — per-video (not duplicated per-clip); a clip's transcript is derived by
  querying segments within its `startTime`/`endTime` range (`filterSegmentsForClip`, `packages/
  shared`). Carries `words` (word-level timestamps), `speaker` (Diarization label), `emotion`
  (Vocal Emotion label), `rmsDb`/`peakDb`/`speakingRateWordsPerSecond` (Audio Intelligence) — see
  `ai/audio.md`.
- **`Clip`** — one candidate/rendered clip. `startTime`/`endTime`/`outputUrl`/`captionStyle`/
  `hookText`/`hashtags`/`emojiSuggestions` from the MVP+early phases, `thumbnailUrl`/
  `thumbnailBlurDataUrl`, `storyboardFrameUrls`, `animatedThumbnailUrl`, `hoverPreviewUrl` (Product
  Experience roadmap — same treatment as `Video`'s own columns above, but extracted from the RENDERED output
  by `render-clip.worker.ts` instead of the source), plus a large set of AI
  Intelligence columns (see below) and Fusion Engine output
  (`highlightScore`/`highlightConfidence`/`highlightBreakdown`/`highlightExplainability`/
  `highlightPrediction`/`highlightRecommendation`/`highlightRank`).
- **`VideoStatusEvent`** — append-only audit trail of every `Video.status` transition (`toStatus`,
  `errorMessage`, `createdAt`; no `fromStatus` — transitions are always sequential per video, so
  the prior status is just the previous row). Written exclusively through `@speedora/database`'s
  `updateVideoStatus()`/`recordVideoStatusEvent()`.
- **`ActivityEvent`** — the Dashboard's user-facing Activity Timeline (`GET /dashboard/activity`,
  see `backend.md`), a coarser feed than `VideoStatusEvent` above ("Video uploaded", "Clip
  generated", ...) written from a handful of call sites (`VideosService`, `render-clip.worker.ts`,
  `ClipsController`'s download route, `WorkspaceService`'s invite/delete routes) via
  `recordActivityEvent()`. `userId`-scoped only — no `workspaceId` column, so this is never shared
  across a workspace's members even when the event itself (e.g. `WORKSPACE_DELETED`) was workspace-
  flavored. `videoId`/`clipId` are plain nullable strings, not real relations, and `metadata` is
  loose `Json?` — both deliberately survive the referenced video/clip/workspace being deleted later,
  so a history entry never blanks itself out. Activity Timeline v2 added `title`/`description`
  (both nullable `String?`, no `NOT NULL`/backfill requirement): denormalized *at write time* inside
  `recordActivityEvent()` itself from `type`+`metadata`, via a new `packages/shared` pure function
  (`describeActivityEvent`), specifically so `GET /dashboard/activity?q=` has real text to
  `contains`-search against — the Indonesian display sentence ("Video diunggah: X") previously only
  ever existed client-side, computed at render time, so there was nothing for Postgres to search
  before this. A not-yet-backfilled pre-migration row (both columns `NULL`) simply never matches a
  search — the correct degrade, not a bug; `apps/api/src/scripts/backfill-activity-event-
  descriptions.ts` is the one-off, idempotent (`where: { title: null }`) script that backfills
  existing rows, run once after the migration deploys.
- **`ActivityDeletionLog`** (Activity Timeline v2) — a narrow, **internal-only** traceability trail
  (no DTO, no controller route — Prisma Studio/future admin tooling only) for a user deleting their
  own `ActivityEvent` history via `DELETE /dashboard/activity`/`DELETE /dashboard/activity/all` (see
  `backend.md`). `userId` + `action` (`ActivityDeletionAction`: `DELETE_SELECTED`/`DELETE_ALL`) +
  `deletedIds` (`Json?`, set only for `DELETE_SELECTED`, always `null` for `DELETE_ALL` since
  `count` already captures the magnitude) + `count` + `createdAt`. Deliberately a fourth, separate
  audit-adjacent model rather than reusing `AuditLogEntry` (which requires `workspaceId` and doesn't
  fit a per-user action) or a `deletedAt` soft-delete flag on `ActivityEvent` itself — there is no
  soft-delete precedent anywhere in this schema; every delete flow here (this one included) hard-
  deletes and writes a separate trail row instead. Written fire-and-forget, after the delete
  commits, via `recordActivityDeletionLog()`.
- **`SocialAccount`**, **`PublishRecord`**, **`PremiumCredit`** — see `backend.md`.
- **`PublishRecordStatsSnapshot`** — append-only, one row per `sync-publish-stats` run (same
  audit-trail shape as `VideoStatusEvent` above, no `fromValue`, always sequential). Added for
  Milestone 1 (Dataset & Feedback Loop, see `ai/dataset-feedback-loop.md`) to give `PublishRecord`'s
  view/like/comment counts an actual history — `PublishRecord`'s own columns remain a mutable
  "latest snapshot" and are untouched by this addition. Also carries `shareCount`,
  `watchTimeSeconds` (Instagram only today), and a heuristic `engagementScore`.
- **`QueueSnapshot`**, **`WorkerHeartbeatSnapshot`** — append-only, one row per queue/live worker
  heartbeat every 5 minutes, written by `apps/worker/src/workers/metrics-snapshot.worker.ts`
  (Production Metrics Collection, see `deployment.md`'s "Production Metrics Collection" section).
  Same shape as `PublishRecordStatsSnapshot` above (a `capturedAt`-indexed history sitting
  alongside live state that's queried elsewhere — `GET /queues`/`GET /workers/health` — rather than
  duplicating it). `QueueSnapshot.queueName` is a plain `String`, not a Prisma enum mirroring
  `packages/shared`'s `QueueName` — see the model's own schema comment for why that's a deliberate,
  scale-appropriate choice here rather than the usual Contract Governance "mirror it" rule (see
  `coding-standards.md`). Retention/pruning is explicitly not implemented yet — both tables grow
  unbounded until a pruning job exists.

## `Clip`'s AI Intelligence columns

Each AI signal generally has a raw timeline column (`Json?`, samples/events) and a derived
`*Features` summary column (`Json?`) — see `coding-standards.md` for the null/empty-array
conventions that distinguish "didn't run" from "ran, found nothing". One exception:
`editingRhythmFeatures` has no raw counterpart — it's a composite computed from other columns'
already-derived features, not a fresh detector.

| Signal | Raw column(s) | Derived column |
|---|---|---|
| Scene cuts | `sceneCuts` (`Float[]`), `sceneCutEvents` (`Json?`, fade/hard-cut classification) | `sceneFeatures` |
| Motion energy | `motionEnergy` (`Json`, always an array) | `motionEnergyFeatures` |
| Camera motion | `cameraMotion` (`Json?`) | `cameraMotionFeatures` |
| Editing rhythm | — (composite, no raw) | `editingRhythmFeatures` |
| Facial emotion | `facialEmotions` (`Json?`) | `facialFeatures` |
| Face landmarks (blink/smile/gaze/tracking/lip activity/affect) | `faceLandmarks` (`Json?`) | `faceLandmarkFeatures` |
| Face tracking telemetry (not a scoring signal) | — | `trackingQualityMetrics` |
| Gestures | `gestures` (`Json?`) | `gestureFeatures` |
| OCR | `ocrText` (`Json`, always an array) → `ocrTracks` (`Json?`, tracked+classified) | `ocrFeatures` |
| Audio (per-segment, on `TranscriptSegment`) | `rmsDb`/`peakDb`/`speakingRateWordsPerSecond` | `audioFeatures` (aggregated per-clip) |
| LLM (`ClipScores`, from `detect-clips`) | `scores` (Fase 8 output) | `llmFeatures` (the subset actually consumed by the Fusion Engine at render time) |

See `ai/vision.md`, `ai/audio.md`, `ai/ocr.md`, `ai/fusion.md` for what each module actually
computes.

## Retry inference (`VideosService.retry`)

No separate "which stage failed" marker — the retry logic infers the stage from what data already
exists, because `transcribe`/`detect-clips` each persist their output and advance `Video.status`
atomically in the same step; if a job's `catch` block ran, that stage's data was never written at
all:

- No `TranscriptSegment` rows yet → retry `transcribe`.
- Segments exist but no `Clip` rows → retry `detect-clips`.
- `Clip` rows exist but some lack `outputUrl` → retry `render-clip` **only** for those clips (each
  clip renders independently; one failing clip doesn't imply its siblings need retrying).
- `Video.sourceUrl === ''` with an `importSourceUrl` set → retry `import-youtube` instead (the
  import itself never completed).

## Migrations

Schema changes go through Prisma migrations (`prisma migrate dev`), never manual schema sync —
every migration in this project has been run against a real dev Postgres instance before being
considered done, not just written and assumed correct. Production applies the same migration via
`prisma migrate deploy` (see `operations-runbook.md`), never `dev`.

Activity Timeline v2's migration (`ActivityEvent.title`/`description`,
`ActivityDeletionAction`/`ActivityDeletionLog`) is a representative example of the additive-only
shape `migrate deploy` needs to stay non-blocking: two nullable columns (no `NOT NULL`, no
backfill-then-tighten two-step) and one brand-new table — no column drops, renames, or type changes
touching existing data. It was applied and verified against the local dev database, then backfilled
via `apps/api/src/scripts/backfill-activity-event-descriptions.ts`, before this PR was opened.
