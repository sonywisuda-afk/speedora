import { Injectable } from '@nestjs/common';
import { PublishStatus, WorkspaceRole } from '@speedora/database';
import type {
  AnalyticsHeatmapDto,
  FollowersDto,
  LeaderboardMetric,
  SocialPlatform as SharedSocialPlatform,
  WorkspaceLeaderboardDto,
  WorkspacePredictionModelDto,
} from '@speedora/shared';
import {
  computeLeaderboard,
  computePublishTimeHeatmap,
  DROP_OFF_UNAVAILABLE,
  REPLAY_UNAVAILABLE,
  RETENTION_UNAVAILABLE,
  type LeaderboardCandidate,
} from '@speedora/analytics-report';
import { MIN_SAMPLES_FOR_CORRELATION, pearsonCorrelation } from '@speedora/dataset-quality';
import { toFollowerAccountSeries } from '../analytics/follower-series.util';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceAccessService } from '../workspace/workspace-access.service';

// Sprint 6D (Leaderboard) - the plan's foundational scoping decision (§1):
// every cross-creator concept (Top Creator ranking workspace members, Top
// Campaign, Top Platform) is workspace-scoped via WorkspaceAccessService,
// never global, consistent with how Campaign already works - never touches
// AnalyticsService's owner-scoped /analytics/* endpoints.
@Injectable()
export class WorkspaceAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  // Workspace-wide, so a higher bound than AnalyticsService's owner-scoped
  // MAX_CANDIDATE_ROWS (500) - same "bounded so this endpoint can never
  // itself become a slow query" reasoning, just sized for a whole
  // workspace's publish volume rather than one user's.
  private static readonly MAX_CANDIDATE_ROWS = 2000;

  private videoLabel(hookText: string | null, videoId: string): string {
    return hookText ?? `Video ${videoId.slice(0, 8)}`;
  }

  // One query, no per-record follow-ups - publishRecords/statsSnapshots/
  // socialAccount/campaign/clip/video/owner are all fetched via Prisma's
  // nested `select` in the same round trip, then computeLeaderboard()
  // (pure, no Prisma) derives all 4 dimensions from that single candidate
  // list.
  async getLeaderboard(
    userId: string,
    workspaceId: string,
    options: { metric: LeaderboardMetric; days: number; limit: number },
  ): Promise<WorkspaceLeaderboardDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.VIEWER);

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - options.days);

    const records = await this.prisma.publishRecord.findMany({
      where: {
        status: PublishStatus.PUBLISHED,
        publishedAt: { gte: windowStart },
        clip: { video: { workspaceId } },
      },
      select: {
        id: true,
        campaignId: true,
        campaign: { select: { name: true } },
        socialAccount: { select: { platform: true } },
        statsSnapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
        clip: {
          select: {
            hookText: true,
            videoId: true,
            video: { select: { ownerId: true, owner: { select: { email: true } } } },
          },
        },
      },
      take: WorkspaceAnalyticsService.MAX_CANDIDATE_ROWS,
    });

    const candidates: LeaderboardCandidate[] = records.map((record) => {
      const snapshot = record.statsSnapshots[0];
      return {
        publishRecordId: record.id,
        videoLabel: this.videoLabel(record.clip.hookText, record.clip.videoId),
        platform: record.socialAccount.platform as unknown as SharedSocialPlatform,
        ownerId: record.clip.video.ownerId,
        ownerEmail: record.clip.video.owner.email,
        campaignId: record.campaignId,
        campaignName: record.campaign?.name ?? null,
        viewCount: snapshot?.viewCount ?? null,
        likeCount: snapshot?.likeCount ?? null,
        commentCount: snapshot?.commentCount ?? null,
        shareCount: snapshot?.shareCount ?? null,
        engagementScore: snapshot?.engagementScore ?? null,
      };
    });

    const result = computeLeaderboard(candidates, options.metric, options.limit);

    return {
      metric: options.metric,
      days: options.days,
      limit: options.limit,
      ...result,
    };
  }

  // Sprint 6F (Followers) - workspace-scoped. SocialAccount belongs to a
  // User, not directly to a Workspace (see schema.prisma), so "every
  // account belonging to any member of this workspace" is expressed via
  // the same User -> WorkspaceMembership relation Sprint 6D's Top Creator
  // already reasons about, not a new access-control construct. One query,
  // same "nested select, no per-account follow-up query" pattern as
  // getLeaderboard above.
  async getFollowers(userId: string, workspaceId: string, days: number): Promise<FollowersDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.VIEWER);

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - days);

    const accounts = await this.prisma.socialAccount.findMany({
      where: { user: { workspaceMemberships: { some: { workspaceId } } } },
      select: {
        id: true,
        platform: true,
        displayName: true,
        followerSnapshots: {
          where: { capturedAt: { gte: windowStart } },
          orderBy: { capturedAt: 'asc' },
        },
      },
    });

    return { accounts: accounts.map(toFollowerAccountSeries) };
  }

  // Sprint 6H (Heatmap) - workspace-scoped. One query, bounded the same way
  // getLeaderboard's own candidate fetch is - only publishedAt and the
  // latest snapshot are needed here, not the fuller candidate shape
  // computeLeaderboard() requires.
  async getHeatmap(userId: string, workspaceId: string, days: number): Promise<AnalyticsHeatmapDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.VIEWER);

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - days);

    const records = await this.prisma.publishRecord.findMany({
      where: {
        status: PublishStatus.PUBLISHED,
        publishedAt: { gte: windowStart },
        clip: { video: { workspaceId } },
      },
      select: {
        publishedAt: true,
        statsSnapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
      },
      take: WorkspaceAnalyticsService.MAX_CANDIDATE_ROWS,
    });
    const withPublishedAt = records.filter(
      (r): r is typeof r & { publishedAt: Date } => r.publishedAt !== null,
    );

    return {
      cells: computePublishTimeHeatmap(
        withPublishedAt.map((r) => ({
          publishedAt: r.publishedAt,
          viewCount: r.statsSnapshots[0]?.viewCount ?? null,
          engagementScore: r.statsSnapshots[0]?.engagementScore ?? null,
        })),
      ),
      retention: RETENTION_UNAVAILABLE,
      dropOff: DROP_OFF_UNAVAILABLE,
      replay: REPLAY_UNAVAILABLE,
    };
  }

  // Sprint 6J (Predicted performance) - the workspace-level transparency
  // endpoint: "does this workspace's data actually support per-clip
  // predictions, and how strong is the underlying correlation." Reuses the
  // exact same pearsonCorrelation/MIN_SAMPLES_FOR_CORRELATION
  // /ops/ai/correlation already uses, just pooled over this one workspace's
  // published clips instead of every user system-wide - same
  // hasEnoughSamples/sampleCount/minSamplesRequired shape as that endpoint
  // for a consistent UX. One query, same bounded pattern as every other
  // method here.
  async getPredictionModel(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspacePredictionModelDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.VIEWER);

    const records = await this.prisma.publishRecord.findMany({
      where: { status: PublishStatus.PUBLISHED, clip: { video: { workspaceId } } },
      select: {
        clip: { select: { highlightScore: true } },
        statsSnapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
      },
      take: WorkspaceAnalyticsService.MAX_CANDIDATE_ROWS,
    });

    const pairs = records
      .map((r) => ({
        highlightScore: r.clip.highlightScore,
        engagementScore: r.statsSnapshots[0]?.engagementScore ?? null,
      }))
      .filter(
        (p): p is { highlightScore: number; engagementScore: number } =>
          p.highlightScore !== null && p.engagementScore !== null,
      );

    const hasEnoughSamples = pairs.length >= MIN_SAMPLES_FOR_CORRELATION;
    const correlation = hasEnoughSamples
      ? pearsonCorrelation(
          pairs.map((p) => p.highlightScore),
          pairs.map((p) => p.engagementScore),
        )
      : null;

    return {
      hasEnoughSamples,
      sampleCount: pairs.length,
      minSamplesRequired: MIN_SAMPLES_FOR_CORRELATION,
      correlation,
    };
  }
}

