# Backend (`apps/api`)

NestJS REST API. Never runs Whisper/FFmpeg synchronously in a request — all heavy work is
delegated to `apps/worker` via BullMQ. See `architecture.md` for the overall pipeline and
`queue.md` for job orchestration. This doc's endpoint list predates Sprint 6A-6K — see
`analytics-architecture.md`, `conversion-architecture.md`, and `capability-matrix.md` for the
flow-level view of the routes added since (`/analytics/heatmap`, `/analytics/followers`,
`/clips/:id/performance`, `/campaigns/:id/analytics`, `/workspaces/:id/analytics/*`, `/r/:slug`),
not yet backfilled below.

## Modules

- **Auth** (`src/auth`) — email + password + JWT in an httpOnly cookie. `POST /auth/register`
  (bcrypt hash, auto-login), `POST /auth/login` (rate-limited: 5 attempts/60s/IP via
  `@nestjs/throttler`, `ThrottlerGuard` applied only to this route, in-memory not Redis-backed),
  `POST /auth/logout`, `GET /auth/me`. `JwtStrategy` reads the `token` cookie, not an
  `Authorization` header. `JwtStrategy.validate()` does a full `prisma.user.findUnique()` per
  request, so the `role` it attaches to `request.user` (Milestone 5C-B, see `UserRole` in
  `schema.prisma`: `CREATOR`/`ADMIN`/`AI_ENGINEER`/`OPERATOR`) is always live — a role change takes
  effect on the very next request, no re-login needed. `RolesGuard` (`src/auth/guards/`) +
  `@Roles(...)` (`src/auth/decorators/`) gate `OpsAiController` only; every other endpoint is
  untouched. No self-service role-elevation endpoint exists — that would itself be a
  privilege-escalation hole. Grant a role via
  `cd apps/api && npx ts-node -T src/scripts/grant-role.ts user@example.com ADMIN`
  (`src/scripts/grant-role.ts`), see `docs/operations-runbook.md`.
- **Videos** (`src/videos`) — upload, YouTube import, status polling, transcript, source
  streaming, retry. `GET /videos` (Product Experience performance pass) is cursor-paginated —
  `?cursor`/`?limit` (clamped 1-50, default 20, same parse-don't-throw `parseLimit` convention as
  `AnalyticsController`/`DashboardController`), ordered `createdAt desc, id desc` for a stable
  tiebreak, returning `{ videos, nextCursor }` (`PaginatedVideos` in `packages/shared`) instead of
  every video a user has ever created — the previous unbounded query was the dashboard's main
  load-time cost. See `docs/frontend.md`'s Dashboard section for the client side (SSR first page,
  SWR polling, "Load More" for subsequent pages).
- **Clips** (`src/clips`) — trim/caption-style updates, render trigger, publish, download/stream,
  delete.
- **Social** (`src/social`) — OAuth connect/refresh/disconnect for YouTube/TikTok/Instagram.
- **Payments** (`src/payments`) — Midtrans Snap checkout + webhook for premium (OpenAI) Whisper
  credits.
- **Ops AI** (`src/ops-ai`) — Milestone 5C-B, `GET /ops/ai/{health,signals,distribution,
  correlation,calibration,drift,readiness}`. See "AI Operations Dashboard" below.

## Pagination convention

Stabilization Pass (API Contract Audit) resolution — an audit found the documented cursor
convention (`?cursor`/`?limit` clamped 1-50 default 20 → `{ items, nextCursor }`) was followed by
only 2 list endpoints (`GET /videos`, `GET /workspaces/:id/audit-log`) out of roughly 20, with the
rest split between three different ad-hoc `limit` ceilings and several fully unbounded `findMany`
calls. Rather than retrofit real cursor pagination onto every list (a frontend "load more" project
disproportionate to a stabilization pass), the resolved, honest two-tier convention is:

