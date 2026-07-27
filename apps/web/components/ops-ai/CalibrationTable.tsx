import type { WeightCalibrationRow } from '@speedora/shared';
import { signalLabel } from '@/lib/ops-ai';

export interface CalibrationTableProps {
  hasEnoughSamples: boolean;
  sampleCount: number;
  minSamplesRequired: number;
  suggestions: WeightCalibrationRow[];
}

// Milestone 1.5's Weight Calibration Report - a heuristic *suggestion* for
// a human to review against packages/fusion-engine/src/weights.ts, never
// auto-applied. Same insufficient-data honesty as CorrelationPanel (this
// is derived from it).
export function CalibrationTable({
  hasEnoughSamples,
  sampleCount,
  minSamplesRequired,
  suggestions,
}: CalibrationTableProps) {
  if (!hasEnoughSamples) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Bergantung pada Correlation di atas - belum cukup sampel ({sampleCount} dari minimum{' '}
        {minSamplesRequired}).
      </p>
    );
  }

  return (
    <div>
      <p className="font-body text-xs text-muted-foreground">
        Saran heuristik saja - tinjau sebelum mengubah packages/fusion-engine/src/weights.ts, jangan
        diterapkan otomatis.
      </p>
      <table className="mt-2 w-full border-collapse font-body text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Signal
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Current
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Suggested
            </th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((row) => (
            <tr key={row.signal} className="border-b border-border/50">
              <td className="p-2 font-body text-xs text-foreground">{signalLabel(row.signal)}</td>
              <td className="p-2 text-right font-mono text-xs text-muted-foreground">
                {row.currentWeight}
              </td>
              <td className="p-2 text-right font-mono text-xs text-ai">{row.suggestedWeight}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
