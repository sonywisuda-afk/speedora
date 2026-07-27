import type { FeatureCompletenessRow } from '@speedora/shared';
import { cn } from '@/lib/utils';

export interface FeatureCompletenessTableProps {
  rows: FeatureCompletenessRow[];
}

// Milestone 1.5's Missing Data Report, surfaced in UI for the first time.
// Highlights >80% missing (same threshold generate-dataset-report.ts's
// healthVerdict() uses) - likely a detector with no caller yet or a low
// success rate, not necessarily a bug.
export function FeatureCompletenessTable({ rows }: FeatureCompletenessTableProps) {
  if (rows.length === 0) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Belum ada clip dengan fitur terhitung.
      </p>
    );
  }

  return (
    <div className="max-h-96 overflow-y-auto">
      <table className="w-full border-collapse font-body text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Feature
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Present
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Missing
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Missing %
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.feature} className="border-b border-border/50">
              <td className="p-2 font-mono text-xs text-foreground">{row.feature}</td>
              <td className="p-2 text-right font-mono text-xs text-muted-foreground">
                {row.presentCount}
              </td>
              <td className="p-2 text-right font-mono text-xs text-muted-foreground">
                {row.missingCount}
              </td>
              <td
                className={cn(
                  'p-2 text-right font-mono text-xs',
                  row.missingRatePct > 80 ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {row.missingRatePct}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
