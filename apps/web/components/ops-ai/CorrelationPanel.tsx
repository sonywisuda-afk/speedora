import type { CorrelationRow } from '@speedora/shared';

export interface CorrelationPanelProps {
  hasEnoughSamples: boolean;
  sampleCount: number;
  minSamplesRequired: number;
  correlations: CorrelationRow[];
}

// Milestone 1.5's Correlation Dashboard (M5C.6) - explicit instruction:
// "Jangan memaksakan angka ketika sampel belum memadai" (never fabricate a
// number when samples aren't sufficient yet).
export function CorrelationPanel({
  hasEnoughSamples,
  sampleCount,
  minSamplesRequired,
  correlations,
}: CorrelationPanelProps) {
  if (!hasEnoughSamples) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Belum cukup sampel ({sampleCount} dari minimum {minSamplesRequired}) untuk korelasi yang
        bermakna secara statistik. Data akan lebih berarti seiring pertumbuhan engagement.
      </p>
    );
  }

  return (
    <div>
      <p className="font-body text-xs text-muted-foreground">
        {sampleCount} sampel dengan data engagement.
      </p>
      <table className="mt-2 w-full border-collapse font-body text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="p-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Feature
            </th>
            <th className="p-2 text-right font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Correlation vs. Engagement
            </th>
          </tr>
        </thead>
        <tbody>
          {correlations.map((row) => (
            <tr key={row.feature} className="border-b border-border/50">
              <td className="p-2 font-mono text-xs text-foreground">{row.feature}</td>
              <td className="p-2 text-right font-mono text-xs text-ai">
                {row.correlation.toFixed(3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
