export interface AnalyticsTooltipRow {
  label: string;
  value: string;
}

export interface AnalyticsTooltipProps {
  active?: boolean;
  title?: string;
  rows: AnalyticsTooltipRow[];
}

// Sprint 6C.5 (Analytics UI Foundation) - the dark-theme tooltip card
// Sprint 6B's TrendChart first built inline (as a private `TrendTooltip`).
// Generalized here so AnalyticsLineChart/AnalyticsBarChart can both use it -
// each chart wrapper adapts Recharts' own payload shape into
// `AnalyticsTooltipRow[]` via a `tooltipFormatter` prop, so this component
// itself has no Recharts-specific knowledge.
export function AnalyticsTooltip({ active, title, rows }: AnalyticsTooltipProps) {
  if (!active || rows.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-popover p-2 font-mono text-xs text-popover-foreground shadow-lg">
      {title ? <p className="text-muted-foreground">{title}</p> : null}
      {rows.map((row) => (
        <p key={row.label} className="mt-1 first:mt-0">
          {row.label}: <span className="text-foreground">{row.value}</span>
        </p>
      ))}
    </div>
  );
}
