import { PublishStatus } from '@speedora/database';
import { CampaignStatus } from '@speedora/shared';
import { computeCampaignStatus } from './campaign-status.util';

describe('computeCampaignStatus', () => {
  it('returns CANCELLED whenever cancelledAt is set, regardless of job state', () => {
    expect(computeCampaignStatus(new Date(), [{ status: PublishStatus.PUBLISHED }])).toBe(
      CampaignStatus.CANCELLED,
    );
    expect(computeCampaignStatus(new Date(), [])).toBe(CampaignStatus.CANCELLED);
  });

  it('returns DRAFT when there are no jobs yet', () => {
    expect(computeCampaignStatus(null, [])).toBe(CampaignStatus.DRAFT);
  });

  it('returns SCHEDULED when all jobs are still SCHEDULED/QUEUED', () => {
    expect(
      computeCampaignStatus(null, [
        { status: PublishStatus.SCHEDULED },
        { status: PublishStatus.QUEUED },
      ]),
    ).toBe(CampaignStatus.SCHEDULED);
  });

  it('returns RUNNING when at least one job is PUBLISHING or PUBLISHED but not all are terminal', () => {
    expect(
      computeCampaignStatus(null, [
        { status: PublishStatus.PUBLISHING },
        { status: PublishStatus.SCHEDULED },
      ]),
    ).toBe(CampaignStatus.RUNNING);
    expect(
      computeCampaignStatus(null, [
        { status: PublishStatus.PUBLISHED },
        { status: PublishStatus.QUEUED },
      ]),
    ).toBe(CampaignStatus.RUNNING);
  });

  it('returns COMPLETED when every job has reached a terminal state (PUBLISHED or FAILED)', () => {
    expect(
      computeCampaignStatus(null, [
        { status: PublishStatus.PUBLISHED },
        { status: PublishStatus.FAILED },
      ]),
    ).toBe(CampaignStatus.COMPLETED);
  });

  it('does not treat all-FAILED as RUNNING (FAILED is terminal, not "started but not done")', () => {
    expect(
      computeCampaignStatus(null, [
        { status: PublishStatus.FAILED },
        { status: PublishStatus.FAILED },
      ]),
    ).toBe(CampaignStatus.COMPLETED);
  });
});
