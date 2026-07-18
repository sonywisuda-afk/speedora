import { ExportType, type ExportJobDto, type ExportJobStatus } from '@speedora/shared';
import type { VideoExportFormat } from './api';

// Export Center (Sprint 03e) - pure, no-JSX helpers, same "testable without
// a component-testing framework" reasoning as lib/thumbnail-selection.ts.
// Components map `tone` to actual Tailwind classes themselves (see
// ThumbnailSelectionPanel's own TONE_CLASSES constant) - this file only
// returns the semantic tone, never a className.

export interface StatusBadge {
  label: string;
  tone: 'good' | 'neutral' | 'bad';
}

const STATUS_BADGES: Record<ExportJobStatus, StatusBadge> = {
  PENDING: { label: 'Menunggu', tone: 'neutral' },
  PROCESSING: { label: 'Memproses', tone: 'neutral' },
  READY: { label: 'Siap', tone: 'good' },
  FAILED: { label: 'Gagal', tone: 'bad' },
};

export function exportJobStatusBadge(status: ExportJobStatus): StatusBadge {
  return STATUS_BADGES[status];
}

// A job is still in flight exactly while PENDING/PROCESSING - the one place
// this distinction matters is ExportTypeRow's SWR refreshInterval (poll
// while true, stop once false).
export function isExportJobInFlight(status: ExportJobStatus): boolean {
  return status === 'PENDING' || status === 'PROCESSING';
}

const FORMAT_LABELS: Record<VideoExportFormat, string> = {
  'report.json': 'Laporan (JSON)',
  'report.csv': 'Laporan (CSV)',
  'clip-metadata.json': 'Metadata Klip (JSON)',
  'clip-metadata.csv': 'Metadata Klip (CSV)',
  'transcript.txt': 'Transkrip (TXT)',
  'captions.srt': 'Subtitle (SRT)',
  'captions.vtt': 'Subtitle (VTT)',
};

export function videoExportFormatLabel(format: VideoExportFormat): string {
  return FORMAT_LABELS[format];
}

export const VIDEO_EXPORT_FORMATS: VideoExportFormat[] = [
  'report.json',
  'report.csv',
  'clip-metadata.json',
  'clip-metadata.csv',
  'transcript.txt',
  'captions.srt',
  'captions.vtt',
];

const EXPORT_TYPE_LABELS: Record<ExportType, string> = {
  [ExportType.PDF]: 'PDF — Laporan Lengkap',
  [ExportType.EXCEL]: 'Excel — Laporan Lengkap',
  [ExportType.HIGHLIGHT_REPORT]: 'PDF — Highlight Report',
  [ExportType.BRAND_REPORT]: 'PDF — Brand Report',
  [ExportType.ANALYTICS_REPORT]: 'PDF — Analytics Report',
};

export function exportTypeLabel(type: ExportType): string {
  return EXPORT_TYPE_LABELS[type];
}

// Video-scoped only - drives ReportsTab's per-video tab. ANALYTICS_REPORT is
// deliberately NOT here (account-wide, no videoId to scope by) - see
// ACCOUNT_EXPORT_TYPES below.
export const EXPORT_TYPES: ExportType[] = [
  ExportType.PDF,
  ExportType.EXCEL,
  ExportType.HIGHLIGHT_REPORT,
  ExportType.BRAND_REPORT,
];

// Account-wide types, used only by AnalyticsReportExport - kept separate
// from EXPORT_TYPES rather than merged, since that array's every consumer
// (ReportsTab/ExportTypeRow) assumes a videoId prop.
export const ACCOUNT_EXPORT_TYPES: ExportType[] = [ExportType.ANALYTICS_REPORT];

// Recent Exports / Persistent Export History - `jobs` arrives already sorted
// createdAt DESC (ExportService.listRecent's query), so keeping only the
// first job seen per type is enough to get "most recent job per type"
// without a second sort here.
export function latestJobByType(
  jobs: ExportJobDto[],
): Partial<Record<ExportType, ExportJobDto>> {
  const result: Partial<Record<ExportType, ExportJobDto>> = {};
  for (const job of jobs) {
    if (!result[job.type]) {
      result[job.type] = job;
    }
  }
  return result;
}