- **Cursor pagination** (`?cursor`/`?limit`, 1-50 clamped, default 20, → `{ <resource>, nextCursor }`
  — the wrapper key is the resource name, e.g. `videos`/`entries`, not a generic `items`) for the
  handful of genuinely high-cardinality, unbounded-growth lists: `GET /videos`,
  `GET /workspaces/:id/audit-log`, `GET /dashboard/activity` (Activity Timeline v2 — promoted out
  of the no-cursor tier below once the feed grew a real "Load More" UI plus search/type filters;
  wrapper key is `events`, see "Key endpoints" below). `GET /videos/:videoId/comments` is the next
  candidate if a video's comment count ever realistically approaches its new `take: 500` cap below.
- **A clamped `limit` query param, no cursor** (1-50, sensible per-endpoint default) for lists that
  are naturally small and browsed as a whole page, not paged through: `GET /notifications`,
  `GET /analytics/performance/{clips,videos}` (default 50 — a deliberately
  higher default than the 20 elsewhere, since these are analytics tables meant to be scanned, not a
  feed). `GET /workspaces/:workspaceId/analytics/leaderboard`'s 1-20 ceiling is a separate,
  deliberate product decision ("Top 10 or Top 20"), not part of this convention.
- **A hard `take` cap, no query param at all** for workspace-scoped management lists that are
  low-cardinality in practice (a handful to low hundreds of rows per workspace) but had no bound
  whatsoever before this pass: campaigns, recurring schedules, tracked links, workspaces-I'm-a-
  member-of, pending invites, projects, folders, share links, approvals, and clip versions/
  platform-copy history all now cap at `take: 200` (comments at `take: 500`, see above) as a
  stopgap against unbounded growth, not a real pagination UI. If any of these ever needs real
  paging, promote it to the cursor tier rather than raising the cap further.

## Ownership & security

`ownerId` for a video is always taken from `@CurrentUser()` (the JWT session), never from the
request body — there is no "create/act as any user by email" endpoint. `GET /videos/:id` and
`GET /clips/:id/download` return an identical 404 whether the resource doesn't exist or belongs to
another user, so IDs can't be probed. CORS is enabled explicitly with `credentials: true`
(`WEB_ORIGIN`) so the browser can send the session cookie cross-origin to a different port in dev.

## Boot-time guarantees

- `helmet()` is applied (CSP, HSTS, X-Frame-Options, etc.).
- `GET /health` (no auth, no rate limit) runs `SELECT 1` against Postgres, returns 503 if
  unreachable — for load balancers/orchestrators.
- Required env vars (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `STORAGE_*`) are validated
  synchronously at boot (`src/config/env.validation.ts`, via `ConfigModule.forRoot({ validate })`)
  — a missing required var fails fast at startup, not deep inside a request handler. Vars with a
  safe code default (`WEB_ORIGIN`, `API_PORT`, `JWT_EXPIRES_IN`) are not required. Optional
  integrations (`SENTRY_DSN`, `GOOGLE_OAUTH_CLIENT_ID`, `TOKEN_ENCRYPTION_KEY`,
  `MIDTRANS_SERVER_KEY`) are validated as optional — the rest of the app boots and works normally
  without them; only the feature that needs them 503s with a clear message when actually called.
- `SentryExceptionFilter` (`@Catch()` global, extends `BaseExceptionFilter`) reports only
  unexpected exceptions (non-`HttpException`, or `HttpException` with status ≥ 500) — normal
  control flow (`NotFoundException`, `BadRequestException`) is not reported. Only the exception
  object is sent to Sentry, never the request/response (which could carry a session cookie/JWT).
  Constructed with `app.get(HttpAdapterHost).httpAdapter` (the real adapter), not the
  `HttpAdapterHost` wrapper — `BaseExceptionFilter` calls methods directly on whatever it's given.

## Key endpoints

