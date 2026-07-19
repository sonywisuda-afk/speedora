import { Injectable } from '@nestjs/common';
import { PublishStatus, SocialPlatform, type VideoStatus } from '@speedora/database';
import type {
  AnalyticsHeatmapDto,
  AnalyticsOverviewDto,
  AnalyticsPerformanceClipsDto,
  AnalyticsPerformanceDto,
  AnalyticsPerformanceVideosDto,
  FollowersDto,
  SocialPlatform as SharedSocialPlatform,
  TopClipRow,
  TopVideoRow,
  TrendGranularity,
  VideoStatus as SharedVideoStatus,
} from '@speedora/shared';
import {
  bucketByPublishDate,
  bucketByPublishPeriod,
  bucketUploadsByDay,
  computeAverageEngagementScore,
  computeConfidenceDistribution,
  computeGrowthPct,
  computeGrowthSummary,
  computeMostCommonSignals,
  computePublishTimeHeatmap,
  computeScoreDistribution,
  computeSignalContributions,
  DROP_OFF_UNAVAILABLE,
  periodsForGranularity,
  REPLAY_UNAVAILABLE,
  RETENTION_UNAVAILABLE,
} from '@speedora/analytics-report';
import {
  toSharedHighlightBreakdown,
  toSharedHighlightExplainability,
} from '../videos/transcript-segment.util';
import { PrismaService } from '../prisma/prisma.service';
import { toFollowerAccountSeries } from './follower-series.util';

const UPLOAD_TREND_DAYS = 30;
// All 8 supported platforms, matching parsePlatform()'s own
// Object.values(SocialPlatform) convention in the controller - was
// previously hardcoded to only YOUTUBE/TIKTOK/INSTAGRAM, which silently
// dropped Facebook/Threads/LinkedIn/Pinterest/X from platformComparison.
const ALL_PLATFORMS: SocialPlatform[] = Object.values(SocialPlatform) as SocialPlatform[];
// "Bounded so this endpoint can never itself become a slow query" - same
// reasoning docs/monitoring.md's /queues endpoint already documents. Per-user
// data is realistically far below this; if a user ever has more published
// records than this within one window, the extra ones are simply omitted
// from top-N ranking rather than the query itself getting slow.
const MAX_CANDIDATE_ROWS = 500;
const DEFAULT_PERFORMANCE_LIMIT = 50;
const TOP_HIGHLIGHT_REASON_COUNT = 5;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

interface PerformanceFilter {
  platform?: SocialPlatform;
  videoId?: string;
  publishedAfter?: Date;
  publishedBefore?: Date;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // Milestone 5A - every query below is scoped to `ownerId: userId` (or the
  // equivalent nested relation filter) so this endpoint can never leak
  // aggregate data across users, same posture as every other endpoint in
  // this app. Run in parallel (Promise.all), same pattern
  // check-calibration-coverage.ts already uses in apps/worker for its own
  // multi-query report.
  async getOverview(userId: string): Promise<AnalyticsOverviewDto> {
    const [totalVideos, totalClips, publishedClips, snapshots, videos, publishedRecords] =
      await Promise.all([
        this.prisma.video.count({ where: { ownerId: userId } }),
        this.prisma.clip.count({ where: { video: { ownerId: userId } } }),
        this.prisma.clip.count({
          where: {
            video: { ownerId: userId },
            publishRecords: { some: { status: PublishStatus.PUBLISHED } },
          },
        }),
        this.prisma.publishRecordStatsSnapshot.findMany({
          where: { publishRecord: { clip: { video: { ownerId: userId } } } },
          select: { publishRecordId: true, capturedAt: true, engagementScore: true },
        }),
        this.prisma.video.findMany({
          where: { ownerId: userId },
          select: { status: true, createdAt: true },
        }),
        this.prisma.publishRecord.findMany({
          where: { status: PublishStatus.PUBLISHED, clip: { video: { ownerId: userId } } },
          select: { socialAccount: { select: { platform: true } } },
        }),
      ]);

    const processingStatusCounts = new Map<VideoStatus, number>();
    for (const video of videos) {
      processingStatusCounts.set(video.status, (processingStatusCounts.get(video.status) ?? 0) + 1);
    }

    const platformCounts = new Map<SocialPlatform, number>();
    for (const record of publishedRecords) {
      const platform = record.socialAccount.platform;
      platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1);
    }

