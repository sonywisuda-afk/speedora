import { CampaignStatus, PublishStatus } from '@speedora/shared';

// Phase 6 (Scheduling) - shared between /campaigns and /campaigns/[id] so
// the label/badge mapping for the server-derived CampaignStatus (see
// CampaignDto) only lives in one place.
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  [CampaignStatus.DRAFT]: 'Draft',
  [CampaignStatus.SCHEDULED]: 'Scheduled',
  [CampaignStatus.RUNNING]: 'Running',
  [CampaignStatus.COMPLETED]: 'Completed',
  [CampaignStatus.CANCELLED]: 'Cancelled',
};

export function campaignStatusBadgeVariant(
  status: CampaignStatus,
): 'default' | 'secondary' | 'outline' | 'muted' {
  switch (status) {
    case CampaignStatus.RUNNING:
      return 'default';
    case CampaignStatus.COMPLETED:
      return 'secondary';
    case CampaignStatus.SCHEDULED:
      return 'outline';
    case CampaignStatus.DRAFT:
    case CampaignStatus.CANCELLED:
    default:
      return 'muted';
  }
}

// Job-status labels for a Campaign's publish job list (CampaignDetailDto.
// publishRecords) - same 5 PublishStatus values DashboardClient's own local
// PUBLISH_STATUS_LABELS covers, kept separate since that copy is in
// Indonesian to match the rest of the dashboard, while this campaign view
// is English-labeled like the rest of Phase 6's new pages.
export const PUBLISH_STATUS_LABELS: Record<PublishStatus, string> = {
  [PublishStatus.SCHEDULED]: 'Scheduled',
  [PublishStatus.QUEUED]: 'Queued',
  [PublishStatus.PUBLISHING]: 'Publishing',
  [PublishStatus.PUBLISHED]: 'Published',
  [PublishStatus.FAILED]: 'Failed',
};

// Contract Governance audit Sprint 3 (Runtime Safety, 2026-08-01) -
// PUBLISH_STATUS_LABELS is compile-time exhaustive today, but every
// consumer here reads `status` straight off a PublishRecord-derived DTO
// (backend data), not this frontend's own enum iteration - a live
// frontend/backend version skew (a new PublishStatus shipped in the API
// before this bundle is rebuilt) would otherwise silently render nothing.
// Falls back to the raw value plus a console.warn.
export function getPublishStatusLabel(status: string): string {
  if (status in PUBLISH_STATUS_LABELS) {
    return PUBLISH_STATUS_LABELS[status as PublishStatus];
  }
  console.warn(
    `[scheduling] unknown PublishStatus "${status}" - falling back to the raw value. ` +
      'This means the API sent a status this frontend build does not recognize yet.',
  );
  return status;
}
