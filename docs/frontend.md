# Frontend (`apps/web`)

Next.js + TypeScript. Talks to `apps/api` only over HTTP (`lib/api.ts`), never imports backend
code directly.

## Routes

- `/` — engine-choice screen (Groq vs. OpenAI Whisper, per-video not per-account — see
  `ai/llm.md`) then upload/YouTube-import + live `ProcessingStatus` for the just-submitted video.
- `/dashboard` — history of all videos owned by the user (`GET /videos`), Clip Gallery per video:
  inline preview (`clipStreamUrl`), download, publish-to-platform controls, hookText/hashtags,
  Content Intelligence panel (scores/reason/topics), links to Timeline Editor, OCR Review, and AI
  Explainability when applicable.
- `/videos/:id/edit` — Timeline Editor.
- `/videos/:id/ocr-review` — OCR dataset annotation tool (standalone, deliberately separate from
  the Timeline Editor — different workflow/audience).
- `/videos/:id/explainability` — AI Explainability (Milestone 4, standalone, same shell/auth-gate
  pattern as OCR Review). See its own section below.
- `/analytics` — Analytics Dashboard (Milestones 5A Overview + 5B Performance Analytics, top-level
  route, user-wide rather than per-video). See its own section below.
- `/accounts` — connected social accounts (connect/disconnect/reconnect).
- `/social` — (publish-adjacent UI, see `backend.md`'s Publish Center).

All routes gate on `lib/useAuth.ts` (`GET /auth/me`), not `localStorage` — session state always
reflects the server.

## Timeline Editor (`TimelineEditor.tsx`, `lib/timelineStore.ts`)

- **Preview**: `<video>` streaming the *source* (`GET /videos/:id/source`, Range-enabled,
  `crossOrigin="use-credentials"`) — not the rendered output — with a `<canvas>` overlay
  redrawn on `requestAnimationFrame` for captions. Deliberately **approximate**, not pixel-perfect
  vs. the libass burn-in (plain bold white text regardless of `captionStyle`) — building a shared
  style engine between canvas and FFmpeg's ASS renderer is out of scope.
- **Timeline**: absolutely-positioned/percentage `<div>`s (not SVG/canvas) for the clip track (drag
  handles for start/end) and a read-only caption track. Speaker-color-coded transcript strip
  (Diarization) and per-word emotion emoji tags (Vocal Emotion) — see `ai/audio.md`.
- **State**: Zustand (`lib/timelineStore.ts`) — clips + draft trim + per-clip dirty/saving/
  rendering flags, plus editable hookText/hashtags (uncontrolled `<input>`s, `key={clipId}` +
  `defaultValue` + commit on blur — a controlled value re-derived every keystroke would eat
  trailing spaces/commas).
- **Trim/caption-style edits do not auto-render** — `PATCH /clips/:id` only updates the DB; the
  user must click "Render" (`POST /clips/:id/render`) explicitly.
- **`VideoAnalysisDashboard.tsx`** sits above the editor — heatmap (opacity by `viralityScore`
  across clip time ranges, not a continuous per-second score), best-clip ranking, average score
  breakdown, topic/intent distribution — built entirely from data already on `TimelineClip`, no new
  API calls.

## Dashboard (`app/dashboard/page.tsx`, `components/dashboard/`)

Product Experience performance pass (target: <1s load) turned this from a fully client-rendered
page into a Server Component: `page.tsx` fetches auth + the first page of videos server-side
(`lib/api.server.ts`, forwarding the httpOnly `token` cookie via `next/headers` — the API has no
browser cookie jar to rely on server-side) so the first HTML response already contains real
content, not a loading spinner. `components/dashboard/DashboardClient.tsx` (client component)
takes it from there, seeded with that data via SWR's `fallbackData` instead of starting from
`null`. Stats/Activity (`DashboardSummary.tsx`, an async Server Component) are wrapped in their own
`<Suspense>` boundary in `page.tsx` so they stream in independently rather than blocking the video
list's first paint — see `app/dashboard/loading.tsx` for the route-level skeleton shown before
`page.tsx`'s own fetch resolves.

`GET /videos` is now cursor-paginated (`PaginatedVideos` in `packages/shared`, default page size
20) rather than unbounded — the previous unbounded query (every video/clip/publish record a user
ever created, on every 2s poll) was both the main load-time cost and a real scalability risk.
`DashboardClient.tsx` polls only page 1 via `useSWR` (2s while any video is non-terminal, paused
once everything's `RENDERED`/`FAILED`); additional pages loaded via "Load More" are appended to
separate, un-polled local state and merged for rendering (deduped by id). `RecentProjectsGrid.tsx`
switches from a plain CSS grid to a virtualized `react-window` `List` past 30 loaded videos (the
common case, one page, never hits this — see the component's own comment on why `react-window`'s
`Grid` doesn't fit this grid's responsive Tailwind breakpoints without tracking container width).
`ProcessingQueue.tsx`/`ActivityTimeline.tsx` extract memoized per-row components so a poll tick
that changes one video doesn't re-render every row.

Clip preview `<video>` uses `clipStreamUrl(clip.id)` → `GET /clips/:id/stream` (Range-enabled
inline stream), not `clipDownloadUrl` (attachment header, can't play in a `<video>` element). Video
and clip delete are both **optimistic** — the row disappears immediately on click; on a failed
request it re-fetches the real list (SWR's `mutate()`) rather than restoring a stale snapshot,
since a poll may have moved state in the meantime. "OCR Review" link appears only when at least one
clip has `ocrTracks`; "AI Explainability" link appears only when at least one clip has a non-null
`highlightScore`.

The "Invite Member" quick action (`InviteMemberDialog.tsx`, code-split via `next/dynamic` since
its Radix dialog content is only needed once clicked) now calls a real Server Action
(`app/dashboard/actions.ts`'s `inviteMemberAction`) instead of a browser `fetch` — chosen as the
one Server Action in this pass specifically because it's simple and self-contained; delete/publish/
schedule keep their existing hand-tuned optimistic client mutations rather than being redone as
Server Actions, since they aren't on the initial-load critical path.

## AI Explainability (`app/videos/[id]/explainability/page.tsx`, `components/explainability/`)

Milestone 4 — turns Fusion Engine v2's already-computed
`highlightScore`/`highlightConfidence`/`highlightBreakdown`/`highlightExplainability`/
`highlightReason`/`highlightPrediction`/`highlightRecommendation` into a user-facing view; nothing
in the render pipeline changed to build this. Two-tier data fetching: `getVideo(id)` once for the
clip list (already includes every `highlight*` field, cheap — feeds the timeline overview and the
initial clip selection), then `getClipExplainability(clipId)` lazily per selected clip (a real
`GET /clips/:id/explainability` round trip, not just re-reading the already-loaded video).

- `ExplainabilityTimeline.tsx` — heatmap-style bar across the video's duration, same
  percentage-positioned-button technique as `VideoAnalysisDashboard.tsx`'s virality heatmap, but
  colored Signal Cyan (not Signal Pink) and keyed on `highlightScore` — a deliberately different hue
  so it's never visually confused with the existing virality heatmap (`highlightScore` and
  `viralityScore` are two different systems, see `ai/scoring.md`). An unscored clip renders as a
  muted gray segment rather than being hidden.
- `ExplainabilityDetailPanel.tsx` — iterates `ClipExplainabilityDto.results` (today always exactly
  one `{ engine: 'v2' }` entry), rendering each as its own card: `ScoreGauge` (now accepting an
  optional `label` prop, defaulting to `"Virality score"` so every existing caller is unaffected)
  reused with `label="Highlight score"`, a confidence readout captioned with the "heuristic
  coverage+quality estimate, not a calibrated probability" caveat, the `highlightReason` text, a
  prediction-bucket badge (color+label, never color alone), the recommendation message, top
  explainability factors, and the signal breakdown chart. Designed to render a second card
  automatically once a future milestone adds a real `engine: 'v3'` entry — no redesign needed.
- `SignalBreakdownChart.tsx` — per-signal grouped bars via `lib/explainability.ts`'s
  `groupBreakdownBySignal()`. Bar width is each signal's *average `normalizedValue`* (0-100%, the
  signal's own raw strength) — deliberately not `weightedContribution` (a much smaller,
  weight-scaled number that would make a misleading bar). A weight-0 signal (collected by the Fusion
  Engine but not yet calibrated — see `ai/fusion.md`) renders muted with a "Belum dibobotkan" badge,
  not hidden.
- `lib/explainability.ts` — the pure, no-JSX logic above (`groupBreakdownBySignal`, `toPercent`,
  `formatConfidence`, `predictionBadge`, `sortTopFactors`), the only part of this feature covered by
  automated tests (`lib/explainability.spec.ts`) — see `jest.config.js`'s note on why this app's
  first test setup is scoped this narrowly rather than deciding a full component-testing stack.

## Analytics (`app/analytics/page.tsx`, `components/analytics/`)

A 3-stage Analytics Dashboard (5A Overview → 5B Performance Analytics → 5C AI Analytics, each a
separate milestone, all on the same `/analytics` page/route). User-wide, not per-video (unlike AI
Explainability above) — one page summarizing everything the logged-in user owns.

### Overview (Milestone 5A)

Single fetch on mount (`getAnalyticsOverview()` → `GET /analytics/overview`), no polling — this
data doesn't need live updates the way in-progress video processing does.

- `StatTile.tsx` — plain "big number + label" tile (Total Video/Total Klip/Klip Dipublikasikan/
  Rata-rata Engagement). Deliberately not a gauge or bar — a single KPI number's job is a headline,
  not a chart.
- `PlatformBreakdown.tsx` — bar-per-platform (YouTube/TikTok/Instagram), same percentage-width-bar
  technique as `VideoAnalysisDashboard.tsx`'s score bars.
- `ProcessingStatusBreakdown.tsx` — a `Badge` row per `Video.status` (color/tone by status — green
  for `RENDERED`, red for `FAILED`, muted for in-progress states), not a bar chart — 6 categories at
  typically low counts read better as labeled badges, same reasoning `VideoAnalysisDashboard.tsx`
  already uses for its topic/intent distribution.
- `UploadTrendChart.tsx` — a bar-per-day strip (30 bars, zero-filled), not a line chart. No charting
  library exists anywhere in this app (same finding as Milestone 4's page) — a hand-rolled SVG line
  would be meaningfully more complex than the bar techniques already used everywhere else here, and
  arguably less honest for sparse daily counts than bars (a line implies continuity a scatter of
  upload days doesn't have).
- `lib/analytics.ts` — the pure, no-JSX logic (`toBarPercent`, `PLATFORM_LABELS`,
  `videoStatusBadge`, `formatEngagementScore`, `formatShortDate`), tested via
  `lib/analytics.spec.ts` (reuses the `jest.config.js` scope Milestone 4 already set up — no changes
  needed there).

### Performance Analytics (Milestone 5B)

Re-fetches `getAnalyticsPerformance()`/`getAnalyticsPerformanceClips()`/
`getAnalyticsPerformanceVideos()` together whenever `DateRangeFilter.tsx`'s 7/30/90-day toggle
changes (a small button-group styled like `Nav.tsx`'s active-link state — no `Select` UI primitive
exists in this app). A deliberately light AI Performance Summary previews Milestone 5C rather than
replacing it (the user's own framing: "mulai menghubungkan analytics dengan explainability").

- `TopClipsTable.tsx` / `TopVideosTable.tsx` — plain semantic `<table>`s (no `Table` UI primitive
  exists yet). Sorting is client-side (`lib/performance.ts`'s `sortByNumericField`, nulls always
  last) — the API already returns rows sorted by engagement score descending, and clicking a column
  header re-sorts the already-fetched rows without a network round trip. `TopClipsTable` rows are
  one per publish record (a clip published to two platforms gets two rows, since
  platform/views/likes/shares are properties of the publish, not the clip).
- `ClipThumbnail.tsx` — reuses `ClipCard.tsx`'s exact "no frame-extraction exists in this backend
  yet" honest-placeholder convention (a neutral SVG data URI, not a fake preview), at table-row size,
  rendered via CSS `backgroundImage` the same way `LiveReel.tsx` already renders its own thumbnail
  frames (no `<img>`/`next/image` usage exists anywhere else in this app).
- `EngagementTrendChart.tsx` — extends `UploadTrendChart.tsx`'s bar-per-day technique: `totalViews`
  is the bar height (the primary series), `publishCount`/`averageEngagementScore` ride along in the
  hover tooltip rather than competing for their own bar height in the same strip.
- `PlatformComparisonTable.tsx` — always renders all 3 platforms, even at 0 publishes — a comparison
  table with a row missing isn't a comparison. `growthPct` (percent change vs. the immediately
  preceding period of equal length) is colored green/red by sign and shows an honest "Tidak ada
  data" label, never a fabricated 0%, when there's no prior-period baseline.
- `AiPerformanceSummary.tsx` — `StatTile`s for average highlight score/confidence (reusing Milestone
  4's `formatConfidence()` and its "heuristic, not calibrated" honesty), a `Badge` row for the
  most-common Fusion Engine signals (a real frequency count across the window's clips), and a short
  list of the top 5 highest-`highlightScore` clips' `highlightReason` text (not a frequency count —
  `highlightReason` is a free-text sentence per clip, so "most common reason" isn't a meaningful
  aggregate the way "most common signal" is). Milestone 5C-A adds a Highlight Score Distribution and
  a per-signal Contribution % section, both reusing `components/ops-ai/HistogramBars.tsx`/
  `SignalContributionChart.tsx` (the same components `/ops/ai` uses) — the inline confidence-bucket
  bar JSX this component originally had was generalized into `HistogramBars.tsx` once a second
  histogram (score) needed the identical treatment.
- `lib/performance.ts` — the pure, no-JSX logic (`DAY_RANGE_OPTIONS`, `sortByNumericField`,
  `formatGrowthPct`, `formatPublishDate`), tested via `lib/performance.spec.ts` (same
  `jest.config.js` scope, still no changes needed there).

## AI Operations Dashboard (`app/ops/ai/page.tsx`, `components/ops-ai/`)

Milestone 5C-B — a separate page from `/analytics` on purpose (per the user's own explicit
architectural rationale): this page answers "is the AI model healthy?" using data pooled across
*every* user's clips, `/analytics` answers "how did my content perform?" using only the signed-in
user's own. The server-side boundary (`RolesGuard`, `ADMIN`/`AI_ENGINEER`/`OPERATOR` only) is what
actually protects this data — `Nav.tsx` only conditionally *shows* the "AI Ops" link when
`user.role !== 'CREATOR'`, which is UX polish, not the security mechanism. On a 403 the page shows
a plain "restricted to AI Ops roles" message (detected by matching the thrown error's message
text — `apiFetch`'s callers don't otherwise expose the HTTP status code) rather than a generic error.

Fetches all 7 `/ops/ai/*` endpoints together on mount (no filters — an all-time snapshot, matching
Milestone 1.5's own scripts having no time filter either) and renders one card per section:

- `AiHealthPanel.tsx` — `StatTile`s for the AI Health numbers (reuses `components/analytics/StatTile.tsx`).
- `SignalContributionChart.tsx` — the Signal Analytics bar chart (the user's own stated
  most-important section), reused as-is by Milestone 5C-A's owner-scoped `AiPerformanceSummary`
  above. Uses `lib/ops-ai.ts`'s `signalLabel()` (`facial` → "Emotion", matching
  `packages/contracts/src/fusion-ml.ts`'s `FUSION_V2_TO_V3_SIGNAL_MAP` rename, display-only) rather
  than raw signal keys.
- `ExplainabilityReasonsList.tsx` — aggregated `topFactors[].description` frequency (e.g. "High
  Emotion" × 42, 18%).
- `HistogramBars.tsx` — the shared score/confidence histogram bars (see above).
- `FeatureCompletenessTable.tsx` / `FeatureDistributionTable.tsx` — Milestone 1.5's Missing Data
  Report / Feature Distribution, in a web UI for the first time.
- `CorrelationPanel.tsx` / `CalibrationTable.tsx` — Milestone 1.5's Correlation Dashboard / Weight
  Calibration Report. Both show an honest "not enough samples yet" state below
  `MIN_SAMPLES_FOR_CORRELATION` — never a fabricated number, per explicit instruction.
- `DriftTable.tsx` — Milestone 1.5's Feature Drift Detection.
- `ReadinessPanel.tsx` — new: a `ready`/`blockers[]` verdict for "is there enough data for Milestone
  2C (Baseline ML Training) yet?"
- `lib/ops-ai.ts` — `signalLabel()`, `formatPct()`, `toBarPercent()`, tested via `lib/ops-ai.spec.ts`.

## OCR Review (`components/OcrReviewer.tsx`)

Standalone annotation UI for building an OCR classifier evaluation dataset (see `ai/ocr.md`).
Local `useState`, not a shared store — no cross-page persistence needed. Shares the `<video>` +
`<canvas>` overlay pattern with the Timeline Editor (bounding boxes normalized against the source
frame dimensions, drawn on a stretched-to-16:9 canvas). Review progress lives in `localStorage`
(`speedora:ocr-review:<videoId>`) — this is internal tooling, not an end-user feature, so no
backend persistence. Keyboard-driven for throughput: `1`–`6` selects a pending category, `Enter`
commits + advances to the next unreviewed track (auto-seeking the video to that track's start
time), `Shift+Enter` navigates back without committing. "Export JSON" produces a file matching
`@speedora/contracts`'s `ocrLabeledTrackSchema`, consumable directly by
`apps/worker`'s `pnpm evaluate:ocr` CLI (see `ai/ocr.md`, `testing.md`).

## Processing status UX (`components/processing/ProcessingStatus.tsx`)

Progress bar spans all three visible stages (Transcribe/Auto-Clip/Render), filled by real
checkpoints:

- Transcribe: `video.transcribeProgress`.
- Render & Caption: fraction of `video.clips` with `downloadUrl !== null` (already in the polled
  `GET /videos` payload — no new endpoint needed).
- A standalone IMPORTING screen (separate 0–99 range, not part of the 3-stage bar) shows
  `video.importProgress`, real yt-dlp download percentage.

On top of real checkpoints, a "creep" animation nudges the displayed percentage +1%/second toward
the current stage's ceiling while waiting for the next real checkpoint — capped so it can never
cross a stage boundary itself; only an actual status change unlocks the next stage. This is a
deliberate, narrow exception to the "never fabricate progress" principle applied to the raw
progress values elsewhere in the codebase (see `coding-standards.md`) — it only smooths perceived
motion between two already-real data points, it never invents a stage completion.

## Global UI polish

Every interactive control (`<button>`, `role="button"`, `<a>`, the styled `Button` component
including `asChild`) gets a universal pressed-state visual (scale-down + brightness/color pop) —
a global base-layer CSS rule (`app/globals.css`) for raw elements, complemented by `active:*`
Tailwind classes per `Button` variant for variant-specific color shifts.
