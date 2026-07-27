'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { secondsToTimestamp } from '@speedora/shared';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { VideoWithClipsDto } from '@/lib/api';

// Quality Validation roadmap (Fase 0 design, Phase 3) - one row per
// Warning-tier rule in packages/video-validation's WARNING_RULES. ruleId is
// the shared identity between the worker's rule engine and this UI (per the
// user's own recommendation, 2026-07-26): the engine never knows this
// label/icon mapping exists, and this component never re-implements any
// threshold logic - it only asks "is ruleId present in
// video.validationReport.warnings?" and renders a real value alongside.
const CHECK_ROWS: {
  ruleId: string;
  label: string;
  formatValue: (video: VideoWithClipsDto) => string;
}[] = [
  {
    ruleId: 'low-resolution',
    label: 'Resolusi',
    formatValue: (v) => (v.width && v.height ? `${v.width}×${v.height}` : 'Tidak diketahui'),
  },
  {
    ruleId: 'low-bitrate',
    label: 'Bitrate Video',
    formatValue: (v) =>
      v.videoBitrate ? `~${Math.round(v.videoBitrate / 1000)} kbps` : 'Tidak diketahui',
  },
  {
    ruleId: 'unstable-fps',
    label: 'Frame Rate',
    formatValue: (v) => (v.fps ? `${v.fps} fps` : 'Tidak diketahui'),
  },
  {
    ruleId: 'long-duration',
    label: 'Durasi',
    formatValue: (v) =>
      v.durationSeconds != null ? secondsToTimestamp(v.durationSeconds) : 'Tidak diketahui',
  },
  {
    ruleId: 'mono-audio',
    label: 'Audio',
    formatValue: (v) =>
      v.audioChannels == null ? 'Tidak diketahui' : v.audioChannels === 1 ? 'Mono' : 'Stereo',
  },
];

// Shown once probing succeeds (video.status === PENDING_SETTINGS) - a video
// that fails an Error-tier check never reaches this component at all (it
// goes straight to FAILED, handled by ProcessingStatus's existing failure
// screen, same as every other pipeline-stage failure). Every warning here is
// non-blocking by design (see the Fase 0 design's Error/Warning/Info split).
//
// Rendered as the first panel inside ProcessingSettings rather than its own
// gated step (previous "Lanjutkan ke Pengaturan" click-through removed per
// the user's 2026-07-27 direction: real ffprobe-backed warnings stay, but
// reading them no longer requires a screen of its own) - purely
// presentational, no onContinue/onBack of its own.
export function QualityValidation({ video }: { video: VideoWithClipsDto }) {
  const warningIds = new Set((video.validationReport?.warnings ?? []).map((w) => w.id));
  const warningMessages = video.validationReport?.warnings ?? [];
  const hasWarnings = warningMessages.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Kualitas Video</CardTitle>
        <CardDescription>
          {hasWarnings
            ? `${warningMessages.length} hal perlu diperhatikan - tidak menghalangi proses.`
            : 'Video siap diproses.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {CHECK_ROWS.map((row) => {
          const triggered = warningIds.has(row.ruleId);
          return (
            <div key={row.ruleId} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                {triggered ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                )}
                <span className="font-body text-foreground">{row.label}</span>
              </div>
              <span className="font-mono text-muted-foreground">{row.formatValue(video)}</span>
            </div>
          );
        })}

        {hasWarnings ? (
          <ul className="mt-2 space-y-1 border-t border-border pt-3">
            {warningMessages.map((warning) => (
              <li key={warning.id} className="font-body text-xs text-muted-foreground">
                {warning.message}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
