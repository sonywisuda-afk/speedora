'use client';

import { Download, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { ExportType } from '@speedora/shared';
import { createExportJob, exportJobDownloadUrl, getExportJob, listExportJobs } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { exportJobStatusBadge, isExportJobInFlight } from '@/lib/export';

const TONE_CLASSES: Record<'good' | 'neutral' | 'bad', string> = {
  good: 'border-emerald-500/40 text-emerald-400',
  neutral: 'border-border text-muted-foreground',
  bad: 'border-rose-500/40 text-rose-400',
};

// Account-wide Analytics Report export - same SWR-poll-until-READY/FAILED +
// <a href> download idiom as ExportTypeRow, but standalone (no videoId, no
// parent Dialog providing an already-fetched initialJob) since this lives
// directly on /analytics rather than inside a per-video ExportCenterDialog
// tab. Seeds jobId from the most recent ANALYTICS_REPORT job once its own
// list fetch resolves (Recent Exports pattern) - the `jobId === null` guard
// means this only ever seeds, never clobbers a job just created by
// handleGenerate.
export function AnalyticsReportExport() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: jobList } = useSWR(['export-jobs', 'ANALYTICS_REPORT'], () =>
    listExportJobs({ type: ExportType.ANALYTICS_REPORT }),
  );

  useEffect(() => {
    if (jobId === null && jobList?.jobs[0]) {
      setJobId(jobList.jobs[0].id);
    }
  }, [jobList, jobId]);

  const { data: job } = useSWR(jobId ? ['export-job', jobId] : null, () => getExportJob(jobId as string), {
    refreshInterval: (latest) => (latest && isExportJobInFlight(latest.status) ? 2000 : 0),
  });

  async function handleGenerate() {
    setCreateError(null);
    setCreating(true);
    try {
      const created = await createExportJob(undefined, ExportType.ANALYTICS_REPORT);
      setJobId(created.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Gagal membuat export');
    } finally {
      setCreating(false);
    }
  }

  const badge = job ? exportJobStatusBadge(job.status) : null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
      <span className="font-body text-sm text-foreground">Analytics Report</span>
      {badge && (
        <Badge variant="outline" className={TONE_CLASSES[badge.tone]}>
          {badge.label}
        </Badge>
      )}

      {!job || job.status === 'FAILED' ? (
        <>
          {createError && (
            <span className="font-body text-xs text-destructive">{createError}</span>
          )}
          <Button size="sm" variant="outline" disabled={creating} onClick={handleGenerate}>
            {creating ? 'Membuat...' : job ? 'Coba Lagi' : 'Export'}
          </Button>
        </>
      ) : job.status === 'READY' ? (
        <>
          <Button size="sm" variant="ghost" disabled={creating} onClick={handleGenerate}>
            {creating ? 'Membuat...' : 'Generate Ulang'}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={exportJobDownloadUrl(job.id)}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Unduh
            </a>
          </Button>
        </>
      ) : (
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Memproses...
        </span>
      )}
    </div>
  );
}
