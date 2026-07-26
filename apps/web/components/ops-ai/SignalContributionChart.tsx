import type { SignalContributionEntry } from '@speedora/shared';
import { formatPct, signalLabel, toBarPercent } from '@/lib/ops-ai';

export interface SignalContributionChartProps {
  signals: SignalContributionEntry[];
}

// Milestone 5C-B - "Signal Analytics," the user's own stated most-important
// section. Uses weightedContribution, not normalizedValue (see
// fusion-signal-analytics.util.ts) - most signals reading ~0% is the
// correct, honest read given only a few signals carry real weight today
// (packages/fusion-engine/src/weights.ts), not a bug in this chart.
export function SignalContributionChart({ signals }: SignalContributionChartProps) {
  if (signals.length === 0) {
    return <p className="font-body text-sm text-muted-foreground">Belum ada data sinyal.</p>;
  }

  const max = Math.max(...signals.map((s) => s.averageContributionPct), 1);

  return (
    <div className="space-y-2">
      {signals.map((entry) => (
        <div key={entry.signal} className="flex items-center gap-2">
          <span className="w-28 shrink-0 font-body text-xs text-foreground">
            {signalLabel(entry.signal)}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-ai"
              style={{ width: `${toBarPercent(entry.averageContributionPct, max)}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-xs text-ai">
            {formatPct(entry.averageContributionPct)}
          </span>
          <span className="w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
            {entry.clipsWithSignal} clip
          </span>
        </div>
      ))}
      <p className="font-body text-xs text-muted-foreground">
        Sinyal dengan bobot 0 (belum dikalibrasi) akan tampil ~0% di sini - itu bacaan yang jujur,
        bukan bug. Lihat Calibration untuk saran bobot.
      </p>
    </div>
  );
}
