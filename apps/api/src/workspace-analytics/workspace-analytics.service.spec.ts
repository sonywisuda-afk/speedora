import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { WorkspaceAnalyticsService } from './workspace-analytics.service';

function publishRecordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pr-1',
    campaignId: null,
    campaign: null,
    socialAccount: { platform: 'YOUTUBE' },
    statsSnapshots: [
      { viewCount: 100, likeCount: 10, commentCount: 2, shareCount: 1, engagementScore: 0.19 },
    ],
    clip: {
      hookText: 'A great hook',
      videoId: 'video-12345678',
      video: { ownerId: 'user-1', owner: { email: 'a@example.com' } },
    },
    ...overrides,
  };
}

describe('WorkspaceAnalyticsService', () => {
  let service: WorkspaceAnalyticsService;
  let prisma: {
    publishRecord: { findMany: jest.Mock };
    socialAccount: { findMany: jest.Mock };
  };
  let access: { assertMinRole: jest.Mock };

  beforeEach(() => {
    prisma = {
      publishRecord: { findMany: jest.fn().mockResolvedValue([]) },
      socialAccount: { findMany: jest.fn().mockResolvedValue([]) },
    };
    access = { assertMinRole: jest.fn().mockResolvedValue('OWNER') };
    service = new WorkspaceAnalyticsService(
      prisma as unknown as PrismaService,
      access as unknown as WorkspaceAccessService,
    );
  });

  describe('getLeaderboard', () => {
    it('checks workspace access before querying', async () => {
      await service.getLeaderboard('user-1', 'ws-1', {
        metric: 'views',
        days: 30,
        limit: 10,
      });

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
    });

    it('scopes the query to the given workspace via clip.video.workspaceId, in one call', async () => {
      await service.getLeaderboard('user-1', 'ws-1', {
        metric: 'views',
        days: 30,
        limit: 10,
      });

      expect(prisma.publishRecord.findMany).toHaveBeenCalledTimes(1);
      const call = prisma.publishRecord.findMany.mock.calls[0][0];
      expect(call.where.clip.video.workspaceId).toBe('ws-1');
    });

    it('echoes back the requested metric/days/limit', async () => {
      const result = await service.getLeaderboard('user-1', 'ws-1', {
        metric: 'likes',
        days: 90,
        limit: 5,
      });

      expect(result.metric).toBe('likes');
      expect(result.days).toBe(90);
      expect(result.limit).toBe(5);
    });

    it('computes all 4 leaderboard dimensions from the fetched records', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([
        publishRecordRow({ campaignId: 'camp-1', campaign: { name: 'Launch Week' } }),
      ]);

      const result = await service.getLeaderboard('user-1', 'ws-1', {
        metric: 'views',
        days: 30,
        limit: 10,
      });

      expect(result.topClips).toHaveLength(1);
      expect(result.topCreators).toHaveLength(1);
      expect(result.topCreators[0]).toMatchObject({ key: 'user-1', label: 'a@example.com' });
      expect(result.topCampaigns).toHaveLength(1);
      expect(result.topCampaigns[0]).toMatchObject({ key: 'camp-1', label: 'Launch Week' });
      expect(result.topPlatforms).toHaveLength(1);
      expect(result.topPlatforms[0]).toMatchObject({ key: 'YOUTUBE' });
    });

    it('falls back to a generic video label when hookText is null, same convention as AnalyticsService', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([
        publishRecordRow({ clip: { hookText: null, videoId: 'video-abcdefgh', video: publishRecordRow().clip.video } }),
      ]);

      const result = await service.getLeaderboard('user-1', 'ws-1', {
        metric: 'views',
        days: 30,
        limit: 10,
      });

      expect(result.topClips[0].label).toBe('Video video-ab');
    });

    it('returns empty leaderboards, not an error, for a workspace with no publishes', async () => {
      const result = await service.getLeaderboard('user-1', 'ws-1', {
        metric: 'views',
        days: 30,
        limit: 10,
      });

      expect(result.topClips).toEqual([]);
      expect(result.topCreators).toEqual([]);
      expect(result.topCampaigns).toEqual([]);
      expect(result.topPlatforms).toEqual([]);
    });

    it('propagates the access-check error rather than querying', async () => {
      access.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(
        service.getLeaderboard('user-1', 'ws-1', { metric: 'views', days: 30, limit: 10 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.publishRecord.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getFollowers', () => {
    it('checks workspace access before querying', async () => {
      await service.getFollowers('user-1', 'ws-1', 30);

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
    });

    it("scopes by 'any account belonging to a member of this workspace', not a workspaceId column on SocialAccount", async () => {
      await service.getFollowers('user-1', 'ws-1', 30);

      expect(prisma.socialAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user: { workspaceMemberships: { some: { workspaceId: 'ws-1' } } } },
        }),
      );
    });

    it('maps snapshot history the same way the owner-scoped endpoint does', async () => {
      prisma.socialAccount.findMany.mockResolvedValue([
        {
          id: 'account-1',
          platform: 'INSTAGRAM',
          displayName: 'Team IG',
          followerSnapshots: [
            { capturedAt: new Date('2026-07-05T00:00:00.000Z'), followerCount: 500 },
          ],
        },
      ]);

      const result = await service.getFollowers('user-1', 'ws-1', 30);

      expect(result.accounts[0].latestFollowerCount).toBe(500);
    });

    it('propagates the access-check error rather than querying', async () => {
      access.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.getFollowers('user-1', 'ws-1', 30)).rejects.toThrow(NotFoundException);
      expect(prisma.socialAccount.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getHeatmap', () => {
    it('checks workspace access before querying', async () => {
      await service.getHeatmap('user-1', 'ws-1', 30);

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
    });

    it('returns 168 zero-filled cells for a workspace with no published records', async () => {
      const result = await service.getHeatmap('user-1', 'ws-1', 30);

      expect(result.cells).toHaveLength(168);
      expect(result.cells.every((c) => c.publishCount === 0)).toBe(true);
    });

    it('buckets a real published record by its publishedAt day/hour', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([
        {
          publishedAt: new Date('2026-07-19T14:00:00.000Z'), // Sunday 14:00 UTC
          statsSnapshots: [{ viewCount: 100, engagementScore: 0.19 }],
        },
      ]);

      const result = await service.getHeatmap('user-1', 'ws-1', 30);

      const cell = result.cells.find((c) => c.dayOfWeek === 0 && c.hour === 14)!;
      expect(cell.publishCount).toBe(1);
      expect(cell.totalViews).toBe(100);
    });

    it('always reports retention/dropOff/replay as unavailable, honestly, in v1', async () => {
      const result = await service.getHeatmap('user-1', 'ws-1', 30);

      expect(result.retention.available).toBe(false);
      expect(result.dropOff.available).toBe(false);
      expect(result.replay.available).toBe(false);
    });

    it('propagates the access-check error rather than querying', async () => {
      access.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.getHeatmap('user-1', 'ws-1', 30)).rejects.toThrow(NotFoundException);
      expect(prisma.publishRecord.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getPredictionModel', () => {
    it('checks workspace access before querying', async () => {
      await service.getPredictionModel('user-1', 'ws-1');

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
    });

    it('reports hasEnoughSamples: false with the real count when the workspace has fewer than 20 usable pairs', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([
        { clip: { highlightScore: 50 }, statsSnapshots: [{ engagementScore: 0.1 }] },
      ]);

      const result = await service.getPredictionModel('user-1', 'ws-1');

      expect(result.hasEnoughSamples).toBe(false);
      expect(result.sampleCount).toBe(1);
      expect(result.minSamplesRequired).toBe(20);
      expect(result.correlation).toBeNull();
    });

    it('computes a real correlation once the workspace has >= 20 usable pairs', async () => {
      prisma.publishRecord.findMany.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          clip: { highlightScore: i * 4 },
          statsSnapshots: [{ engagementScore: 0.01 * (i * 4) + 0.05 }],
        })),
      );

      const result = await service.getPredictionModel('user-1', 'ws-1');

      expect(result.hasEnoughSamples).toBe(true);
      expect(result.sampleCount).toBe(20);
      expect(result.correlation).toBeCloseTo(1, 5);
    });

    it('excludes records missing highlightScore or engagementScore from the sample count', async () => {
      prisma.publishRecord.findMany.mockResolvedValue([
        { clip: { highlightScore: null }, statsSnapshots: [{ engagementScore: 0.1 }] },
        { clip: { highlightScore: 50 }, statsSnapshots: [] },
        { clip: { highlightScore: 50 }, statsSnapshots: [{ engagementScore: 0.2 }] },
      ]);

      const result = await service.getPredictionModel('user-1', 'ws-1');

      expect(result.sampleCount).toBe(1);
    });

    it('propagates the access-check error rather than querying', async () => {
      access.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.getPredictionModel('user-1', 'ws-1')).rejects.toThrow(NotFoundException);
      expect(prisma.publishRecord.findMany).not.toHaveBeenCalled();
    });
  });
});
