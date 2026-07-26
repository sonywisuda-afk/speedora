import { PublishStatus } from '@speedora/database';
import { CampaignStatus } from '@speedora/shared';

// Publishing Expansion Phase 6 (Scheduling) - deliberately a pure function,
// not a stored/recomputed Campaign column (see schema.prisma's
// CampaignStatus comment). `cancelledAt` is the one piece of state that
// can't be re-derived from job status alone; everything else is a direct
// function of the campaign's PublishRecords.
export function computeCampaignStatus(
  cancelledAt: Date | null,
  jobs: Array<{ status: PublishStatus }>,
): CampaignStatus {
  if (cancelledAt) return CampaignStatus.CANCELLED;
  if (jobs.length === 0) return CampaignStatus.DRAFT;
  if (
    jobs.every((j) => j.status === PublishStatus.PUBLISHED || j.status === PublishStatus.FAILED)
  ) {
    return CampaignStatus.COMPLETED;
  }
  if (
    jobs.some((j) => j.status === PublishStatus.PUBLISHING || j.status === PublishStatus.PUBLISHED)
  ) {
    return CampaignStatus.RUNNING;
  }
  return CampaignStatus.SCHEDULED; // all still SCHEDULED/QUEUED, none started
}
