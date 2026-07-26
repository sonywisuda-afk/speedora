import { PLATFORM_METADATA, SocialPlatform, VideoStatus } from '@speedora/shared';

// Milestone 5A (Analytics Dashboard - Overview) - pure, no-JSX display
// helpers, same "keep component logic testable without a component-testing
// framework" reasoning as Milestone 4's lib/explainability.ts.

// Clamped to [0, 100] - same defensive posture as
// lib/explainability.ts's toPercent, for a bar width driven by an
// unbounded count relative to the largest count in its group.
export function toBarPercent(count: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, count / max)) * 100);
}

// Multi-Platform Publishing Expansion, Phase 0 - derived from
// @speedora/shared's PLATFORM_METADATA (the single source of truth) rather
// than an independently hand-copied map, same as social/page.tsx and
// DashboardClient.tsx now reading lib/platform-metadata.ts directly. Kept
// as its own export here (not just re-exported) since PlatformComparisonTable/
// PlatformBreakdown/TopClipsTable already import this exact name.
export const PLATFORM_LABELS: Record<SocialPlatform, string> = Object.fromEntries(
  Object.entries(PLATFORM_METADATA).map(([platform, meta]) => [platform, meta.label]),
) as Record<SocialPlatform, string>;

export interface StatusBadge {
  label: string;
  tone: 'good' | 'neutral' | 'bad';
}

const VIDEO_STATUS_BADGES: Record<VideoStatus, StatusBadge> = {
  [VideoStatus.IMPORTING]: { label: 'Mengimpor', tone: 'neutral' },
  // Quality Validation roadmap (Fase 0 design, Phase 1).
  [VideoStatus.PENDING_SETTINGS]: { label: 'Menunggu Pengaturan', tone: 'neutral' },
  [VideoStatus.UPLOADED]: { label: 'Diunggah', tone: 'neutral' },
  [VideoStatus.TRANSCRIBED]: { label: 'Transkrip Selesai', tone: 'neutral' },
  [VideoStatus.CLIPS_DETECTED]: { label: 'Klip Terdeteksi', tone: 'neutral' },
  [VideoStatus.RENDERED]: { label: 'Selesai', tone: 'good' },
  [VideoStatus.FAILED]: { label: 'Gagal', tone: 'bad' },
};

export function videoStatusBadge(status: VideoStatus): StatusBadge {
  return VIDEO_STATUS_BADGES[status];
}

// engagementScore is an unbounded heuristic ratio (M1's
// (likes + comments*3 + shares*5) / views), not a 0-1/percentage value -
// formatted as a plain decimal, not a "%", so it's never confused with
// highlightConfidence's percentage formatting (lib/explainability.ts).
export function formatEngagementScore(score: number | null): string {
  if (score === null) return 'Belum ada data';
  return score.toFixed(2);
}

// e.g. "2026-01-08" -> "8 Jan" - short enough for a bar-strip tooltip/axis
// label without needing a date library. Exported - lib/performance.ts
// (Milestone 5B) reuses this for its own date formatting rather than a
// second copy of the same label list.
export const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

export function formatShortDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  const monthIndex = Number(month) - 1;
  const monthLabel = MONTH_LABELS[monthIndex] ?? month;
  return `${Number(day)} ${monthLabel}`;
}
