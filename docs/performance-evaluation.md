# Performance Evaluation (Stabilization Pass, Area 5)

A one-time evidence-backed audit of whether the Sprint 6A-6K analytics stack holds up as data
volume grows past dev-environment scale, run 2026-07-19 as the last area of the post-Sprint-6A-6K
Stabilization Pass (see `CLAUDE.md`'s Status section and Areas 1-4). Every number below is real -
either a real `EXPLAIN ANALYZE` at seeded scale, a real production build, or an explicit
code-reasoned estimate labeled as such - not a guess. Nothing here was fixed as part of this pass;
findings are recorded as backlog `TODO` comments at their exact locations (see each section) and
summarized here so they aren't lost.

## 1-2. Query plans and indexes

Seeded 500 clips/publish records, 35,000 `PublishRecordStatsSnapshot` rows, 10,000
`TrackedLinkClick` rows, and 30 `SocialAccountFollowerSnapshot` rows directly against the dev
Postgres instance, ran real `EXPLAIN ANALYZE` against the actual queries below, then fully cleaned
up (verified zero leftover rows, pre-existing dev data untouched).

Indexes on `PublishRecordStatsSnapshot` (`[publishRecordId, capturedAt]`),
`SocialAccountFollowerSnapshot` (`[socialAccountId, capturedAt]`), `TrackedLink` (unique `slug`,
plus `workspaceId`/`publishRecordId`/`campaignId`), `TrackedLinkClick`
(`[trackedLinkId, clickedAt]`), `PublishRecord` (`clipId`/`socialAccountId`/`[status,
scheduledAt]`/`campaignId`), `Clip` (`videoId`), and `Video` (`ownerId`/`workspaceId`) all matched
how they're actually queried - no missing index found on any hot path.

| Endpoint | Query shape | Plan | Time at seeded scale |
|---|---|---|---|
| `AnalyticsService.getOverview` snapshot fetch | owner→video→clip→publishRecord→snapshot, **no bound** | Index Scan throughout | 5,000 rows: 16ms → 35,000 rows: **64ms** (near-linear) |
| `WorkspaceAnalyticsService.getLeaderboard` | status + publishedAt window + workspace join, `take 500` | Index Scan throughout | 4.6ms |
| `ClipsService.getPerformance` historical records (Insight/Prediction) | status + clipId≠ + owner, `take 500` | Index Scan throughout | 4.1ms |
| `RedirectService` slug lookup | unique `TrackedLink.slug` | Seq Scan at 5 rows (planner correctly prefers it below a few dozen rows; the unique index is present and will engage automatically at real scale) | 0.07ms |
| `TrackedLinkClick` recent-click lookback | `[trackedLinkId, clickedAt]` | Index Scan | 0.19ms |

**Finding**: `AnalyticsService.getOverview`'s `publishRecordStatsSnapshot.findMany` has no
`capturedAt`-window bound, unlike its siblings `getFollowers`/`getHeatmap` in the same file, which
both correctly scope to `capturedAt >= windowStart`. It fetches an owner's *entire* snapshot
history on every Overview page load just to average one `engagementScore`. Confirmed scaling
near-linearly with row count; fine today, a real and growing cost once an owner has a year+ of
published records synced every 6h. See the `TODO` at `apps/api/src/analytics/analytics.service.ts`
(the `getOverview` snapshot query) - the fix is the same `capturedAt: { gte: windowStart }` bound
the sibling endpoints already use, not applied here.

No N+1s found anywhere: `CampaignsService.getAnalytics`, `getLeaderboard`, `getFollowers`, and
`ClipsService.getPerformance` all use Prisma's single-query nested-include/select pattern, each
already bounded by `take` where growth is possible. `getOverview`'s gap above is an unbounded-query
scale risk, not a per-row-query N+1.

## 3. Worker throughput

Neither `sync-publish-stats.worker.ts` nor `sync-follower-count.worker.ts` sets BullMQ
`concurrency` on their `new Worker(...)` call, unlike `detect-clips.worker.ts`/
`import-youtube.worker.ts`/`render-clip.worker.ts`/`transcribe.worker.ts` (all pin `concurrency:
1`) - moot for these two either way, since each is one self-contained repeatable job, not
fan-out-per-record. The real bottleneck is the in-job `for` loop over every matching
record/account: fully sequential, no `Promise.all`/batching, one real outbound platform API call
awaited per iteration.

**Finding**: both workers wrap every record/account in a try/catch that never rethrows, so the
BullMQ job itself always "succeeds" regardless of how many individual syncs failed - there is no
BullMQ-level retry for a failed sync, and no backoff/circuit-breaker/alerting after N consecutive
failures on the same record. A permanently broken account (revoked token) is silently re-attempted
every 6h/24h forever with no escalation. See the matching `TODO`s in both worker files. Not fixed.

No overlap risk from the repeating trigger itself (a slow run just delays the next tick's job
behind it, given unset/default concurrency of 1 - doesn't double-process), but there's also no
monitoring for "this run took longer than the interval," so freshness would degrade silently
rather than loudly if it ever happened.

Scale estimate (code-reasoned, not measured - a live timing test wasn't safe to run against the
already-running dev worker process without disrupting it): at realistic external-API latency
(200ms-1s+, worse under platform rate limits), a purely sequential loop over N records costs
roughly N × per-call time; within `sync-publish-stats`'s 6h window that's a rough ceiling near
~72,000 records before a run could still be mid-flight at the next tick. Today's volume is nowhere
near this. If it's ever approached, the fix is straightforward (bounded concurrent batches, or
per-record BullMQ jobs instead of one big loop).

## 4. Redirect latency

Traced `RedirectService.recordClickAndResolve` (`apps/api/src/tracked-links/redirect.service.ts`)
operation by operation:

1. `prisma.trackedLink.findUnique({ where: { slug } })` - 1 Postgres round trip, backed by a real
   unique index.
2. `ClickDedupService.isFirstOccurrence()` - 1 Redis round trip (`SET ... EX 5 NX`), O(1).
3. `isBotUserAgent()` - pure in-memory substring match, no I/O.
4. Only on a first (non-deduped) occurrence: one `$transaction` (click insert, plus a
   `clickCount` increment only if non-bot) - one more Postgres round trip.

Worst case is 2 local-infrastructure round trips plus negligible CPU - no N+1, no external call, no
dependency on table size (both the slug lookup and the Redis `SET` are O(log n)/O(1)). A live
end-to-end timing test wasn't completed (inserting a throwaway `TrackedLink` directly was correctly
blocked as an unreviewed write against real dev data rather than a session fixture) but the
operation count alone supports "very lightweight" without needing a stopwatch to prove it.

