import { VideoStatus } from '@speedora/shared';

// Sprint 1-2 (Dashboard Redesign) - pure, no-JSX display helpers, same
// "keep component logic testable without a component-testing framework"
// reasoning as lib/analytics.ts/lib/explainability.ts.

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
}

// null (not a fabricated "0:00") when durationSeconds isn't known yet -
// same "no data" vs. "zero" distinction as lib/analytics.ts's
// formatEngagementScore.
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

// PR #44 (Queue & Worker Observability Dashboard) - GET /queues'
// avgProcessingTimeMs is often sub-second (a publish-clip job observed at
// 165ms in dev - see docs/deployment.md's Fase 3 Queue Metrics), which
// formatDuration()'s whole-seconds rounding would flatten to a useless
// "0:00". null (not a fabricated "0ms") when the queue has no completed-job
// sample yet - same "no data" vs. "zero" distinction as formatDuration
// above.
export function formatMillis(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// `now` is an optional override (defaults to Date.now()) purely so this is
// deterministically testable - real callers never pass it.
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const diffSeconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (diffSeconds < 60) return 'baru saja';
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} menit lalu`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} jam lalu`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} hari lalu`;
  const diffMonths = Math.round(diffDays / 30);
  return `${diffMonths} bulan lalu`;
}

export interface ProcessingStage {
  id:
    | 'importing'
    | 'pending-settings'
    | 'transcribing'
    | 'detecting'
    | 'rendering'
    | 'completed'
    | 'failed';
  label: string;
  // 0-100. A stage with no real incremental progress signal (detect-clips)
  // reports a real 0, not a fabricated in-between number - same "never
  // interpolated/fabricated" convention as Video.importProgress/
  // transcribeProgress themselves.
  percent: number;
}

// Maps the pipeline's real stages (VideoStatus + importProgress/
// transcribeProgress/per-clip outputUrl) onto a Processing Queue stepper.
// Deliberately NOT a fabricated "Uploading -> OCR -> Whisper -> Fusion ->
// Rendering" breakdown - OCR/Fusion aren't separately-queued jobs (they run
// inside render-clip alongside a dozen other signals), so presenting them
// as distinct visible steps would misrepresent the actual architecture.
// This reflects the real 5 queue stages instead.
export function videoProcessingStage(video: {
  status: VideoStatus;
  importProgress: number | null;
  transcribeProgress: number | null;
  clips: Array<{ downloadUrl: string | null }>;
}): ProcessingStage {
  switch (video.status) {
    case VideoStatus.IMPORTING:
      return {
        id: 'importing',
        label: 'Mengunduh dari YouTube',
        percent: video.importProgress ?? 0,
      };
    // Quality Validation roadmap (Fase 0 design, Phase 1) - reached once
    // probe-video.worker.ts's ffprobe pass succeeds, left once the user
    // submits Processing Settings (POST /videos/:id/start-processing).
    case VideoStatus.PENDING_SETTINGS:
      return { id: 'pending-settings', label: 'Menunggu Pengaturan Pemrosesan', percent: 0 };
    case VideoStatus.UPLOADED:
      return {
        id: 'transcribing',
        label: 'Transkripsi (Whisper)',
        percent: video.transcribeProgress ?? 0,
      };
    case VideoStatus.TRANSCRIBED:
      return { id: 'detecting', label: 'Mendeteksi Klip (Fusion Engine)', percent: 0 };
    case VideoStatus.CLIPS_DETECTED: {
      const total = video.clips.length;
      const rendered = video.clips.filter((clip) => clip.downloadUrl !== null).length;
      const percent = total > 0 ? Math.round((rendered / total) * 100) : 0;
      return { id: 'rendering', label: 'Merender Klip', percent };
    }
    case VideoStatus.RENDERED:
      return { id: 'completed', label: 'Selesai', percent: 100 };
    case VideoStatus.FAILED:
      return { id: 'failed', label: 'Gagal', percent: 0 };
  }
}
