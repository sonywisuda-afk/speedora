import type { HeatmapCell } from '@speedora/shared';
import { AnalyticsEmptyState } from './AnalyticsEmptyState';

export interface EngagementHeatmapProps {
  cells: HeatmapCell[];
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Min' },
  { value: 1, label: 'Sen' },
  { value: 2, label: 'Sel' },
  { value: 3, label: 'Rab' },
  { value: 4, label: 'Kam' },
  { value: 5, label: 'Jum' },
  { value: 6, label: 'Sab' },
];

const SIGNAL_CYAN_RGB = '34, 230, 214';

// Sprint 6H (Heatmap) - real data: which day/hour this account's clips tend
// to publish into higher engagement (see HeatmapCell's own doc comment for
// why this is UTC, not each creator's local time). Recharts has no native
// heatmap primitive, so this is a plain CSS grid rather than a Recharts
// chart - still follows the dataviz skill's magnitude rule (one sequential
// hue, light-to-dark by intensity). A cell with zero publishes is rendered
// as a distinct muted tone, never as "zero engagement" - no data isn't the
// same as low engagement.
export function EngagementHeatmap({ cells }: EngagementHeatmapProps) {
  if (cells.every((c) => c.publishCount === 0)) {
    return <AnalyticsEmptyState message="Belum ada publikasi pada rentang waktu ini." />;
  }

  const maxScore = Math.max(0, ...cells.map((c) => c.averageEngagementScore ?? 0));
  const cellByKey = new Map(cells.map((c) => [`${c.dayOfWeek}-${c.hour}`, c]));

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        Jam dalam UTC
      </p>
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <tbody>
            {DAYS.map((day) => (
              <tr key={day.value}>
                <td className="pr-2 text-right font-mono text-[10px] text-muted-foreground">
                  {day.label}
                </td>
                {HOURS.map((hour) => {
                  const cell = cellByKey.get(`${day.value}-${hour}`);
                  const hasData = Boolean(cell && cell.publishCount > 0);
                  const intensity =
                    hasData && maxScore > 0 ? (cell!.averageEngagementScore ?? 0) / maxScore : 0;
                  const title = hasData
                    ? `${day.label} ${hour}:00 UTC — ${cell!.publishCount} publikasi, engagement rata-rata ${cell!.averageEngagementScore?.toFixed(2) ?? '—'}`
                    : `${day.label} ${hour}:00 UTC — belum ada publikasi`;

                  return (
                    <td key={hour} className="p-0.5">
                      <div
                        className="h-4 w-4 rounded-sm"
                        style={{
                          backgroundColor: hasData
                            ? `rgba(${SIGNAL_CYAN_RGB}, ${0.15 + intensity * 0.85})`
                            : 'hsl(var(--border))',
                        }}
                        title={title}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