- `GET /videos`, `GET /videos/:id` (polled every 2s by the frontend while processing), `GET
  /videos/:id/transcript` (separate from `findOne` so the 2s poll doesn't drag transcript text
  along), `GET /videos/:id/source` (Range-enabled stream of the *source*, not rendered, video —
  used by the Timeline Editor's `<video>` preview), `GET /videos/:id/thumbnail` (Product Experience
  roadmap — a plain, non-Range stream of the extracted frame via `getObjectStream`, since it's
  a small static image, not something a `<video>` element seeks through; 404s if extraction hasn't
  succeeded yet, same "client checks thumbnailUrl for null" contract as every other optional field.
  Phase 2 (image optimization): `Content-Type` is derived from the stored key's own extension
  (`.webp` vs. pre-Phase-2 `.jpg` rows, never backfilled) rather than hardcoded, and the response
  carries this app's first `Cache-Control` header, `private, max-age=86400` — private since still
  JwtAuthGuard'd, a day rather than `immutable` since a retry can re-extract and overwrite the same
  key). Phase 3 adds `GET /videos/:id/animated-thumbnail` (same shape, for the looping WebP preview),
  `GET /videos/:id/hover-preview` (same shape again, for the longer/smoother preview the frontend
  only fetches on-demand on hover/focus intent — see `frontend.md`'s `lib/useHoverPreview.ts`), and
  `GET /videos/:id/storyboard/:index` (one endpoint per frame index rather than one bundling all
  frames, so each stays independently cacheable/lazy-loadable — `storyboardFrameUrls` in the DTO is
  already an array of these endpoint paths, not raw keys), `POST /videos`, `POST
  /videos/import-youtube`, `POST /videos/:id/retry`, `DELETE /videos/:id`.
- `PATCH /clips/:id` (trim/caption-style, no auto-render), `POST /clips/:id/render` (explicit
  re-render, clears `outputUrl` before enqueue), `GET /clips/:id/download` (attachment,
  `Content-Disposition`), `GET /clips/:id/stream` (Range-enabled inline playback — added because
  `:id/download`'s attachment header + lack of Range support meant the dashboard's `<video>`
  preview could never actually play), `GET /clips/:id/thumbnail` (Product Experience roadmap —
  same shape, same Phase 2 Content-Type/Cache-Control treatment, as the video thumbnail endpoint
  above, extracted from the RENDERED output by render-clip.worker.ts), `GET
  /clips/:id/animated-thumbnail`, `GET /clips/:id/hover-preview`, `GET /clips/:id/storyboard/:index`
  (Phase 3 — same shape/reasoning as their video-level counterparts above), `GET
  /clips/:id/explainability` (Milestone 4 — a focused,
  read-only view of a clip's Fusion Engine output: `highlightScore`/`highlightConfidence`/
  `highlightBreakdown`/`highlightExplainability`/`highlightReason`/`highlightPrediction`/
  `highlightRecommendation`/`highlightRank`, wrapped as `{ clipId, results: [{ engine: 'v2', ... }] }`
  so a future engine can add a second `results` entry without a contract change — these fields were
  already returned by `GET /videos`/`GET /videos/:id`, this endpoint just gives the frontend a
  focused single-clip read instead of re-fetching the whole video), `POST /clips/:id/publish`
  (optional `scheduledAt`), `DELETE`/`PATCH /clips/:id/publish/:recordId` (cancel/reschedule,
  `SCHEDULED` only).
- `GET /dashboard/activity` (Activity Timeline v2 — the dashboard's personal, per-user activity
  feed; `ActivityEvent` has no `workspaceId`, so this is never visible to or shared with other
  workspace members, unlike `GET /workspaces/:id/audit-log`). Cursor-paginated (see "Pagination
  convention" above — `?cursor`/`?limit`, 1-50 clamped, default 20), plus two optional filters:
  `?type=` (one of the real `ActivityEventType` values — `VIDEO_UPLOADED`/`CLIP_GENERATED`/
  `CLIP_EXPORTED`/`MEMBER_INVITED`/`WORKSPACE_DELETED`; an unrecognized value degrades to "no
  filter" rather than 400ing, same posture as `NotificationsV2Controller`'s own filter resolvers)
  and `?q=` (search, matched case-insensitively against the row's denormalized `title`/
  `description` — see `database.md`'s `ActivityEvent` entry for why those columns exist). Example:
  `GET /dashboard/activity?limit=20&type=CLIP_GENERATED&q=acme` → `{ events: [{ id, type, videoId,
  clipId, metadata, title, description, createdAt }, ...], nextCursor: "clxyz..." | null }`.
- `DELETE /dashboard/activity` (bulk-delete-by-ids) and `DELETE /dashboard/activity/all`
  (clear-all) — both `JwtAuthGuard`'d and scoped to `userId` from `@CurrentUser()` like every other
  endpoint in this module, so a caller can only ever delete their own activity history, never
  another user's. Both are **hard deletes** (`deleteMany`) — there is no soft-delete/`deletedAt`
  convention anywhere in this schema, see `database.md`. `DELETE /dashboard/activity` takes
  `{ ids: string[] }` in the body (1-or-many; an empty/missing array is a no-op, never an error)
  and returns `{ count: number }`; `DELETE /dashboard/activity/all` takes no body, deletes every
  one of the caller's rows, and also returns `{ count: number }`. Deliberately two separate, fully
  literal routes rather than "bulk-delete with an empty `ids` array means delete everything," so a
  client bug can never silently wipe a user's whole history — this route shape is also
  structurally immune to the wildcard-route-collision bug class `notifications.module.ts` hit
  (neither route has a dynamic `:id` segment for a sibling route to collide with). Every call is
  logged, fire-and-forget after the delete commits, to `ActivityDeletionLog` for internal
  traceability only (no DTO, no read endpoint) — see `database.md`.
- `GET /analytics/overview` (Milestone 5A — `AnalyticsModule`, ownership-scoped like every other
  endpoint here, never system-wide) — per-user totals (videos/clips/published clips), average
  engagement score (latest `PublishRecordStatsSnapshot` per publish record, averaged — `null`, not
  `0`, when no snapshot has a non-null `engagementScore` yet), a platform breakdown of published
  clips, a `Video.status` breakdown, and a zero-filled 30-day upload trend. Not modeled on
  `MonitoringModule` (unauthenticated, system-wide operational data) — this is per-user data and
  must never leak across users.
- `GET /analytics/performance`, `GET /analytics/performance/clips`, `GET /analytics/performance/videos` (Milestone 5B — same `AnalyticsModule`/ownership-scoping). All three accept `?days=7|30|90`
  (default 30, invalid values fall back to the default rather than 400ing) and `?platform=`
  (unrecognized values are ignored, not rejected); `/clips` additionally accepts `?videoId=` and
  `?limit=` (clamped to `[1,100]`). `/performance` bundles Engagement Trend (bucketed by *publish*
  date, not snapshot-capture date), Platform Comparison (always all 3 platforms, even at 0 —
  includes a `growthPct` vs. the immediately preceding period of equal length, `null` when there's
  no prior-period baseline), and a first, deliberately light AI Performance Summary (average
  highlight score/confidence, a 5-bucket confidence distribution, the top 5 highest-`highlightScore`
  clips' `highlightReason` text, and a real frequency count of which Fusion Engine signals appear
  most often in `highlightExplainability.topFactors` across the window's clips — a preview of
  Milestone 5C's deeper AI Analytics stage, not a replacement for it). `/clips` and `/videos` return
  rows sorted by engagement score descending by default; the frontend re-sorts client-side on
  column click rather than round-tripping per sort. `/clips` rows are one per `PublishRecord`
  (platform/views/likes/shares are properties of *a clip published to one platform*, not of the clip
  itself); `/videos` rows aggregate those same records per `Clip.videoId`. Milestone 5C-A adds two
  more `aiSummary` fields to `/performance`: `scoreDistribution` (10-bucket highlight-score
  histogram) and `signalContributions` (each Fusion Engine signal's share of the total
  `weightedContribution` mass across the window's clips — most signals read ~0% since they're still
  weight 0 pending calibration, which is the correct, honest read, not a bug). Both are still
  owner-scoped, same as everything else in `AnalyticsModule` — contrast with `/ops/ai` below, which
  computes the identical shapes system-wide via the same pure functions
  (`src/analytics/fusion-signal-analytics.util.ts`).
- `GET /ops/ai/health`, `GET /ops/ai/signals`, `GET /ops/ai/distribution`, `GET /ops/ai/correlation`,
  `GET /ops/ai/calibration`, `GET /ops/ai/drift`, `GET /ops/ai/readiness` (Milestone 5C-B —
  `OpsAiModule`, see "AI Operations Dashboard" below).
- `GET /social/accounts`, `GET /social/:platform/connect` (top-level `<a href>` navigation, not
  `fetch` — OAuth needs a real browser redirect), `GET /social/:platform/callback` (no
  `JwtAuthGuard` — trusts a signed short-lived `state` JWT instead of the session cookie, which may
  have expired mid-redirect).
- `POST /payments/premium-transcription/checkout`, `POST /payments/webhook/midtrans` (no
  `JwtAuthGuard` — server-to-server, trusted via HMAC signature + `crypto.timingSafeEqual`, not a
  session).

## AI Operations Dashboard

Milestone 5C-B. `OpsAiModule` (`src/ops-ai/`) is deliberately **not** `AnalyticsModule` — every
query is system-wide (no `ownerId` filter, mirroring `apps/worker/src/scripts/dataset-lib.ts`'s
`loadClipsWithFeatures`/`loadUsableSamples` query shape) rather than per-user, because this
surface answers "is the AI model healthy?" (an engineering question needing pooled data for
statistical power — `MIN_SAMPLES_FOR_CORRELATION`/`MIN_SAMPLES_FOR_TRAINING` floors are rarely
cleared by one user's clips alone) not "how did my content perform?" (`AnalyticsModule`'s domain).
Every route requires `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(ADMIN, AI_ENGINEER,
OPERATOR)` — a plain `CREATOR` gets a 403. Each of the 7 routes does its own independent Prisma
fetch (no shared request-scoped cache), same precedent as `MonitoringModule`'s
`/metrics`/`/queues`/`/workers`/etc.

Every response is wrapped `{ results: [{ engine: 'v2', ... }] }`, mirroring `ClipExplainabilityDto`'s
`results` array precedent (Milestone 4) — today always exactly one `v2` entry, so a future Fusion
Engine v3 comparison can append a second entry without a contract change.

- `GET /ops/ai/health` — total clips with a `highlightScore`, average confidence, low/high-
  confidence clip counts (heuristic thresholds 0.5/0.8, unvalidated), and a count of clips with a
  score but empty `explainability.topFactors` (a real pipeline gap).
- `GET /ops/ai/signals` — Signal Analytics (each signal's share of the total `weightedContribution`
  mass — see the M5C-A note above) plus Explainability Analytics (aggregated
  `topFactors[].description` frequency, e.g. "High Emotion" × 42).
- `GET /ops/ai/distribution` — highlight-score histogram (10 buckets of 10 pts), confidence
  histogram (reuses `AnalyticsModule`'s `computeConfidenceDistribution`), and Milestone 1.5's
  per-feature distribution table + Feature Completeness (missing-data report) — both surfaced in a
  web UI for the first time (previously only in `generate-dataset-report.ts`'s CLI output).
- `GET /ops/ai/correlation` — Milestone 1.5's Correlation Dashboard verbatim. Honest "not enough
  samples yet" below `MIN_SAMPLES_FOR_CORRELATION` (20) — never a fabricated number.
  `GET /ops/ai/calibration` — Milestone 1.5's Weight Calibration Report verbatim, same
  insufficient-data gating (derived from correlation). A heuristic *suggestion* for a human to
  review against `packages/fusion-engine/src/weights.ts`, never auto-applied.
- `GET /ops/ai/drift` — Milestone 1.5's Feature Drift Detection verbatim.
- `GET /ops/ai/readiness` — new in this milestone: "is there enough data to start Milestone 2C
  (Baseline ML Training)?" — usable-sample count vs. a new, explicitly heuristic
  `MIN_SAMPLES_FOR_TRAINING` (200, deliberately higher than the correlation floor and unvalidated
  pending real ML training experience), drift status, and feature-completeness status, rolled into
  `{ ready, blockers[] }`.

See `docs/ai/dataset-validation-calibration.md` for where the Milestone 1.5 logic behind
`distribution`/`correlation`/`calibration`/`drift` now lives (`packages/dataset-quality`) and
`docs/frontend.md` for the `/ops/ai` page these endpoints feed.

## Publish Center

`SocialAccount` (per-platform OAuth tokens, AES-256-GCM encrypted at the app level via
`TOKEN_ENCRYPTION_KEY`, portable across hosting providers) and `PublishRecord` (one row per publish
*attempt* — `QUEUED → PUBLISHING → PUBLISHED/FAILED`, or `SCHEDULED` first if `scheduledAt` is in
the future). Publishing itself runs in `apps/worker`'s `publish-clip` job (see `worker.md`);
`ClipsService.publish()` just creates the `PublishRecord` row and enqueues.

- **YouTube** — `google-auth-library`/`googleapis`, default `privacyStatus: 'unlisted'`. Title from
  `Clip.hookText`, description from `Clip.hashtags`.
- **TikTok** — "Upload to Inbox" (draft), not Direct Post — avoids the App Review gate for direct
  public posting. UI explicitly says "Sent to TikTok — open the app to finish posting", never
  "Published". Hand-rolled `fetch()` calls (no official Node SDK exists).
- **Instagram Reels** — Facebook Login + a linked Instagram Business/Creator account (not the newer
  Instagram Login flow). Video is handed to Meta via a **presigned URL** (`getPresignedDownloadUrl`,
  15-minute TTL) — Instagram's Content Publishing API has no byte-upload option, only "fetch from a
  public URL". This is the one place the app exposes anything resembling a direct bucket link.
  Container-create → poll status → publish (two API calls with async processing in between, unlike
  YouTube's one-shot `videos.insert`).
- **Scheduling** — a BullMQ *repeatable* job (`schedule-publish-clip.worker.ts`, polls Postgres
  every 60s) claims `SCHEDULED` rows atomically via `updateMany({ where: { status: SCHEDULED } })`
  and only enqueues `publish-clip` if exactly one row was updated — not a Redis delayed job, so
  losing Redis state only delays the next poll, never silently drops a scheduled publish.
- **Analytics** — `sync-publish-stats` (repeatable, every 6h) refreshes
  `PublishRecord.viewCount`/`likeCount`/`commentCount` (still a mutable "latest snapshot",
  overwritten in place — unchanged since Fase 6e) per platform via dedicated `*-stats.client.ts`
  files in `packages/social`. As of Milestone 1 (Dataset & Feedback Loop) the same job also inserts
  an append-only `PublishRecordStatsSnapshot` row on every run — this is the actual engagement
  *history* the Fusion Engine calibration/dataset-export scripts need, since `PublishRecord`'s own
  columns only ever hold the most recent number. TikTok and Instagram also report `shareCount`
  now; Instagram additionally reports `watchTimeSeconds` (average watch time per view — reachable
  under the already-granted `instagram_manage_insights` scope). YouTube watch-time/CTR and TikTok
  watch-time are **not** available — YouTube needs a separate, not-yet-added `yt-analytics.readonly`
  OAuth scope (would require existing users to reconnect and possibly a Google verification review),
  and TikTok's Content Posting API has no comparable endpoint at all. See
  `docs/ai/dataset-feedback-loop.md` for the full writeup, the `engagementScore` formula, and the
  `export-training-dataset.ts` script this feeds.

## Premium transcription payment gate

`PremiumCredit` (one row per Midtrans transaction, `PENDING/PAID/FAILED/EXPIRED`, `videoId`
nullable+unique — non-null means "consumed"). `POST /videos`/`/import-youtube` reject an
`OPENAI` provider request with 400 unless an unconsumed `PAID` credit exists, claimed atomically
(`updateMany` guarded on `videoId: null`); a race that loses the claim rolls back the just-created
video row (and its uploaded object, if any) rather than leaving it dangling without a credit. The
Midtrans webhook (HMAC-verified, idempotent via `updateMany` guarded on `status: PENDING`) is the
only source of truth for payment status — the client-side Snap.js callback only triggers a status
poll, never a trusted state change.
