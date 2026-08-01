import type { DashboardExportsDto, ExportType } from '@speedora/shared';
import { Download } from 'lucide-react';
import { StatTile } from '@/components/analytics/StatTile';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { exportJobDownloadUrl } from '@/lib/api';
import { formatRelativeTime } from '@/lib/dashboard';
import { exportJobStatusBadge, exportTypeLabel } from '@/lib/export';

export interface ExportActivityPanelProps {
  exports: DashboardExportsDto;
}

const TONE_CLASSES: Record<'good' | 'neutral' | 'bad', string> = {
  good: 'border-success/40 text-success',
  neutral: 'border-border text-muted-foreground',
  bad: 'border-destructive/40 text-destructive',
};

function formatPercent(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}

// Phase E (Dashboard & Recent Activity) - fed by GET /dashboard/exports.
// Reuses exportJobStatusBadge/exportTypeLabel (already the Export Center's
// own display registries, see lib/export.ts) rather than a second set of
// labels/tones - this is the same ExportJob data, just an account-wide
// rollup instead of a per-video list.
export function ExportActivityPanel({ exports }: ExportActivityPanelProps) {
  if (exports.totalExports === 0) {
    return <p className="font-body text-sm text-muted-foreground">Belum ada export.</p>;
  }

  const typeEntries = (Object.entries(exports.exportsByType) as [ExportType, number][]).filter(
    ([, count]) => count > 0,
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Sedang Diproses" value={String(exports.processingCount)} />
        <StatTile label="Antre" value={String(exports.pendingCount)} />
        <StatTile label="Gagal" value={String(exports.failedCount)} />
        <StatTile
          label="Success Rate"
          value={formatPercent(exports.successRate)}
          caption={
            exports.lastReadyAt
              ? `Terakhir siap ${formatRelativeTime(exports.lastReadyAt)}`
              : undefined
          }
        />
      </div>

      {typeEntries.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap gap-x-4 gap-y-1 p-4">
            {typeEntries.map(([type, count]) => (
              <span key={type} className="font-body text-xs text-muted-foreground">
                {exportTypeLabel(type)}: <span className="text-foreground">{count}</span>
              </span>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="divide-y divide-border p-0">
          {exports.recentExports.map((job) => {
            const badge = exportJobStatusBadge(job.status);
            return (
              <div key={job.id} className="flex items-center gap-3 p-3">
                <span className="flex-1 font-body text-sm text-foreground">
                  {exportTypeLabel(job.type)}
                </span>
                <Badge variant="outline" className={TONE_CLASSES[badge.tone]}>
                  {badge.label}
                </Badge>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatRelativeTime(job.createdAt)}
                </span>
                {job.resultUrl && (
                  <a
                    href={exportJobDownloadUrl(job.id)}
                    aria-label={`Unduh ${exportTypeLabel(job.type)}`}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </a>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