## 5. Frontend bundle (Recharts)

Ran a real `pnpm --filter @speedora/web build`. The 3 chart-foundation files
(`AnalyticsLineChart.tsx`/`AnalyticsBarChart.tsx`/`AnalyticsChartContainer.tsx`) import `recharts`
as a plain static `import` - no `next/dynamic`, no `React.lazy` anywhere, and
`@next/bundle-analyzer` isn't configured. Real build output (First Load JS, kB):

| Route | Size | First Load JS |
|---|---|---|
| `/` | 43.3 | 150 |
| `/accounts` | 2.49 | 145 |
| `/calendar` | 3.59 | 146 |
| `/campaigns` | 2.48 | 145 |
| `/dashboard` | 17.7 | 160 |
| `/upload` | 11.2 | 153 |
| `/videos/[id]/edit` | 8.77 | 156 |
| `/videos/[id]/performance` | 3.77 | 179 |
| `/analytics` | 7.83 | **286** |
| `/campaigns/[id]` | 5.79 | **253** |
| `/leaderboard` | 10.0 | **252** |
| Shared by all routes | - | 87.5 |

**No leakage - confirmed via grep, not assumed.** `recharts` appears only inside the
analytics-route-specific chunks (one of them, the real Recharts+D3-shape payload, is ~356 kB raw);
grepping the two shared-baseline chunks directly returns zero matches in both. Non-chart routes
cluster at 145-160 kB; chart routes jump to 252-286 kB - a page-local cost paid only by the pages
that use it, not a tax on the rest of the app. Next.js's own per-route App Router code splitting is
already doing this correctly with zero explicit `dynamic()` effort from anyone. No action needed.

(Unrelated, out of scope: `/videos/[id]/performance` is 179 kB despite no Recharts import
anywhere in it - confirmed via grep, the only "Analytics" hit there is a code comment. Slightly
heavier than its non-chart siblings for some other reason. Not investigated further.)

## 6. N+1 risk at scale

Covered under §1-2 above - explicitly checked as part of the same query-plan pass. None found in
campaign analytics, followers, leaderboard, or prediction; each already uses Prisma's batched
nested-include/select pattern with a `take` bound. `getOverview`'s unbounded query is the one real
scale risk in this whole audit, and it's a missing bound, not a per-row loop.

## Overall verdict

Indexes: correct. N+1s: none. Redirect path: lightweight by construction. Frontend bundle:
correctly scoped to the pages that need it. Two real findings, both recorded as `TODO`s rather than
fixed in this pass: `getOverview`'s unbounded snapshot query, and the two sync workers' silent
no-retry/no-alerting failure mode. Both are genuine technical debt worth scheduling, neither blocks
calling the analytics module production-ready as-is.
