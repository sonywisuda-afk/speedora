import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CaptionStyle } from '@speedora/database';
import { QueueName } from '@speedora/shared';
import type { Queue } from 'bullmq';
import type { CampaignsService } from '../campaigns/campaigns.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RecurringSchedulesService } from '../recurring-schedules/recurring-schedules.service';
import type { SocialAccountsService } from '../social/social.service';
import type { StorageService } from '../storage/storage.service';
import type { WorkspaceAccessService } from '../workspace/workspace-access.service';
import { ClipsService } from './clips.service';

const PUBLISH_RECORDS_INCLUDE = {
  include: { publishRecords: { include: { socialAccount: true } } },
};

describe('ClipsService', () => {
  let service: ClipsService;
  let prisma: {
    clip: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    transcriptSegment: { findMany: jest.Mock };
    publishRecord: {
      create: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
    };
    clipVersion: {
      count: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    clipPlatformCopy: { create: jest.Mock; count: jest.Mock; findMany: jest.Mock };
    auditLogEntry: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let socialAccounts: { findOwnedOrThrow: jest.Mock };
  let storage: { deleteObjects: jest.Mock };
  let workspaceAccess: { assertMinRole: jest.Mock };
  let campaigns: { assertUsableForQueue: jest.Mock };
  let recurringSchedules: { resolveSlotForQueue: jest.Mock };
  let renderClipQueue: { add: jest.Mock };
  let publishClipQueue: { add: jest.Mock };
  let generatePlatformCopyQueue: { add: jest.Mock };

  beforeEach(() => {
    prisma = {
      clip: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn().mockResolvedValue({}) },
      transcriptSegment: { findMany: jest.fn() },
      publishRecord: {
        create: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Sprint 5E (Version Compare & History).
      clipVersion: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      // Publishing Expansion Phase 7B (AI SEO).
      clipPlatformCopy: {
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn(),
      },
      auditLogEntry: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    socialAccounts = { findOwnedOrThrow: jest.fn() };
    storage = { deleteObjects: jest.fn().mockResolvedValue(undefined) };
    // Default: access granted - WorkspaceAccessService has its own
    // dedicated spec for role-rank logic; this file only verifies
    // ClipsService's own orchestration around it.
    workspaceAccess = { assertMinRole: jest.fn().mockResolvedValue('OWNER') };
    campaigns = { assertUsableForQueue: jest.fn().mockResolvedValue(undefined) };
    recurringSchedules = { resolveSlotForQueue: jest.fn() };
    renderClipQueue = { add: jest.fn() };
    publishClipQueue = { add: jest.fn() };
    generatePlatformCopyQueue = { add: jest.fn() };
    service = new ClipsService(
      prisma as unknown as PrismaService,
      socialAccounts as unknown as SocialAccountsService,
      storage as unknown as StorageService,
      workspaceAccess as unknown as WorkspaceAccessService,
      campaigns as unknown as CampaignsService,
      recurringSchedules as unknown as RecurringSchedulesService,
      renderClipQueue as unknown as Queue,
      publishClipQueue as unknown as Queue,
      generatePlatformCopyQueue as unknown as Queue,
    );
  });

  describe('findRenderedOrThrow', () => {
    it('returns the clip when it belongs to the requester and has finished rendering', async () => {
      const clip = {
        id: 'clip-1',
        outputUrl: 'renders/clip-1.mp4',
        video: { ownerId: 'user-1' },
      };
      prisma.clip.findUnique.mockResolvedValue(clip);

      const result = await service.findRenderedOrThrow('clip-1', 'user-1');

      expect(result).toBe(clip);
    });

    it('throws NotFoundException when the clip does not exist', async () => {
      prisma.clip.findUnique.mockResolvedValue(null);

      await expect(service.findRenderedOrThrow('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        outputUrl: 'renders/clip-1.mp4',
        video: { workspaceId: 'ws-1' },
      });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.findRenderedOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the clip has not finished rendering yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        outputUrl: null,
        video: { ownerId: 'user-1' },
      });

      await expect(service.findRenderedOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findThumbnailOrThrow', () => {
    it('returns the thumbnailUrl when the clip belongs to the requester and has one', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        thumbnailUrl: 'thumbnails/clip-1.jpg',
        video: { ownerId: 'user-1' },
      });

      const result = await service.findThumbnailOrThrow('clip-1', 'user-1');

      expect(result).toEqual({ thumbnailUrl: 'thumbnails/clip-1.jpg' });
    });

    it('throws NotFoundException when no thumbnail has been extracted yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        thumbnailUrl: null,
        video: { ownerId: 'user-1' },
      });

      await expect(service.findThumbnailOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        thumbnailUrl: 'thumbnails/clip-1.jpg',
        video: { workspaceId: 'ws-1' },
      });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.findThumbnailOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAnimatedThumbnailOrThrow', () => {
    it('returns the animatedThumbnailUrl when the clip belongs to the requester and has one', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        animatedThumbnailUrl: 'animated-thumbnails/clip-1.webp',
        video: { ownerId: 'user-1' },
      });

      const result = await service.findAnimatedThumbnailOrThrow('clip-1', 'user-1');

      expect(result).toEqual({ animatedThumbnailUrl: 'animated-thumbnails/clip-1.webp' });
    });

    it('throws NotFoundException when no animated thumbnail has been extracted yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        animatedThumbnailUrl: null,
        video: { ownerId: 'user-1' },
      });

      await expect(service.findAnimatedThumbnailOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        animatedThumbnailUrl: 'animated-thumbnails/clip-1.webp',
        video: { workspaceId: 'ws-1' },
      });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.findAnimatedThumbnailOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findHoverPreviewOrThrow', () => {
    it('returns the hoverPreviewUrl when the clip belongs to the requester and has one', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        hoverPreviewUrl: 'hover-previews/clip-1.webp',
        video: { ownerId: 'user-1' },
      });

      const result = await service.findHoverPreviewOrThrow('clip-1', 'user-1');

      expect(result).toEqual({ hoverPreviewUrl: 'hover-previews/clip-1.webp' });
    });

    it('throws NotFoundException when no hover preview has been extracted yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        hoverPreviewUrl: null,
        video: { ownerId: 'user-1' },
      });

      await expect(service.findHoverPreviewOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        hoverPreviewUrl: 'hover-previews/clip-1.webp',
        video: { workspaceId: 'ws-1' },
      });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.findHoverPreviewOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findStoryboardFrameOrThrow', () => {
    it('returns the raw key at the requested index', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        storyboardFrameUrls: ['storyboards/clip-1-0.webp', 'storyboards/clip-1-1.webp'],
        video: { ownerId: 'user-1' },
      });

      const result = await service.findStoryboardFrameOrThrow('clip-1', 'user-1', 1);

      expect(result).toEqual({ frameKey: 'storyboards/clip-1-1.webp' });
    });

    it('throws NotFoundException when the index is out of range', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        storyboardFrameUrls: ['storyboards/clip-1-0.webp'],
        video: { ownerId: 'user-1' },
      });

      await expect(service.findStoryboardFrameOrThrow('clip-1', 'user-1', 5)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when no storyboard has been extracted yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        storyboardFrameUrls: null,
        video: { ownerId: 'user-1' },
      });

      await expect(service.findStoryboardFrameOrThrow('clip-1', 'user-1', 0)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        storyboardFrameUrls: ['storyboards/clip-1-0.webp'],
        video: { workspaceId: 'ws-1' },
      });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.findStoryboardFrameOrThrow('clip-1', 'user-1', 0)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getExplainability', () => {
    const clip = {
      id: 'clip-1',
      video: { ownerId: 'user-1' },
      highlightScore: 74,
      highlightConfidence: 0.82,
      highlightReason: 'Strong hook and high energy throughout.',
      highlightBreakdown: [
        {
          signal: 'audio',
          feature: 'averageRmsDb',
          rawValue: -18,
          normalizedValue: 0.7,
          weight: 0.35,
          weightedContribution: 0.245,
        },
      ],
      highlightExplainability: {
        topFactors: [
          {
            signal: 'audio',
            feature: 'averageRmsDb',
            weightedContribution: 0.245,
            description: 'Loud, energetic audio',
          },
        ],
      },
      highlightPrediction: {
        bucket: 'likely_high_performer',
        rationale: 'Score of 74 with 82% confidence suggests strong potential.',
      },
      highlightRecommendation: {
        action: 'publish_as_is',
        message: 'This clip scores well - ready to publish as-is.',
      },
      highlightRank: 1,
    };

    it("returns a single v2 result mapped from the clip's Fusion Engine fields", async () => {
      prisma.clip.findUnique.mockResolvedValue(clip);

      const result = await service.getExplainability('clip-1', 'user-1');

      expect(result).toEqual({
        clipId: 'clip-1',
        results: [
          {
            engine: 'v2',
            highlightScore: 74,
            highlightConfidence: 0.82,
            highlightReason: 'Strong hook and high energy throughout.',
            highlightBreakdown: clip.highlightBreakdown,
            highlightExplainability: clip.highlightExplainability,
            highlightPrediction: clip.highlightPrediction,
            highlightRecommendation: clip.highlightRecommendation,
            highlightRank: 1,
          },
        ],
      });
    });

    it('defaults highlightBreakdown/highlightExplainability when null, same as toDto', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        ...clip,
        highlightBreakdown: null,
        highlightExplainability: null,
        highlightPrediction: null,
        highlightRecommendation: null,
      });

      const result = await service.getExplainability('clip-1', 'user-1');

      expect(result.results[0].highlightBreakdown).toEqual([]);
      expect(result.results[0].highlightExplainability).toEqual({ topFactors: [] });
      expect(result.results[0].highlightPrediction).toBeNull();
      expect(result.results[0].highlightRecommendation).toBeNull();
    });

    it('throws NotFoundException when the clip does not exist', async () => {
      prisma.clip.findUnique.mockResolvedValue(null);

      await expect(service.getExplainability('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue({ ...clip, video: { workspaceId: 'ws-1' } });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.getExplainability('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getPerformance', () => {
    const clipWithPerformance = {
      id: 'clip-1',
      videoId: 'video-1',
      video: { workspaceId: 'ws-1', ownerId: 'owner-1' },
      highlightScore: 74,
      highlightConfidence: 0.82,
      highlightReason: 'Strong hook and high energy throughout.',
      highlightBreakdown: null,
      highlightExplainability: null,
      highlightPrediction: null,
      highlightRecommendation: null,
      highlightRank: 1,
      publishRecords: [
        {
          id: 'pr-1',
          status: 'PUBLISHED',
          publishedAt: new Date('2026-01-05T00:00:00.000Z'),
          scheduledAt: null,
          socialAccount: { platform: 'YOUTUBE' },
          campaign: { id: 'campaign-1', name: 'Launch Week' },
          recurringSchedule: null,
          trackedLinks: [],
          statsSnapshots: [
            {
              capturedAt: new Date('2026-01-05T06:00:00.000Z'),
              viewCount: 100,
              likeCount: 10,
              commentCount: 2,
              shareCount: 1,
              watchTimeSeconds: null,
              engagementScore: 0.19,
            },
            {
              capturedAt: new Date('2026-01-06T06:00:00.000Z'),
              viewCount: 500,
              likeCount: 50,
              commentCount: 5,
              shareCount: 3,
              watchTimeSeconds: null,
              engagementScore: 0.236,
            },
          ],
        },
      ],
    };

    it('fetches the clip and its performance graph in a single query', async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);

      await service.getPerformance('clip-1', 'user-1');

      expect(prisma.clip.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.clip.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'clip-1' } }),
      );
    });

    it('checks workspace access against the fetched clip', async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);

      await service.getPerformance('clip-1', 'user-1');

      expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'VIEWER');
    });

    it("maps each PublishRecord's full stats history into performance, oldest first", async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);

      const result = await service.getPerformance('clip-1', 'user-1');

      expect(result.performance).toHaveLength(1);
      const series = result.performance[0];
      expect(series.publishRecordId).toBe('pr-1');
      expect(series.platform).toBe('YOUTUBE');
      expect(series.history).toHaveLength(2);
      expect(series.history[0].viewCount).toBe(100);
      expect(series.history[1].viewCount).toBe(500);
    });

    it('reflects the same real numbers a dashboard reading the same snapshot would show - no recomputation', async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);

      const result = await service.getPerformance('clip-1', 'user-1');

      const latest = result.performance[0].history[1];
      expect(latest.engagementScore).toBe(0.236);
      expect(latest.likeCount).toBe(50);
      expect(latest.shareCount).toBe(3);
    });

    it('surfaces campaign/recurringSchedule as independent, non-mutually-exclusive fields in traffic', async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);

      const result = await service.getPerformance('clip-1', 'user-1');

      expect(result.traffic).toHaveLength(1);
      expect(result.traffic[0].campaign).toEqual({ id: 'campaign-1', name: 'Launch Week' });
      expect(result.traffic[0].recurringSchedule).toBeNull();
    });

    it("reuses the same score mapping getExplainability uses, so the two endpoints can't drift", async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);

      const result = await service.getPerformance('clip-1', 'user-1');

      expect(result.score).toEqual([
        {
          engine: 'v2',
          highlightScore: 74,
          highlightConfidence: 0.82,
          highlightReason: 'Strong hook and high energy throughout.',
          highlightBreakdown: [],
          highlightExplainability: { topFactors: [] },
          highlightPrediction: null,
          highlightRecommendation: null,
          highlightRank: 1,
        },
      ]);
    });

    it('always reports audience as unavailable, honestly, in v1', async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);

      const result = await service.getPerformance('clip-1', 'user-1');

      expect(result.audience.available).toBe(false);
      expect(result.audience.reason).toBeTruthy();
    });

    it('reports conversionCount: null when no TrackedLink exists for a publish record - never a fabricated 0', async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);

      const result = await service.getPerformance('clip-1', 'user-1');

      expect(result.traffic[0].conversionCount).toBeNull();
    });

    it('sums real clickCount across every TrackedLink attached to a publish record', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        ...clipWithPerformance,
        publishRecords: [
          {
            ...clipWithPerformance.publishRecords[0],
            trackedLinks: [{ clickCount: 12 }, { clickCount: 5 }],
          },
        ],
      });

      const result = await service.getPerformance('clip-1', 'user-1');

      expect(result.traffic[0].conversionCount).toBe(17);
    });

    it("queries the owner's OTHER published clips for the insight baseline, excluding this clip", async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);

      await service.getPerformance('clip-1', 'user-1');

      expect(prisma.publishRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PUBLISHED',
            clipId: { not: 'clip-1' },
            clip: { video: { ownerId: 'owner-1' } },
          }),
        }),
      );
    });

    it("reports 'not_enough_data' when the owner has too little publish history to compare against", async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);
      prisma.publishRecord.findMany.mockResolvedValue([]);

      const result = await service.getPerformance('clip-1', 'user-1');

      expect(result.insight.classification).toBe('not_enough_data');
      expect(result.insight.comparedAgainst).toBe(0);
    });

    it("classifies against a real historical baseline built from the owner's other clips' latest snapshots", async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);
      // This clip's own latest engagementScore is 0.236 (from clipWithPerformance's
      // fixture history) - a baseline well below that should classify as over-performed.
      prisma.publishRecord.findMany.mockResolvedValue([
        { clip: { highlightScore: 40 }, statsSnapshots: [{ engagementScore: 0.05 }] },
        { clip: { highlightScore: 42 }, statsSnapshots: [{ engagementScore: 0.04 }] },
        { clip: { highlightScore: 38 }, statsSnapshots: [{ engagementScore: 0.06 }] },
        { clip: { highlightScore: 41 }, statsSnapshots: [{ engagementScore: 0.05 }] },
        { clip: { highlightScore: 39 }, statsSnapshots: [{ engagementScore: 0.04 }] },
      ]);

      const result = await service.getPerformance('clip-1', 'user-1');

      expect(result.insight.classification).toBe('over_performed');
      expect(result.insight.comparedAgainst).toBe(5);
    });

    it("reports prediction.available: false when the owner has fewer than 20 other published clips", async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);
      prisma.publishRecord.findMany.mockResolvedValue([
        { clip: { highlightScore: 40 }, statsSnapshots: [{ engagementScore: 0.05 }] },
      ]);

      const result = await service.getPerformance('clip-1', 'user-1');

      expect(result.insight.prediction.available).toBe(false);
      expect(result.insight.prediction.sampleCount).toBe(1);
      expect(result.insight.prediction.minSamplesRequired).toBe(20);
    });

    it('produces a real prediction from >= 20 correlated (highlightScore, engagementScore) pairs', async () => {
      prisma.clip.findUnique.mockResolvedValue({ ...clipWithPerformance, highlightScore: 76 });
      prisma.publishRecord.findMany.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          clip: { highlightScore: i * 4 },
          statsSnapshots: [{ engagementScore: 0.01 * (i * 4) + 0.05 }],
        })),
      );

      const result = await service.getPerformance('clip-1', 'user-1');

      expect(result.insight.prediction.available).toBe(true);
      expect(result.insight.prediction.correlation).toBeCloseTo(1, 5);
      // engagementScore = 0.01 * 76 + 0.05 = 0.81
      expect(result.insight.prediction.predictedEngagementScore).toBeCloseTo(0.81, 5);
    });

    it('excludes records with a null highlightScore from the prediction pairs, but still counts them for the narrative baseline', async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);
      prisma.publishRecord.findMany.mockResolvedValue([
        { clip: { highlightScore: null }, statsSnapshots: [{ engagementScore: 0.05 }] },
        { clip: { highlightScore: 40 }, statsSnapshots: [{ engagementScore: 0.05 }] },
        { clip: { highlightScore: 42 }, statsSnapshots: [{ engagementScore: 0.04 }] },
        { clip: { highlightScore: 38 }, statsSnapshots: [{ engagementScore: 0.06 }] },
      ]);

      const result = await service.getPerformance('clip-1', 'user-1');

      // The narrative baseline (engagementScore-only) still counts all 4.
      expect(result.insight.comparedAgainst).toBe(4);
      // The prediction baseline (highlightScore, engagementScore) only has 3
      // usable pairs - well below the 20 minimum either way, but exercises
      // that the null-highlightScore record was excluded, not crashed on.
      expect(result.insight.prediction.sampleCount).toBe(3);
    });

    it('has exactly the 5 documented sections - insight is the only deliberate cross-clip comparison', async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);

      const result = await service.getPerformance('clip-1', 'user-1');

      expect(result.clipId).toBe('clip-1');
      expect(result.videoId).toBe('video-1');
      expect(Object.keys(result).sort()).toEqual(
        ['audience', 'clipId', 'insight', 'performance', 'score', 'traffic', 'videoId'].sort(),
      );
    });

    it('throws NotFoundException when the clip does not exist', async () => {
      prisma.clip.findUnique.mockResolvedValue(null);

      await expect(service.getPerformance('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue(clipWithPerformance);
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.getPerformance('clip-1', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPlatformFit', () => {
    const scores = {
      hookStrength: 90,
      educationalValue: 10,
      practicalValue: 10,
      curiosity: 80,
      emotion: 20,
      storytelling: 20,
      novelty: 30,
      trustAuthority: 10,
      ctaStrength: 10,
    };
    const clip = { id: 'clip-1', video: { ownerId: 'user-1' }, scores };

    it('ranks all 8 platforms, sorted descending, for a clip with scores', async () => {
      prisma.clip.findUnique.mockResolvedValue(clip);

      const result = await service.getPlatformFit('clip-1', 'user-1');

      expect(result.clipId).toBe('clip-1');
      expect(result.rankings).toHaveLength(8);
      for (let i = 1; i < result.rankings.length; i++) {
        expect(result.rankings[i - 1].score).toBeGreaterThanOrEqual(result.rankings[i].score);
      }
      // hookStrength/curiosity-heavy scores should favor TikTok over LinkedIn.
      const rank = (platform: string) => result.rankings.findIndex((r) => r.platform === platform);
      expect(rank('TIKTOK')).toBeLessThan(rank('LINKEDIN'));
    });

    it('returns empty rankings when the clip has no scores yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({ ...clip, scores: null });

      const result = await service.getPlatformFit('clip-1', 'user-1');

      expect(result).toEqual({ clipId: 'clip-1', rankings: [] });
    });

    it('throws NotFoundException when the clip does not exist', async () => {
      prisma.clip.findUnique.mockResolvedValue(null);

      await expect(service.getPlatformFit('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue({ ...clip, video: { workspaceId: 'ws-1' } });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.getPlatformFit('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('generatePlatformCopy', () => {
    const clip = { id: 'clip-1', video: { workspaceId: 'ws-1' }, hookText: 'Wait for it' };

    it('creates a new row and enqueues the LLM generation job', async () => {
      prisma.clip.findUnique.mockResolvedValue(clip);
      prisma.clipPlatformCopy.create.mockResolvedValue({
        id: 'copy-1',
        clipId: 'clip-1',
        platform: 'TIKTOK',
        status: 'PENDING',
        caption: null,
        hashtags: [],
        description: null,
        failReason: null,
        createdAt: new Date('2026-07-19T00:00:00Z'),
      });

      const result = await service.generatePlatformCopy('clip-1', 'user-1', 'TIKTOK' as never);

      expect(workspaceAccess.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'EDITOR');
      expect(prisma.clipPlatformCopy.create).toHaveBeenCalledWith({
        data: { clipId: 'clip-1', platform: 'TIKTOK' },
      });
      expect(generatePlatformCopyQueue.add).toHaveBeenCalledWith(QueueName.GENERATE_PLATFORM_COPY, {
        clipPlatformCopyId: 'copy-1',
      });
      expect(result).toEqual(
        expect.objectContaining({ id: 'copy-1', clipId: 'clip-1', status: 'PENDING' }),
      );
    });

    it('throws BadRequestException when the clip has no hookText yet, and does not enqueue', async () => {
      prisma.clip.findUnique.mockResolvedValue({ ...clip, hookText: null });

      await expect(
        service.generatePlatformCopy('clip-1', 'user-1', 'TIKTOK' as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.clipPlatformCopy.create).not.toHaveBeenCalled();
      expect(generatePlatformCopyQueue.add).not.toHaveBeenCalled();
    });

    it('throws BadRequestException at the daily rate cap, and does not enqueue', async () => {
      prisma.clip.findUnique.mockResolvedValue(clip);
      prisma.clipPlatformCopy.count.mockResolvedValue(5);

      await expect(
        service.generatePlatformCopy('clip-1', 'user-1', 'TIKTOK' as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.clipPlatformCopy.create).not.toHaveBeenCalled();
      expect(generatePlatformCopyQueue.add).not.toHaveBeenCalled();
    });

    it('allows generating when under the daily rate cap', async () => {
      prisma.clip.findUnique.mockResolvedValue(clip);
      prisma.clipPlatformCopy.count.mockResolvedValue(4);
      prisma.clipPlatformCopy.create.mockResolvedValue({
        id: 'copy-2',
        clipId: 'clip-1',
        platform: 'TIKTOK',
        status: 'PENDING',
        caption: null,
        hashtags: [],
        description: null,
        failReason: null,
        createdAt: new Date('2026-07-19T00:00:00Z'),
      });

      await service.generatePlatformCopy('clip-1', 'user-1', 'TIKTOK' as never);

      expect(generatePlatformCopyQueue.add).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue({ ...clip, video: { workspaceId: 'ws-1' } });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(
        service.generatePlatformCopy('clip-1', 'user-1', 'TIKTOK' as never),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.clipPlatformCopy.create).not.toHaveBeenCalled();
    });
  });

  describe('listPlatformCopies', () => {
    const clip = { id: 'clip-1', video: { ownerId: 'user-1' } };

    it('returns every row for the clip, newest first', async () => {
      prisma.clip.findUnique.mockResolvedValue(clip);
      const rows = [
        {
          id: 'copy-2',
          clipId: 'clip-1',
          platform: 'TIKTOK',
          status: 'READY',
          caption: 'a',
          hashtags: ['x'],
          description: null,
          failReason: null,
          createdAt: new Date('2026-07-19T01:00:00Z'),
        },
        {
          id: 'copy-1',
          clipId: 'clip-1',
          platform: 'TIKTOK',
          status: 'FAILED',
          caption: null,
          hashtags: [],
          description: null,
          failReason: 'boom',
          createdAt: new Date('2026-07-19T00:00:00Z'),
        },
      ];
      prisma.clipPlatformCopy.findMany.mockResolvedValue(rows);

      const result = await service.listPlatformCopies('clip-1', 'user-1');

      expect(prisma.clipPlatformCopy.findMany).toHaveBeenCalledWith({
        where: { clipId: 'clip-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result.copies).toHaveLength(2);
      expect(result.copies[0].id).toBe('copy-2');
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue({ ...clip, video: { workspaceId: 'ws-1' } });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.listPlatformCopies('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const existingClip = {
      id: 'clip-1',
      videoId: 'video-1',
      startTime: 10,
      endTime: 20,
      viralityScore: 80,
      outputUrl: 'renders/clip-1.mp4',
      captionStyle: 'DEFAULT',
      hookText: 'Wait for it...',
      hashtags: ['viral', 'fyp'],
      scores: null,
      reason: null,
      topics: [],
      keywords: [],
      intent: null,
      ctaText: null,
      publishRecords: [],
      updatedAt: new Date('2026-01-01'),
      video: { ownerId: 'user-1' },
    };

    it('passes thumbnailBlurDataUrl through unchanged (already client-safe, not a storage key)', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue({
        ...existingClip,
        startTime: 12,
        endTime: 22,
        thumbnailBlurDataUrl: 'data:image/webp;base64,Zm9v',
      });

      const result = await service.update('clip-1', 'user-1', { startTime: 12, endTime: 22 });

      expect(result.thumbnailBlurDataUrl).toBe('data:image/webp;base64,Zm9v');
    });

    it('updates startTime and endTime and returns a downloadUrl-mapped dto', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue({ ...existingClip, startTime: 12, endTime: 22 });

      const result = await service.update('clip-1', 'user-1', { startTime: 12, endTime: 22 });

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: {
          startTime: 12,
          endTime: 22,
          captionStyle: 'DEFAULT',
          hookText: 'Wait for it...',
          hashtags: ['viral', 'fyp'],
        },
        ...PUBLISH_RECORDS_INCLUDE,
      });
      expect(result).toEqual({
        id: 'clip-1',
        videoId: 'video-1',
        startTime: 12,
        endTime: 22,
        viralityScore: 80,
        downloadUrl: '/clips/clip-1/download',
        thumbnailUrl: null,
        animatedThumbnailUrl: null,
        hoverPreviewUrl: null,
        storyboardFrameUrls: [],
        captionStyle: 'DEFAULT',
        hookText: 'Wait for it...',
        hashtags: ['viral', 'fyp'],
        scores: null,
        reason: null,
        topics: [],
        keywords: [],
        intent: null,
        ctaText: null,
        facialEmotions: null,
        sceneCutEvents: null,
        motionEnergy: [],
        motionEnergyFeatures: null,
        cameraMotion: null,
        cameraMotionFeatures: null,
        editingRhythmFeatures: null,
        audioFeatures: null,
        sceneFeatures: null,
        facialFeatures: null,
        gestures: null,
        gestureFeatures: null,
        faceLandmarks: null,
        faceLandmarkFeatures: null,
        trackingQualityMetrics: null,
        activeSpeakerSamples: null,
        speakerFaceAssociations: null,
        lipSyncVerifications: null,
        speakerTimeline: null,
        speakerTimelineFeatures: null,
        speakerConfidenceScores: null,
        speakerEngagementScores: null,
        speakerImportanceScores: null,
        speakerHighlightMoments: null,
        ocrText: null,
        ocrTracks: null,
        ocrFeatures: null,
        objects: null,
        objectTracks: null,
        objectFeatures: null,
        highlightBreakdown: [],
        highlightExplainability: { topFactors: [] },
        llmFeatures: null,
        highlightPrediction: null,
        highlightRecommendation: null,
        compositionFeatures: null,
        thumbnailSelectionTimestamp: undefined,
        thumbnailSelectionBreakdown: null,
        thumbnailSelectionFallback: undefined,
        thumbnailSelectionReason: undefined,
        publishRecords: [],
        updatedAt: existingClip.updatedAt,
      });
    });

    it('allows updating just one field, validating against the other current value', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue({ ...existingClip, endTime: 25 });

      await service.update('clip-1', 'user-1', { endTime: 25 });

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: {
          startTime: 10,
          endTime: 25,
          captionStyle: 'DEFAULT',
          hookText: 'Wait for it...',
          hashtags: ['viral', 'fyp'],
        },
        ...PUBLISH_RECORDS_INCLUDE,
      });
    });

    it('updates captionStyle independently of startTime/endTime', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue({ ...existingClip, captionStyle: 'KARAOKE' });

      await service.update('clip-1', 'user-1', { captionStyle: CaptionStyle.KARAOKE });

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: {
          startTime: 10,
          endTime: 20,
          captionStyle: 'KARAOKE',
          hookText: 'Wait for it...',
          hashtags: ['viral', 'fyp'],
        },
        ...PUBLISH_RECORDS_INCLUDE,
      });
    });

    it('updates hookText and hashtags independently of startTime/endTime/captionStyle', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue({
        ...existingClip,
        hookText: 'New hook',
        hashtags: ['newtag'],
      });

      await service.update('clip-1', 'user-1', { hookText: 'New hook', hashtags: ['newtag'] });

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: {
          startTime: 10,
          endTime: 20,
          captionStyle: 'DEFAULT',
          hookText: 'New hook',
          hashtags: ['newtag'],
        },
        ...PUBLISH_RECORDS_INCLUDE,
      });
    });

    it('sanitizes hashtags (strips leading "#" and blanks) on manual edit, same as detect-clips', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue(existingClip);

      await service.update('clip-1', 'user-1', { hashtags: ['#viral', ' fyp ', '', '#foryou'] });

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: expect.objectContaining({ hashtags: ['viral', 'fyp', 'foryou'] }),
        ...PUBLISH_RECORDS_INCLUDE,
      });
    });

    it('throws BadRequestException when startTime would not be before endTime', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);

      await expect(service.update('clip-1', 'user-1', { startTime: 25 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.clip.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        ...existingClip,
        video: { workspaceId: 'ws-1' },
      });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.update('clip-1', 'user-1', { startTime: 12 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('render', () => {
    const clip = {
      id: 'clip-1',
      videoId: 'video-1',
      startTime: 10,
      endTime: 20,
      viralityScore: 80,
      outputUrl: 'renders/clip-1.mp4',
      captionStyle: CaptionStyle.KARAOKE,
      hookText: 'Wait for it...',
      hashtags: ['viral', 'fyp'],
      scores: null,
      reason: null,
      topics: [],
      keywords: [],
      intent: null,
      ctaText: null,
      publishRecords: [],
      updatedAt: new Date('2026-01-01'),
      video: { ownerId: 'user-1', sourceUrl: 'videos/abc.mp4' },
    };

    it('clears outputUrl, enqueues render-clip with the recomputed transcript and captionStyle, and returns the cleared dto', async () => {
      prisma.clip.findUnique.mockResolvedValue(clip);
      const segments = [
        { start: 0, end: 5, text: 'before', words: null },
        { start: 12, end: 18, text: 'inside', words: [{ word: 'inside', start: 12, end: 12.5 }] },
      ];
      prisma.transcriptSegment.findMany.mockResolvedValue(segments);
      const cleared = { ...clip, outputUrl: null, updatedAt: new Date('2026-01-02') };
      prisma.clip.update.mockResolvedValue(cleared);

      const result = await service.render('clip-1', 'user-1');

      // Sprint 5E (Version Compare & History) - the pre-render state is
      // snapshotted before the live row is cleared.
      expect(prisma.clipVersion.count).toHaveBeenCalledWith({ where: { clipId: 'clip-1' } });
      expect(prisma.clipVersion.create).toHaveBeenCalledWith({
        data: {
          clipId: 'clip-1',
          versionNumber: 1,
          startTime: 10,
          endTime: 20,
          outputUrl: 'renders/clip-1.mp4',
          outputSizeBytes: undefined,
          thumbnailUrl: undefined,
          captionStyle: CaptionStyle.KARAOKE,
          hookText: 'Wait for it...',
          hashtags: ['viral', 'fyp'],
          viralityScore: 80,
          createdById: 'user-1',
        },
      });
      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: { outputUrl: null },
        ...PUBLISH_RECORDS_INCLUDE,
      });
      expect(renderClipQueue.add).toHaveBeenCalledWith(QueueName.RENDER_CLIP, {
        clipId: 'clip-1',
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        startTime: 10,
        endTime: 20,
        transcript: [
          {
            start: 12,
            end: 18,
            text: 'inside',
            words: [{ word: 'inside', start: 12, end: 12.5 }],
          },
        ],
        captionStyle: CaptionStyle.KARAOKE,
        keywords: [],
        scores: null,
      });
      expect(result).toEqual({
        id: 'clip-1',
        videoId: 'video-1',
        startTime: 10,
        endTime: 20,
        viralityScore: 80,
        downloadUrl: null,
        thumbnailUrl: null,
        animatedThumbnailUrl: null,
        hoverPreviewUrl: null,
        storyboardFrameUrls: [],
        captionStyle: CaptionStyle.KARAOKE,
        hookText: 'Wait for it...',
        hashtags: ['viral', 'fyp'],
        scores: null,
        reason: null,
        topics: [],
        keywords: [],
        intent: null,
        ctaText: null,
        facialEmotions: null,
        sceneCutEvents: null,
        motionEnergy: [],
        motionEnergyFeatures: null,
        cameraMotion: null,
        cameraMotionFeatures: null,
        editingRhythmFeatures: null,
        audioFeatures: null,
        sceneFeatures: null,
        facialFeatures: null,
        gestures: null,
        gestureFeatures: null,
        faceLandmarks: null,
        faceLandmarkFeatures: null,
        trackingQualityMetrics: null,
        activeSpeakerSamples: null,
        speakerFaceAssociations: null,
        lipSyncVerifications: null,
        speakerTimeline: null,
        speakerTimelineFeatures: null,
        speakerConfidenceScores: null,
        speakerEngagementScores: null,
        speakerImportanceScores: null,
        speakerHighlightMoments: null,
        ocrText: null,
        ocrTracks: null,
        ocrFeatures: null,
        objects: null,
        objectTracks: null,
        objectFeatures: null,
        highlightBreakdown: [],
        highlightExplainability: { topFactors: [] },
        llmFeatures: null,
        highlightPrediction: null,
        highlightRecommendation: null,
        compositionFeatures: null,
        thumbnailSelectionTimestamp: undefined,
        thumbnailSelectionBreakdown: null,
        thumbnailSelectionFallback: undefined,
        thumbnailSelectionReason: undefined,
        publishRecords: [],
        updatedAt: cleared.updatedAt,
      });
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        ...clip,
        video: { ...clip.video, workspaceId: 'ws-1' },
      });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.render('clip-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(renderClipQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('listVersions / restoreVersion / version download+thumbnail (Sprint 5E)', () => {
    const ownedClip = { id: 'clip-1', video: { ownerId: 'user-1' } };
    const versionRow = {
      id: 'version-1',
      clipId: 'clip-1',
      versionNumber: 1,
      startTime: 5,
      endTime: 15,
      outputUrl: 'renders/clip-1-v1.mp4',
      outputSizeBytes: 1000,
      thumbnailUrl: 'thumbnails/clip-1-v1.webp',
      captionStyle: CaptionStyle.DEFAULT,
      hookText: 'old hook',
      hashtags: ['old'],
      viralityScore: 70,
      createdAt: new Date('2026-01-01'),
      createdBy: { email: 'editor@example.com' },
    };

    describe('listVersions', () => {
      it('requires VIEWER+ access and maps versions to DTOs newest-first', async () => {
        prisma.clip.findUnique.mockResolvedValue(ownedClip);
        prisma.clipVersion.findMany.mockResolvedValue([versionRow]);

        const result = await service.listVersions('user-1', 'clip-1');

        expect(prisma.clipVersion.findMany).toHaveBeenCalledWith({
          where: { clipId: 'clip-1' },
          orderBy: { versionNumber: 'desc' },
          include: { createdBy: { select: { email: true } } },
        });
        expect(result.versions[0]).toMatchObject({
          id: 'version-1',
          versionNumber: 1,
          downloadUrl: '/clips/clip-1/versions/version-1/download',
          thumbnailUrl: '/clips/clip-1/versions/version-1/thumbnail',
          createdByEmail: 'editor@example.com',
        });
      });
    });

    describe('restoreVersion', () => {
      it('copies trim/caption/hook/hashtags back onto the live clip, not outputUrl', async () => {
        prisma.clip.findUnique.mockResolvedValue(ownedClip);
        prisma.clipVersion.findUnique.mockResolvedValue(versionRow);
        prisma.clip.update.mockResolvedValue({ ...ownedClip, publishRecords: [] });

        await service.restoreVersion('user-1', 'clip-1', 'version-1');

        expect(prisma.clip.update).toHaveBeenCalledWith({
          where: { id: 'clip-1' },
          data: {
            startTime: 5,
            endTime: 15,
            captionStyle: CaptionStyle.DEFAULT,
            hookText: 'old hook',
            hashtags: ['old'],
          },
          ...PUBLISH_RECORDS_INCLUDE,
        });
      });

      it('throws NotFoundException when the version does not belong to this clip', async () => {
        prisma.clip.findUnique.mockResolvedValue(ownedClip);
        prisma.clipVersion.findUnique.mockResolvedValue({ ...versionRow, clipId: 'other-clip' });

        await expect(service.restoreVersion('user-1', 'clip-1', 'version-1')).rejects.toThrow(
          NotFoundException,
        );
      });
    });

    describe('getVersionOutputOrThrow', () => {
      it('returns the raw output key when present', async () => {
        prisma.clip.findUnique.mockResolvedValue(ownedClip);
        prisma.clipVersion.findUnique.mockResolvedValue(versionRow);

        await expect(
          service.getVersionOutputOrThrow('user-1', 'clip-1', 'version-1'),
        ).resolves.toEqual({ outputUrl: 'renders/clip-1-v1.mp4' });
      });

      it('throws NotFoundException when the version never finished rendering', async () => {
        prisma.clip.findUnique.mockResolvedValue(ownedClip);
        prisma.clipVersion.findUnique.mockResolvedValue({ ...versionRow, outputUrl: null });

        await expect(
          service.getVersionOutputOrThrow('user-1', 'clip-1', 'version-1'),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('getVersionThumbnailOrThrow', () => {
      it('returns the raw thumbnail key when present', async () => {
        prisma.clip.findUnique.mockResolvedValue(ownedClip);
        prisma.clipVersion.findUnique.mockResolvedValue(versionRow);

        await expect(
          service.getVersionThumbnailOrThrow('user-1', 'clip-1', 'version-1'),
        ).resolves.toEqual({ thumbnailUrl: 'thumbnails/clip-1-v1.webp' });
      });
    });
  });

  describe('publish', () => {
    const renderedClip = {
      id: 'clip-1',
      outputUrl: 'renders/clip-1.mp4',
      video: { ownerId: 'user-1' },
    };
    const account = { id: 'account-1', userId: 'user-1' };
    const createdRecord = {
      id: 'record-1',
      clipId: 'clip-1',
      socialAccountId: 'account-1',
      status: 'QUEUED',
      scheduledAt: null,
      platformPostId: null,
      errorMessage: null,
      publishedAt: null,
      viewCount: null,
      likeCount: null,
      commentCount: null,
      statsUpdatedAt: null,
      createdAt: new Date('2026-01-01'),
      campaignId: null,
      recurringScheduleId: null,
      socialAccount: { platform: 'YOUTUBE' },
    };

    it('creates a PublishRecord, enqueues publish-clip with retry options, and returns the shared dto', async () => {
      prisma.clip.findUnique.mockResolvedValue(renderedClip);
      socialAccounts.findOwnedOrThrow.mockResolvedValue(account);
      prisma.publishRecord.create.mockResolvedValue(createdRecord);

      const result = await service.publish('clip-1', 'user-1', { socialAccountId: 'account-1' });

      expect(socialAccounts.findOwnedOrThrow).toHaveBeenCalledWith('account-1', 'user-1');
      expect(prisma.publishRecord.create).toHaveBeenCalledWith({
        data: {
          clipId: 'clip-1',
          socialAccountId: 'account-1',
          status: 'QUEUED',
          scheduledAt: null,
          campaignId: null,
          recurringScheduleId: null,
        },
        include: { socialAccount: true },
      });
      expect(publishClipQueue.add).toHaveBeenCalledWith(
        QueueName.PUBLISH_CLIP,
        { publishRecordId: 'record-1' },
        { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
      );
      expect(result).toEqual({
        id: 'record-1',
        clipId: 'clip-1',
        socialAccountId: 'account-1',
        platform: 'YOUTUBE',
        status: 'QUEUED',
        scheduledAt: null,
        platformPostId: null,
        errorMessage: null,
        publishedAt: null,
        viewCount: null,
        likeCount: null,
        commentCount: null,
        statsUpdatedAt: null,
        createdAt: createdRecord.createdAt.toISOString(),
        campaignId: null,
        recurringScheduleId: null,
      });
    });

    it('throws NotFoundException when the clip has not finished rendering yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({ ...renderedClip, outputUrl: null });

      await expect(
        service.publish('clip-1', 'user-1', { socialAccountId: 'account-1' }),
      ).rejects.toThrow(NotFoundException);
      expect(socialAccounts.findOwnedOrThrow).not.toHaveBeenCalled();
      expect(publishClipQueue.add).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException when the social account is not owned by the requester', async () => {
      prisma.clip.findUnique.mockResolvedValue(renderedClip);
      socialAccounts.findOwnedOrThrow.mockRejectedValue(
        new NotFoundException('Social account account-1 not found'),
      );

      await expect(
        service.publish('clip-1', 'user-1', { socialAccountId: 'account-1' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.publishRecord.create).not.toHaveBeenCalled();
      expect(publishClipQueue.add).not.toHaveBeenCalled();
    });

    it('creates a SCHEDULED PublishRecord and does not enqueue when scheduledAt is a future time', async () => {
      const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      prisma.clip.findUnique.mockResolvedValue(renderedClip);
      socialAccounts.findOwnedOrThrow.mockResolvedValue(account);
      prisma.publishRecord.create.mockResolvedValue({
        ...createdRecord,
        status: 'SCHEDULED',
        scheduledAt: new Date(futureIso),
      });

      const result = await service.publish('clip-1', 'user-1', {
        socialAccountId: 'account-1',
        scheduledAt: futureIso,
      });

      expect(prisma.publishRecord.create).toHaveBeenCalledWith({
        data: {
          clipId: 'clip-1',
          socialAccountId: 'account-1',
          status: 'SCHEDULED',
          scheduledAt: new Date(futureIso),
          campaignId: null,
          recurringScheduleId: null,
        },
        include: { socialAccount: true },
      });
      expect(publishClipQueue.add).not.toHaveBeenCalled();
      expect(result.status).toBe('SCHEDULED');
    });

    it('throws BadRequestException when scheduledAt is not in the future', async () => {
      prisma.clip.findUnique.mockResolvedValue(renderedClip);
      socialAccounts.findOwnedOrThrow.mockResolvedValue(account);
      const pastIso = new Date(Date.now() - 60_000).toISOString();

      await expect(
        service.publish('clip-1', 'user-1', {
          socialAccountId: 'account-1',
          scheduledAt: pastIso,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.publishRecord.create).not.toHaveBeenCalled();
    });

    describe('Publishing Expansion Phase 6 (Scheduling)', () => {
      const clipInWorkspace = {
        id: 'clip-1',
        outputUrl: 'renders/clip-1.mp4',
        video: { ownerId: 'user-1', workspaceId: 'ws-1' },
      };

      it('validates and stamps campaignId onto the created record', async () => {
        prisma.clip.findUnique.mockResolvedValue(clipInWorkspace);
        socialAccounts.findOwnedOrThrow.mockResolvedValue(account);
        prisma.publishRecord.create.mockResolvedValue({ ...createdRecord, campaignId: 'campaign-1' });

        await service.publish('clip-1', 'user-1', {
          socialAccountId: 'account-1',
          campaignId: 'campaign-1',
        });

        expect(campaigns.assertUsableForQueue).toHaveBeenCalledWith('ws-1', 'campaign-1');
        expect(prisma.publishRecord.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ campaignId: 'campaign-1' }) }),
        );
      });

      it('propagates the campaign validation error rather than creating a record', async () => {
        prisma.clip.findUnique.mockResolvedValue(clipInWorkspace);
        socialAccounts.findOwnedOrThrow.mockResolvedValue(account);
        campaigns.assertUsableForQueue.mockRejectedValue(new BadRequestException('Campaign campaign-1 is cancelled'));

        await expect(
          service.publish('clip-1', 'user-1', { socialAccountId: 'account-1', campaignId: 'campaign-1' }),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.publishRecord.create).not.toHaveBeenCalled();
      });

      it('resolves scheduledAt via the recurring schedule, ignoring any client-supplied scheduledAt, and does not enqueue', async () => {
        const resolvedSlot = new Date('2026-08-01T02:00:00.000Z');
        prisma.clip.findUnique.mockResolvedValue(clipInWorkspace);
        socialAccounts.findOwnedOrThrow.mockResolvedValue(account);
        recurringSchedules.resolveSlotForQueue.mockResolvedValue(resolvedSlot);
        prisma.publishRecord.create.mockResolvedValue({
          ...createdRecord,
          status: 'SCHEDULED',
          scheduledAt: resolvedSlot,
          recurringScheduleId: 'schedule-1',
        });

        const clientSuppliedScheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const result = await service.publish('clip-1', 'user-1', {
          socialAccountId: 'account-1',
          recurringScheduleId: 'schedule-1',
          scheduledAt: clientSuppliedScheduledAt, // must be ignored
        });

        expect(recurringSchedules.resolveSlotForQueue).toHaveBeenCalledWith(
          'ws-1',
          'schedule-1',
          'account-1',
        );
        expect(prisma.publishRecord.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'SCHEDULED',
              scheduledAt: resolvedSlot,
              recurringScheduleId: 'schedule-1',
            }),
          }),
        );
        expect(publishClipQueue.add).not.toHaveBeenCalled();
        expect(result.status).toBe('SCHEDULED');
      });

      it('propagates the recurring-schedule resolution error (e.g. mismatched socialAccountId) rather than creating a record', async () => {
        prisma.clip.findUnique.mockResolvedValue(clipInWorkspace);
        socialAccounts.findOwnedOrThrow.mockResolvedValue(account);
        recurringSchedules.resolveSlotForQueue.mockRejectedValue(
          new BadRequestException('socialAccountId does not match recurring schedule schedule-1'),
        );

        await expect(
          service.publish('clip-1', 'user-1', {
            socialAccountId: 'account-1',
            recurringScheduleId: 'schedule-1',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.publishRecord.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('cancelScheduledPublish', () => {
    const ownedClip = {
      id: 'clip-1',
      outputUrl: 'renders/clip-1.mp4',
      video: { ownerId: 'user-1' },
    };

    it('deletes the record when it is still SCHEDULED and belongs to the clip', async () => {
      prisma.clip.findUnique.mockResolvedValue(ownedClip);
      prisma.publishRecord.deleteMany.mockResolvedValue({ count: 1 });

      await service.cancelScheduledPublish('clip-1', 'record-1', 'user-1');

      expect(prisma.publishRecord.deleteMany).toHaveBeenCalledWith({
        where: { id: 'record-1', clipId: 'clip-1', status: 'SCHEDULED' },
      });
    });

    it('throws NotFoundException when no matching SCHEDULED record exists', async () => {
      prisma.clip.findUnique.mockResolvedValue(ownedClip);
      prisma.publishRecord.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.cancelScheduledPublish('clip-1', 'record-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the requester has no workspace access', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        ...ownedClip,
        video: { workspaceId: 'ws-1' },
      });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.cancelScheduledPublish('clip-1', 'record-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.publishRecord.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('reschedulePublish', () => {
    const ownedClip = {
      id: 'clip-1',
      outputUrl: 'renders/clip-1.mp4',
      video: { ownerId: 'user-1' },
    };
    const rescheduled = {
      id: 'record-1',
      clipId: 'clip-1',
      socialAccountId: 'account-1',
      status: 'SCHEDULED',
      scheduledAt: null as Date | null,
      platformPostId: null,
      errorMessage: null,
      publishedAt: null,
      createdAt: new Date('2026-01-01'),
      socialAccount: { platform: 'YOUTUBE' },
    };

    it('updates scheduledAt when the record is still SCHEDULED and belongs to the clip', async () => {
      const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      prisma.clip.findUnique.mockResolvedValue(ownedClip);
      prisma.publishRecord.updateMany.mockResolvedValue({ count: 1 });
      prisma.publishRecord.findUniqueOrThrow.mockResolvedValue({
        ...rescheduled,
        scheduledAt: new Date(futureIso),
      });

      const result = await service.reschedulePublish('clip-1', 'record-1', 'user-1', futureIso);

      expect(prisma.publishRecord.updateMany).toHaveBeenCalledWith({
        where: { id: 'record-1', clipId: 'clip-1', status: 'SCHEDULED' },
        data: { scheduledAt: new Date(futureIso) },
      });
      expect(result.scheduledAt).toBe(new Date(futureIso).toISOString());
    });

    it('throws BadRequestException when the new scheduledAt is not in the future', async () => {
      prisma.clip.findUnique.mockResolvedValue(ownedClip);
      const pastIso = new Date(Date.now() - 60_000).toISOString();

      await expect(
        service.reschedulePublish('clip-1', 'record-1', 'user-1', pastIso),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.publishRecord.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no matching SCHEDULED record exists', async () => {
      const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      prisma.clip.findUnique.mockResolvedValue(ownedClip);
      prisma.publishRecord.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reschedulePublish('clip-1', 'record-1', 'user-1', futureIso),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the clip row, cleans up its rendered output object, and records an audit log entry', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        videoId: 'video-1',
        outputUrl: 'renders/clip-1.mp4',
        hookText: 'Hook',
        video: { ownerId: 'user-1', workspaceId: 'ws-1' },
      });

      await service.remove('clip-1', 'user-1');

      expect(prisma.clip.delete).toHaveBeenCalledWith({ where: { id: 'clip-1' } });
      expect(storage.deleteObjects).toHaveBeenCalledWith(['renders/clip-1.mp4']);
      // Sprint 5F (Audit Log).
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          action: 'CLIP_DELETED',
          actorId: 'user-1',
          targetType: 'Clip',
          targetId: 'clip-1',
        }),
      });
    });

    it('skips storage cleanup for a clip that never finished rendering', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        outputUrl: null,
        video: { ownerId: 'user-1' },
      });

      await service.remove('clip-1', 'user-1');

      expect(prisma.clip.delete).toHaveBeenCalledWith({ where: { id: 'clip-1' } });
      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });

    it('throws NotFoundException and deletes nothing for a missing clip', async () => {
      prisma.clip.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.clip.delete).not.toHaveBeenCalled();
      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the requester has no workspace access (no delete, no enumeration)', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        outputUrl: 'renders/clip-1.mp4',
        video: { workspaceId: 'ws-1' },
      });
      workspaceAccess.assertMinRole.mockRejectedValueOnce(new NotFoundException());

      await expect(service.remove('clip-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.clip.delete).not.toHaveBeenCalled();
      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });
  });
});
