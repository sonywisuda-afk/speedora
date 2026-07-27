import type { FeatureDriftRow } from '@speedora/shared';
import { cn } from '@/lib/utils';

export interface DriftTableProps {
  insufficientData: boolean;
  entries: FeatureDriftRow[];
}

// Milestone 1.5's Feature Drift Detection, surfaced in UI for the first
// time - a feature whose mean moved >25% (heuristic, unvalidated) between
// the earlier/later halves of the dataset, flagged for a human to look at,
// not proof of a real regression.
export function DriftTable({ insufficientData, entries }: DriftTableProps) {
  if (insufficientData) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Belum cukup data untuk membagi dataset menjadi dua paruh dan membandingkannya.
      </p>
    );
  }
  if (entries.length === 0) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Tidak ada fitur dengan cukup sampel di kedua paruh untuk dibandingkan.
      </p>
    );
  }

  return (
    <table className="w-full border-collapse font-body text-sm">
      <thead>
        <tr className="border-b border-border text-left">
          <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Feature
          </th>
          <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Mean (earlier)
          </th>
          <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Mean (later)
          </th>
          <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Delta %
          </th>
          <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Drifted?
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((row) => (
          <tr key={row.feature} className="border-b border-border/50">
            <td className="p-2 font-mono text-xs text-foreground">{row.feature}</td>
            <td className="p-2 text-right font-mono text-xs text-muted-foreground">
              {row.meanEarlier.toFixed(3)}
            </td>
            <td className="p-2 text-right font-mono text-xs text-muted-foreground">
              {row.meanLater.toFixed(3)}
            </td>
            <td className="p-2 text-right font-mono text-xs text-muted-foreground">
              {row.relativeDeltaPct}%
            </td>
            <td
              className={cn(
                'p-2 text-right font-mono text-xs',
                row.drifted ? 'text-destructive' : 'text-success',
              )}
            >
              {row.drifted ? 'Ya' : 'Tidak'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