    return {
      totalVideos,
      totalClips,
      publishedClips,
      averageEngagementScore: computeAverageEngagementScore(snapshots),
      // Prisma's SocialPlatform/VideoStatus mirror packages/shared's own
      // (identical string values) - same cast toSharedCaptionStyle() etc.
      // already use in transcript-segment.util.ts for this exact situation.
      platformBreakdown: Array.from(platformCounts.entries()).map(([platform, publishedCount]) => ({
        platform: platform as unknown as SharedSocialPlatform,
        publishedCount,
      })),
      processingStatus: Array.from(processingStatusCounts.entries()).map(([status, count]) => ({
        status: status as unknown as SharedVideoStatus,
        count,
      })),
      uploadTrend: bucketUploadsByDay(
        videos.map((v) => v.createdAt),
        UPLOAD_TREND_DAYS,
      ),
    };
  }

  // Milestone 5B - the shared "published records, with everything the
  // three performance endpoints need" fetch, scoped to `ownerId: userId`
  // the same way every query in this module is. Bounded (MAX_CANDIDATE_ROWS)
  // and un-ordered at the DB level - callers sort/aggregate in JS, same
  // "fetch-then-reduce" convention as getOverview/check-calibration-coverage.ts.
  private fetchPublishedRecords(userId: string, filter: PerformanceFilter) {
    return this.prisma.publishRecord.findMany({
      where: {
        status: PublishStatus.PUBLISHED,
        publishedAt: {
          ...(filter.publishedAfter ? { gte: filter.publishedAfter } : {}),
          ...(filter.publishedBefore ? { lt: filter.publishedBefore } : {}),
        },
        clip: {
          video: { ownerId: userId, ...(filter.videoId ? { id: filter.videoId } : {}) },
        },
        ...(filter.platform ? { socialAccount: { platform: filter.platform } } : {}),
      },
      select: {
        id: true,
        publishedAt: true,
        clip: {
          select: {
            id: true,
            videoId: true,
            hookText: true,
            thumbnailUrl: true,
            highlightScore: true,
            highlightConfidence: true,
            highlightReason: true,
            highlightExplainability: true,
            highlightBreakdown: true,
          },
        },
        socialAccount: { select: { platform: true } },
        statsSnapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
      },
      take: MAX_CANDIDATE_ROWS,
    });
  }

  private videoLabel(hookText: string | null, videoId: string): string {
    return hookText ?? `Video ${videoId.slice(0, 8)}`;
  }

  // Bundles Engagement Trend + Platform Comparison + AI Performance Summary
  // - all three are small, computed-together, shown-together at the top of
  // the page, no independent pagination needed (design decision #1).
  async getPerformance(
    userId: string,
    options: { days: number; platform?: SocialPlatform; granularity?: TrendGranularity },
  ): Promise<AnalyticsPerformanceDto> {
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - options.days);
    const previousWindowStart = new Date(windowStart);
    previousWindowStart.setDate(previousWindowStart.getDate() - options.days);

    const [
      currentRecords,
      previousRecords,
      currentVideoCount,
      previousVideoCount,
      currentClipCount,
      previousClipCount,
    ] = await Promise.all([
      this.fetchPublishedRecords(userId, {
        platform: options.platform,
        publishedAfter: windowStart,
      }),
      this.fetchPublishedRecords(userId, {
        platform: options.platform,
        publishedAfter: previousWindowStart,
        publishedBefore: windowStart,
      }),
      // Growth Summary (Analytics Report) - "videos"/"clips" growth is
      // creation-count, not publish-count, matching totalVideos/totalClips'
      // own semantics on AnalyticsOverviewDto. Cheap, indexed count()s -
      // views/engagement growth below need zero extra queries, reduced from
      // currentRecords/previousRecords already fetched above.
      this.prisma.video.count({ where: { ownerId: userId, createdAt: { gte: windowStart } } }),
      this.prisma.video.count({
        where: { ownerId: userId, createdAt: { gte: previousWindowStart, lt: windowStart } },
      }),
      this.prisma.clip.count({
        where: { video: { ownerId: userId }, createdAt: { gte: windowStart } },
      }),
      this.prisma.clip.count({
        where: {
          video: { ownerId: userId },
          createdAt: { gte: previousWindowStart, lt: windowStart },
        },
      }),
    ]);

    const withPublishedAt = currentRecords.filter(
      (r): r is typeof r & { publishedAt: Date } => r.publishedAt !== null,
    );
    const trendRecords = withPublishedAt.map((r) => ({
      publishedAt: r.publishedAt,
      viewCount: r.statsSnapshots[0]?.viewCount ?? null,
      engagementScore: r.statsSnapshots[0]?.engagementScore ?? null,
    }));
    // Sprint 6B (Trend granularity) - 'daily' keeps using the original,
    // already-tested bucketByPublishDate untouched (also still used
    // independently by apps/worker's Analytics Report PDF adapter);
    // weekly/monthly/yearly use the new generalized bucketByPublishPeriod,
    // which produces identical output to bucketByPublishDate for 'daily'.
    const granularity = options.granularity ?? 'daily';
    const engagementTrend =
      granularity === 'daily'
        ? bucketByPublishDate(trendRecords, options.days, now)
        : bucketByPublishPeriod(
            trendRecords,
            granularity,
            periodsForGranularity(options.days, granularity),
            now,
          );

    const platformComparison = ALL_PLATFORMS.map((platform) => {
      const current = currentRecords.filter((r) => r.socialAccount.platform === platform);
      const previous = previousRecords.filter((r) => r.socialAccount.platform === platform);
      const engagementScores = current
        .map((r) => r.statsSnapshots[0]?.engagementScore ?? null)
        .filter((v): v is number => v !== null);
      const highlightScores = current
        .map((r) => r.clip.highlightScore)
        .filter((v): v is number => v !== null);
      return {
        platform: platform as unknown as SharedSocialPlatform,
        averageEngagementScore: average(engagementScores),
        averageHighlightScore: average(highlightScores),
        publishCount: current.length,
        growthPct: computeGrowthPct(current.length, previous.length),
      };
    });

    // AI summary is per-clip, not per-publish-record - the same clip
    // published to two platforms shouldn't count its highlightScore twice.
    const clipsById = new Map(currentRecords.map((r) => [r.clip.id, r.clip]));
    const clips = Array.from(clipsById.values());
    const highlightScores = clips
      .map((c) => c.highlightScore)
      .filter((v): v is number => v !== null);
    const confidences = clips
      .map((c) => c.highlightConfidence)
      .filter((v): v is number => v !== null);
    const topFactorsPerClip = clips.map((c) =>
      toSharedHighlightExplainability(c.highlightExplainability).topFactors.map((f) => f.signal),
    );
    const topHighlightReasons = clips
      .filter((c): c is typeof c & { highlightReason: string } => c.highlightReason !== null)
      .sort((a, b) => (b.highlightScore ?? -1) - (a.highlightScore ?? -1))
      .slice(0, TOP_HIGHLIGHT_REASON_COUNT)
      .map((c) => ({ clipId: c.id, highlightScore: c.highlightScore, reason: c.highlightReason }));
    // Milestone 5C-A - Highlight Score Distribution + per-signal
    // Contribution %, scoped to this user's own clips in the window (see
    // fusion-signal-analytics.util.ts - same functions /ops/ai/signals uses
    // system-wide).
    const breakdowns = clips.map((c) => toSharedHighlightBreakdown(c.highlightBreakdown));

    const growthSummary = computeGrowthSummary({
      videos: { current: currentVideoCount, previous: previousVideoCount },
      clips: { current: currentClipCount, previous: previousClipCount },
      currentRecords: currentRecords.map((r) => ({
        viewCount: r.statsSnapshots[0]?.viewCount ?? null,
        engagementScore: r.statsSnapshots[0]?.engagementScore ?? null,
      })),
      previousRecords: previousRecords.map((r) => ({
        viewCount: r.statsSnapshots[0]?.viewCount ?? null,
        engagementScore: r.statsSnapshots[0]?.engagementScore ?? null,
      })),
    });

    return {
      engagementTrend,
      granularity,
      platformComparison,
      growthSummary,
      aiSummary: {
        averageHighlightScore: average(highlightScores),
        averageConfidence: average(confidences),
        confidenceDistribution: computeConfidenceDistribution(confidences),
        topHighlightReasons,
        mostCommonSignals: computeMostCommonSignals(topFactorsPerClip),
        scoreDistribution: computeScoreDistribution(highlightScores),
        signalContributions: computeSignalContributions(breakdowns),
      },
    };
  }

  // Top Performing Clips - one row per PublishRecord (design decision #3),
  // sorted by engagementScore descending server-side (a sensible default);
  // the frontend re-sorts client-side on column click (design decision #2).
  async getPerformanceClips(
    userId: string,
    options: { days: number; platform?: SocialPlatform; videoId?: string; limit?: number },
  ): Promise<AnalyticsPerformanceClipsDto> {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - options.days);

    const records = await this.fetchPublishedRecords(userId, {
      platform: options.platform,
      videoId: options.videoId,
      publishedAfter: windowStart,
    });

    const rows: TopClipRow[] = records.map((r) => ({
      clipId: r.clip.id,
      publishRecordId: r.id,
      videoId: r.clip.videoId,
      videoLabel: this.videoLabel(r.clip.hookText, r.clip.videoId),
      // Never the raw storage key - same treatment as ClipsService.toDto()'s
      // own thumbnailUrl (Product Experience roadmap).
      thumbnailUrl: r.clip.thumbnailUrl ? `/clips/${r.clip.id}/thumbnail` : null,
      platform: r.socialAccount.platform as unknown as SharedSocialPlatform,
      highlightScore: r.clip.highlightScore,
      engagementScore: r.statsSnapshots[0]?.engagementScore ?? null,
      viewCount: r.statsSnapshots[0]?.viewCount ?? null,
      likeCount: r.statsSnapshots[0]?.likeCount ?? null,
      commentCount: r.statsSnapshots[0]?.commentCount ?? null,
      shareCount: r.statsSnapshots[0]?.shareCount ?? null,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    }));

    const sorted = rows.sort((a, b) => (b.engagementScore ?? -1) - (a.engagementScore ?? -1));
    return { clips: sorted.slice(0, options.limit ?? DEFAULT_PERFORMANCE_LIMIT) };
  }

  // Top Performing Videos - aggregated per video from the same published-
  // record shape getPerformanceClips uses, just grouped by clip.videoId
  // instead of returned per-record.
  async getPerformanceVideos(
    userId: string,
    options: { days: number; platform?: SocialPlatform; limit?: number },
  ): Promise<AnalyticsPerformanceVideosDto> {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - options.days);

    const records = await this.fetchPublishedRecords(userId, {
      platform: options.platform,
      publishedAfter: windowStart,
    });

    interface VideoAccumulator {
      videoLabel: string;
      clipIds: Set<string>;
      highlightScores: number[];
      engagementScores: number[];
      totalViews: number;
      totalLikes: number;
      totalShares: number;
    }

    const byVideo = new Map<string, VideoAccumulator>();
    for (const r of records) {
      const videoId = r.clip.videoId;
      if (!byVideo.has(videoId)) {
        byVideo.set(videoId, {
          videoLabel: this.videoLabel(r.clip.hookText, videoId),
          clipIds: new Set(),
          highlightScores: [],
          engagementScores: [],
          totalViews: 0,
          totalLikes: 0,
          totalShares: 0,
        });
      }
      const acc = byVideo.get(videoId)!;
      acc.clipIds.add(r.clip.id);
      if (r.clip.highlightScore !== null) acc.highlightScores.push(r.clip.highlightScore);
      const snapshot = r.statsSnapshots[0];
      if (snapshot?.engagementScore != null) acc.engagementScores.push(snapshot.engagementScore);
      acc.totalViews += snapshot?.viewCount ?? 0;
      acc.totalLikes += snapshot?.likeCount ?? 0;
      acc.totalShares += snapshot?.shareCount ?? 0;
    }

    const rows: TopVideoRow[] = Array.from(byVideo.entries()).map(([videoId, acc]) => ({
      videoId,
      videoLabel: acc.videoLabel,
      clipCount: acc.clipIds.size,
      averageHighlightScore: average(acc.highlightScores),
      averageEngagementScore: average(acc.engagementScores),
      totalViews: acc.totalViews,
      totalLikes: acc.totalLikes,
      totalShares: acc.totalShares,
    }));

    const sorted = rows.sort(
      (a, b) => (b.averageEngagementScore ?? -1) - (a.averageEngagementScore ?? -1),
    );
    return { videos: sorted.slice(0, options.limit ?? DEFAULT_PERFORMANCE_LIMIT) };
  }

  // Sprint 6F (Followers) - one query per caller (nested `select`, not a
  // loop that queries per account). A platform with no fetchFollowerCount
  // adapter (LinkedIn/Threads) or an account that hasn't reconnected to
  // grant a newly-required scope (TikTok) simply has zero
  // SocialAccountFollowerSnapshot rows - that absence is the "not
  // available" signal itself, not a special case this method needs to
  // detect (see packages/analytics-report's platform-capability.util.ts).
  async getFollowers(userId: string, days: number): Promise<FollowersDto> {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - days);

    const accounts = await this.prisma.socialAccount.findMany({
      where: { userId },
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

  // Sprint 6H (Heatmap) - reuses fetchPublishedRecords, the exact same
  // fetch getPerformance/getPerformanceClips/getPerformanceVideos already
  // use, so this can never disagree with those endpoints about what counts
  // as "published" or what a record's latest stats are. Only the real
  // publish-time-vs-engagement grid is computed from real data;
  // retention/dropOff/replay are always the same honest, shared
  // "unavailable" constants - never fabricated.
  async getHeatmap(userId: string, days: number): Promise<AnalyticsHeatmapDto> {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - days);

    const records = await this.fetchPublishedRecords(userId, { publishedAfter: windowStart });
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
}

