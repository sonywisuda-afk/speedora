'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { createExportJob, exportJobDownloadUrl, getExportJob } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { exportJobStatusBadge, exportTypeLabel, isExportJobInFlight } from '@/lib/export';
import type { ExportJobDto, ExportType } from '@speedora/shared';

const TONE_CLASSES: Record<'good' | 'neutral' | 'bad', string> = {
  good: 'border-success/40 text-success',
  neutral: 'border-border text-muted-foreground',
  bad: 'border-destructive/40 text-destructive',
};

// Sprint 03e - one async ExportJob's whole lifecycle for one ExportType,
// same SWR-polling shape as DashboardClient's video list (refreshInterval
// stops itself once nothing is still in flight, no manual setInterval/
// cleanup needed). A new "Try again" click after FAILED creates a brand new
// job rather than retrying the old one - matches the backend's own "no
// automatic retry, re-trigger via a new POST" design (see
// export-generate.worker.ts's comment on this), there is no retry endpoint
// to call.
//
// Recent Exports / Persistent Export History - `initialJob` (the most
// recent job of this type, from ExportCenterDialog's list fetch) seeds
// `jobId` so a dialog reopen/page refresh shows the real last-known status
// immediately instead of resetting to "Generate". This row fully unmounts
// on dialog close and on page reload (Radix TabsContent/DialogContent don't
// stay mounted while hidden/closed), so re-seeding from a fresh
// `initialJob` prop on remount is all that's needed - no extra sync effect.
export function ExportTypeRow({
  videoId,
  type,
  initialJob,
}: {
  videoId: string;
  type: ExportType;
  initialJob: ExportJobDto | null;
}) {
  const [jobId, setJobId] = useState<string | null>(initialJob?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: job } = useSWR(
    jobId ? ['export-job', jobId] : null,
    () => getExportJob(jobId as string),
    {
      refreshInterval: (latest) => (latest && isExportJobInFlight(latest.status) ? 2000 : 0),
      fallbackData: initialJob && jobId === initialJob.id ? initialJob : undefined,
    },
  );

  async function handleGenerate() {
    setCreateError(null);
    setCreating(true);
    try {
      const created = await createExportJob(videoId, type);
      setJobId(created.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Gagal membuat export');
    } finally {
      setCreating(false);
    }
  }

  const badge = job ? exportJobStatusBadge(job.status) : null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-body text-sm text-foreground">{exportTypeLabel(type)}</span>
        {badge && (
          <Badge variant="outline" className={TONE_CLASSES[badge.tone]}>
            {badge.label}
          </Badge>
        )}
      </div>

      {!job || job.status === 'FAILED' ? (
        <div className="flex items-center gap-2">
          {createError && <span className="font-body text-xs text-destructive">{createError}</span>}
          {job?.failReason && (
            <span className="font-body text-xs text-destructive">{job.failReason}</span>
          )}
          <Button size="sm" variant="outline" disabled={creating} onClick={handleGenerate}>
            {creating ? 'Membuat...' : job ? 'Coba Lagi' : 'Generate'}
          </Button>
        </div>
      ) : job.status === 'READY' ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={creating} onClick={handleGenerate}>
            {creating ? 'Membuat...' : 'Generate Ulang'}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={exportJobDownloadUrl(job.id)}>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Unduh
            </a>
          </Button>
        </div>
      ) : (
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Memproses...
        </span>
      )}
    </div>
  );
}
