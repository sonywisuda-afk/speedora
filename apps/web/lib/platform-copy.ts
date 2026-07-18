import type { ClipPlatformCopyDto, ClipPlatformCopyStatus, SocialPlatform } from '@speedora/shared';

// Publishing Expansion Phase 7B (AI SEO) - pure, no-JSX helpers, same
// "testable without a component-testing framework" reasoning as
// lib/export.ts. `copies` arrives already sorted createdAt DESC
// (ClipsService.listPlatformCopies' query), so the first match for a
// platform is always the newest row - same "keep only the first job seen"
// trick lib/export.ts's latestJobByType() uses, just scoped to one platform
// at a time (a PlatformCopyPanel only ever shows one platform, unlike
// ExportCenterDialog which renders every type at once).
export function latestPlatformCopy(
  copies: ClipPlatformCopyDto[],
  platform: SocialPlatform,
): ClipPlatformCopyDto | undefined {
  return copies.find((copy) => copy.platform === platform);
}

// A row is still in flight exactly while PENDING/PROCESSING - the one place
// this distinction matters is PlatformCopyPanel's SWR refreshInterval (poll
// while true, stop once false), same convention as lib/export.ts's
// isExportJobInFlight().
export function isPlatformCopyInFlight(status: ClipPlatformCopyStatus): boolean {
  return status === 'PENDING' || status === 'PROCESSING';
}

export interface StatusBadge {
  label: string;
  tone: 'good' | 'neutral' | 'bad';
}

const STATUS_BADGES: Record<ClipPlatformCopyStatus, StatusBadge> = {
  PENDING: { label: 'Menunggu', tone: 'neutral' },
  PROCESSING: { label: 'Memproses', tone: 'neutral' },
  READY: { label: 'Siap', tone: 'good' },
  FAILED: { label: 'Gagal', tone: 'bad' },
};

export function platformCopyStatusBadge(status: ClipPlatformCopyStatus): StatusBadge {
  return STATUS_BADGES[status];
}
