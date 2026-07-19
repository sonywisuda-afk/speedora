export interface AnalyticsLegendEntry {
  label: string;
  color: string;
}

export interface AnalyticsLegendProps {
  entries: AnalyticsLegendEntry[];
}

// Sprint 6C.5 (Analytics UI Foundation). Per the dataviz skill: a single
// series needs no legend box (the panel title already names it) - this
// renders nothing below 2 entries rather than making every caller guard for
// that itself. Not used by any chart yet (today's charts are all
// single-series) - the contract exists ahead of the first multi-series
// chart (e.g. a future Platform Comparison rebuilt on AnalyticsBarChart),
// same "shape now, adopt later" posture as the other 6C.5 components.
export function AnalyticsLegend({ entries }: AnalyticsLegendProps) {
  if (entries.length < 2) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {entries.map((entry) => (
        <span
          key={entry.label}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden="true"
          />
          {entry.label}
        </span>
      ))}
    </div>
  );
}
