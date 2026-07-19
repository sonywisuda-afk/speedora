# Analytics UI Foundation

Thin wrappers over Recharts, established in Sprint 6C.5. The goal is one
consistent look/behavior across every analytics chart, without a big
abstraction (no chart-type registry, no factory). Every new analytics chart
should be built from these pieces instead of importing Recharts directly.

## When to use which chart

- **`AnalyticsLineChart`** — a measure changing over time (trend, history).
  One line per series. Use when the x-axis is a date/period.
  Example: `TrendChart` (views/engagement over Daily/Weekly/Monthly/Yearly).
- **`AnalyticsBarChart`** — a measure across categories, especially ranked
  lists. `layout="vertical"` (Recharts' own naming) draws horizontal bars —
  the right shape for a leaderboard. `layout="horizontal"` (the default)
  draws upright bars — use for a small category comparison instead.
  Example: `LeaderboardBarPanel` (Top Clip/Creator/Campaign/Platform).
- **Anything else** (a single KPI number, a status breakdown, a heatmap
  grid) — these aren't Recharts line/bar charts. Follow the dataviz skill's
  form heuristic to pick the right shape; a bar/line chart isn't always the
  answer.

## The supporting pieces

- **`AnalyticsCard`** — the Card/CardHeader (title + optional right-aligned
  controls)/CardContent shell every panel uses. Use it for any analytics
  panel, chart or not.
- **`AnalyticsChartContainer`** — the fixed-height `ResponsiveContainer` +
  empty-state branch. `AnalyticsLineChart`/`AnalyticsBarChart` already use
  this internally — only reach for it directly if building a genuinely new
  chart type this foundation doesn't cover yet.
- **`AnalyticsTooltip`** — the dark-theme tooltip card. Both chart wrappers
  take a `tooltipFormatter: (point: T) => AnalyticsTooltipRow[]` prop that
  feeds this - keep formatters small (2-4 rows), not a data dump.
- **`AnalyticsLegend`** — renders nothing below 2 entries (a single series
  is already named by the panel title, per the dataviz skill - no legend
  box needed). Not used by any chart yet; adopt it the moment a chart needs
  2+ series with distinct colors.
- **`AnalyticsEmptyState`** / **`AnalyticsLoadingState`** — the "Belum ada
  data" / "Memuat..." text treatments. Both chart wrappers already handle
  empty state via `isEmpty`/`emptyMessage` - use these two directly only
  outside a chart (e.g. a table with no rows).

## Color

- Single-series charts default to this app's established primary-metric
  color (signal-cyan, `#22E6D6`) — don't pass a color unless you have a
  reason to.
- Multi-series charts must set `color` explicitly per series. Neither chart
  wrapper auto-cycles hues — this app only has 2 named brand colors
  (signal-cyan, signal-pink) today, not a validated categorical palette. If
  a chart genuinely needs 3+ distinct series colors, that's a real need for
  a fixed, colorblind-safe categorical order — run it through the dataviz
  skill's `validate_palette.js` before picking hues, don't guess.

## Tooltip

Every chart gets a hover tooltip by default (`AnalyticsTooltip`, wired in
automatically) - this isn't optional per chart. Keep `tooltipFormatter`
rows short: a label + a formatted value, plus at most one line of context
(e.g. `secondaryLabel` on a `LeaderboardRow`).

## What NOT to do (yet)

Don't add stacked mode, dual axis, brush/zoom, reference lines, or
cross-chart sync until a sprint genuinely needs one. A dual-axis chart in
particular is close to a hard "don't" — see the dataviz skill's
anti-patterns. Extend a wrapper's props when a real caller needs it, not
speculatively.
