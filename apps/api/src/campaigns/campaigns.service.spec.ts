import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PublishStatus, SocialPlatform } from '@speedora/database';
import { CampaignStatus } from '@speedora/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { CampaignsService } from './campaigns.service';

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prisma: {
    campaign: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    publishRecord: { findMany: jest.Mock; deleteMany: jest.Mock };
    auditLogEntry: { create: jest.Mock };
  };
  let access: { assertMinRole: jest.Mock };

  const baseCampaign = {
    id: 'campaign-1',
    workspaceId: 'ws-1',
    name: 'Q3 launch',
    description: null,
    tag: null,
    startDate: new Date('2026-07-01T00:00:00.000Z'),
    endDate: new Date('2026-07-31T00:00:00.000Z'),
    cancelledAt: null as Date | null,
    createdById: 'user-1',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    // Sprint 6K (Conversion) - only getAnalytics reads this; harmless on
    // every other test's fixture.
    trackedLinks: [] as Array<{ clickCount: number }>,
  };

  beforeEach(() => {
    prisma = {
      campaign: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      publishRecord: { findMany: jest.fn(), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLogEntry: { create: jest.fn().mockResolvedValue({}) },
    };
    access = { assertMinRole: jest.fn().mockResolvedValue('EDITOR') };

    service = new CampaignsService(
      prisma as unknown as PrismaService,
      access as unknown as WorkspaceAccessService,
    );
  });

  describe('create', () => {
    const dto = { name: 'Q3 launch', startDate: '2026-07-01T00:00:00Z', endDate: '2026-07-31T00:00:00Z' };

    it('requires EDITOR+, creates the campaign, and returns it as DRAFT (no jobs yet)', async () => {
      prisma.campaign.create.mockResolvedValue(baseCampaign);

      const result = await service.create('user-1', 'ws-1', dto as never);

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'EDITOR');
      expect(prisma.campaign.create).toHaveBeenCalledWith({
        data: {
          workspaceId: 'ws-1',
          name: 'Q3 launch',
          description: null,
          tag: null,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          createdById: 'user-1',
        },
      });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'CAMPAIGN_CREATED', targetId: 'campaign-1' }),
      });
      expect(result).toMatchObject({
        id: 'campaign-1',
        status: CampaignStatus.DRAFT,
        clipCount: 0,
        platformCount: 0,
        progress: { total: 0, published: 0, failed: 0 },
      });
    });

    it('throws when endDate is not after startDate', async () => {
      await expect(
        service.create(
          'user-1',
          'ws-1',
          { name: 'x', startDate: '2026-07-31T00:00:00Z', endDate: '2026-07-01T00:00:00Z' } as never,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.campaign.create).not.toHaveBeenCalled();
    });
  });

  describe('listByWorkspace', () => {
    it('requires VIEWER+ and derives status/counts/progress per campaign from its jobs', async () => {
      prisma.campaign.findMany.mockResolvedValue([
        {
          ...baseCampaign,
          publishRecords: [
            { status: PublishStatus.PUBLISHED, clipId: 'clip-1', socialAccount: { platform: SocialPlatform.YOUTUBE } },
            { status: PublishStatus.SCHEDULED, clipId: 'clip-2', socialAccount: { platform: SocialPlatform.TIKTOK } },
          ],
        },
      ]);

      const result = await service.listByWorkspace('user-1', 'ws-1');

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
      expect(result.campaigns[0]).toMatchObject({
        status: CampaignStatus.RUNNING,
        clipCount: 2,
        platformCount: 2,
        progress: { total: 2, published: 1, failed: 0 },
      });
    });
  });

  describe('get', () => {
    it('requires VIEWER+ and returns the full job list', async () => {
      prisma.campaign.findUnique.mockResolvedValue(baseCampaign);
      prisma.publishRecord.findMany.mockResolvedValue([
        {
          id: 'record-1',
          clipId: 'clip-1',
          socialAccountId: 'account-1',
          socialAccount: { platform: SocialPlatform.YOUTUBE },
          status: PublishStatus.PUBLISHED,
          scheduledAt: null,
          platformPostId: 'yt-1',
          errorMessage: null,
          publishedAt: new Date('2026-07-02T00:00:00.000Z'),
          viewCount: null,
          likeCount: null,
          commentCount: null,
          statsUpdatedAt: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          campaignId: 'campaign-1',
          recurringScheduleId: null,
        },
      ]);

      const result = await service.get('user-1', 'campaign-1');

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
      expect(result.publishRecords).toHaveLength(1);
      expect(result.publishRecords[0].id).toBe('record-1');
      expect(result.status).toBe(CampaignStatus.COMPLETED);
    });

    it('throws NotFoundException for a missing campaign', async () => {
      prisma.campaign.findUnique.mockResolvedValue(null);

      await expect(service.get('user-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAnalytics', () => {
    function publishedJob(overrides: Record<string, unknown> = {}) {
      return {
        id: 'record-1',
        status: PublishStatus.PUBLISHED,
        publishedAt: new Date('2026-07-10T00:00:00.000Z'),
        socialAccount: { platform: SocialPlatform.YOUTUBE },
        statsSnapshots: [
          { viewCount: 100, likeCount: 10, commentCount: 2, shareCount: 1, engagementScore: 0.19 },
        ],
        ...overrides,
      };
    }

    it('checks workspace access before returning data', async () => {
      prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, publishRecords: [] });

      await service.getAnalytics('user-1', 'campaign-1', { granularity: 'daily' });

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
    });

    it('fetches the campaign and its full publish-record graph in a single query', async () => {
      prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, publishRecords: [] });

      await service.getAnalytics('user-1', 'campaign-1', { granularity: 'daily' });

      expect(prisma.campaign.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.publishRecord.findMany).not.toHaveBeenCalled();
    });

    it('handles a campaign with no publish records - real zeros, not an error', async () => {
      prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, publishRecords: [] });

      const result = await service.getAnalytics('user-1', 'campaign-1', { granularity: 'daily' });

      expect(result.totals).toEqual({
        publishCount: 0,
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        averageEngagementScore: null,
      });
      expect(result.platformBreakdown).toEqual([]);
      expect(result.engagementTrend.length).toBeGreaterThan(0); // still zero-filled, not empty
      expect(result.engagementTrend.every((p) => p.publishCount === 0)).toBe(true);
    });

    it('only counts PUBLISHED jobs - a QUEUED or FAILED job contributes no stats', async () => {
      prisma.campaign.findUnique.mockResolvedValue({
        ...baseCampaign,
        publishRecords: [
          publishedJob({ id: 'record-published' }),
          publishedJob({
            id: 'record-queued',
            status: PublishStatus.QUEUED,
            publishedAt: null,
            statsSnapshots: [],
          }),
          publishedJob({
            id: 'record-failed',
            status: PublishStatus.FAILED,
            publishedAt: null,
            statsSnapshots: [],
          }),
        ],
      });

      const result = await service.getAnalytics('user-1', 'campaign-1', { granularity: 'daily' });

      expect(result.totals.publishCount).toBe(1);
      expect(result.totals.totalViews).toBe(100);
    });

    it('reports real totals for a CANCELLED campaign that already had PUBLISHED jobs - status never gates the aggregation', async () => {
      prisma.campaign.findUnique.mockResolvedValue({
        ...baseCampaign,
        cancelledAt: new Date('2026-07-15T00:00:00.000Z'),
        publishRecords: [publishedJob()],
      });

      const result = await service.getAnalytics('user-1', 'campaign-1', { granularity: 'daily' });

      expect(result.status).toBe(CampaignStatus.CANCELLED);
      expect(result.totals.publishCount).toBe(1);
      expect(result.totals.totalViews).toBe(100);
    });

    it("platformBreakdown's totals are consistent with the top-level totals - same aggregation source", async () => {
      prisma.campaign.findUnique.mockResolvedValue({
        ...baseCampaign,
        publishRecords: [
          publishedJob({ id: 'record-yt', socialAccount: { platform: SocialPlatform.YOUTUBE } }),
          publishedJob({ id: 'record-tt', socialAccount: { platform: SocialPlatform.TIKTOK } }),
        ],
      });

      const result = await service.getAnalytics('user-1', 'campaign-1', { granularity: 'daily' });

      const breakdownTotalViews = result.platformBreakdown.reduce((sum, row) => sum + row.totalViews, 0);
      expect(breakdownTotalViews).toBe(result.totals.totalViews);
      expect(result.platformBreakdown.map((r) => r.platform).sort()).toEqual(['TIKTOK', 'YOUTUBE']);
    });

    it('reports conversionCount: null when no TrackedLink exists for this campaign - never a fabricated 0', async () => {
      prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, publishRecords: [] });

      const result = await service.getAnalytics('user-1', 'campaign-1', { granularity: 'daily' });

      expect(result.conversionCount).toBeNull();
    });

    it('sums real clickCount across every TrackedLink attached to this campaign', async () => {
      prisma.campaign.findUnique.mockResolvedValue({
        ...baseCampaign,
        publishRecords: [],
        trackedLinks: [{ clickCount: 8 }, { clickCount: 3 }],
      });

      const result = await service.getAnalytics('user-1', 'campaign-1', { granularity: 'daily' });

      expect(result.conversionCount).toBe(11);
    });

    it('never buckets the trend before the campaign\'s own startDate (regression: off-by-one padded in an extra day)', async () => {
      prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, publishRecords: [] });

      const result = await service.getAnalytics('user-1', 'campaign-1', { granularity: 'daily' });

      const startDateKey = baseCampaign.startDate.toISOString().slice(0, 10);
      expect(result.engagementTrend[0].date >= startDateKey).toBe(true);
    });

    it('echoes back the requested granularity', async () => {
      prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, publishRecords: [] });

      const result = await service.getAnalytics('user-1', 'campaign-1', { granularity: 'weekly' });

      expect(result.granularity).toBe('weekly');
    });

    it('throws NotFoundException for a missing campaign', async () => {
      prisma.campaign.findUnique.mockResolvedValue(null);

      await expect(
        service.getAnalytics('user-1', 'missing', { granularity: 'daily' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('requires EDITOR+ and validates the resulting date range, reusing existing dates when omitted', async () => {
      prisma.campaign.findUnique.mockResolvedValue(baseCampaign);
      prisma.campaign.update.mockResolvedValue({ ...baseCampaign, name: 'Renamed', publishRecords: [] });

      const result = await service.update('user-1', 'campaign-1', { name: 'Renamed' });

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'EDITOR');
      expect(prisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'campaign-1' },
          data: expect.objectContaining({ name: 'Renamed' }),
        }),
      );
      expect(result.name).toBe('Renamed');
    });

    it('throws when the new date range is invalid', async () => {
      prisma.campaign.findUnique.mockResolvedValue(baseCampaign);

      await expect(
        service.update('user-1', 'campaign-1', { startDate: '2026-08-01T00:00:00Z' }),
      ).rejects.toThrow(BadRequestException); // new startDate is after the existing endDate
    });
  });

  describe('cancel', () => {
    it('requires ADMIN+, deletes SCHEDULED jobs, sets cancelledAt, and records an audit log entry', async () => {
      prisma.campaign.findUnique.mockResolvedValue(baseCampaign);
      prisma.campaign.update.mockResolvedValue({
        ...baseCampaign,
        cancelledAt: new Date('2026-07-15T00:00:00.000Z'),
        publishRecords: [],
      });

      const result = await service.cancel('admin-1', 'campaign-1');

      expect(access.assertMinRole).toHaveBeenCalledWith('admin-1', 'ws-1', 'ADMIN');
      expect(prisma.publishRecord.deleteMany).toHaveBeenCalledWith({
        where: { campaignId: 'campaign-1', status: PublishStatus.SCHEDULED },
      });
      expect(prisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'campaign-1' },
          data: { cancelledAt: expect.any(Date) },
        }),
      );
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'CAMPAIGN_CANCELLED' }),
      });
      expect(result.status).toBe(CampaignStatus.CANCELLED);
    });
  });

  describe('assertUsableForQueue', () => {
    it('resolves when the campaign belongs to the workspace and is not cancelled', async () => {
      prisma.campaign.findUnique.mockResolvedValue(baseCampaign);

      await expect(service.assertUsableForQueue('ws-1', 'campaign-1')).resolves.toBeUndefined();
    });

    it('throws NotFoundException when the campaign belongs to a different workspace', async () => {
      prisma.campaign.findUnique.mockResolvedValue(baseCampaign);

      await expect(service.assertUsableForQueue('other-ws', 'campaign-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the campaign is cancelled', async () => {
      prisma.campaign.findUnique.mockResolvedValue({ ...baseCampaign, cancelledAt: new Date() });

      await expect(service.assertUsableForQueue('ws-1', 'campaign-1')).rejects.toThrow(
        /is cancelled/,
      );
    });
  });
});
