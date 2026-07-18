import { PublishStatus, type PrismaClient } from '@speedora/database';
import type { BuildAnalyticsReportInput } from '@speedora/contracts';
import {
  bucketByPublishDate,
  bucketUploadsByDay,
  computeAverageEngagementScore,
  computeConfidenceDistribution,
  computeGrowthPct,
  computeGrowthSummary,
  computeMostCommonSignals,
  computeScoreDistribution,
  computeSignalContributions,
} from '@speedora/analytics-report';
import type { FusionBreakdown, FusionExplainability } from '@speedora/shared';

// apps/worker's own account-wide adapter for the Analytics Report - unlike
// build-video-report-input.ts (a pure narrower of already-fetched rows),
// this one owns its own Prisma querying, re-implementing
// AnalyticsService.getOverview/getPerformance/getPerformanceClips/
// getPerformanceVideos directly against apps/worker's own prisma client
// (apps/worker cannot import apps/api's service - apps only talk over
// HTTP/queue). Justified by scale: inlining 10+ queries into
// export-generate.worker.ts's job processor, the way the single video/
// statusEvents fetch is inlined there for the video-report family, would
// bloat that file far more than one dedicated adapter function does.
// Fixed at a 30-day window (no days/platform param) - a report snapshot,
// not an interactive dashboard.

const WINDOW_DAYS = 30;
const ALL_PLATFORMS = ['YOUTUBE', 'TIKTOK', 'INSTAGRAM'] as const;
const MAX_CANDIDATE_ROWS = 500;
const TOP_PERFORMANCE_LIMIT = 50;
const TOP_HIGHLIGHT_REASON_COUNT = 5;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function videoLabel(hookText: string | null, videoId: string): string {
  return hookText ?? `Video ${videoId.slice(0, 8)}`;
}

function toBreakdown(value: unknown): FusionBreakdown {
  return (value as FusionBreakdown | null) ?? [];
}

function toExplainability(value: unknown): FusionExplainability {
  return (value as FusionExplainability | null) ?? { topFactors: [] };
}

interface PublishedRecordFilter {
  publishedAfter?: Date;
  publishedBefore?: Date;
}

// Same shape as AnalyticsService's own private fetchPublishedRecords -
// bounded, unordered at the DB level (caller sorts/aggregates in JS), same
// "fetch-then-reduce" convention.
function fetchPublishedRecords(
  prisma: PrismaClient,
  userId: string,
  filter: PublishedRecordFilter,
) {
  return prisma.publishRecord.findMany({
    where: {
      status: PublishStatus.PUBLISHED,
      publishedAt: {
        ...(filter.publishedAfter ? { gte: filter.publishedAfter } : {}),
        ...(filter.publishedBefore ? { lt: filter.publishedBefore } : {}),
      },
      clip: { video: { ownerId: userId } },
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

type PublishedRecord = Awaited<ReturnType<typeof fetchPublishedRecords>>[number];

function toTopClipRow(r: PublishedRecord) {
  return {
    clipId: r.clip.id,
    publishRecordId: r.id,
    videoId: r.clip.videoId,
    videoLabel: videoLabel(r.clip.hookText, r.clip.videoId),
    thumbnailUrl: r.clip.thumbnailUrl ? `/clips/${r.clip.id}/thumbnail` : null,
    platform: r.socialAccount.platform,
    highlightScore: r.clip.highlightScore,
    engagementScore: r.statsSnapshots[0]?.engagementScore ?? null,
    viewCount: r.statsSnapshots[0]?.viewCount ?? null,
    likeCount: r.statsSnapshots[0]?.likeCount ?? null,
    commentCount: r.statsSnapshots[0]?.commentCount ?? null,
    shareCount: r.statsSnapshots[0]?.shareCount ?? null,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
  };
}

interface VideoAccumulator {
  videoLabel: string;
  clipIds: Set<string>;
  highlightScores: number[];
  engagementScores: number[];
  totalViews: number;
  totalLikes: number;
  totalShares: number;
}

function buildTopVideoRows(records: PublishedRecord[]) {
  const byVideo = new Map<string, VideoAccumulator>();
  for (const r of records) {
    const videoId = r.clip.videoId;
    if (!byVideo.has(videoId)) {
      byVideo.set(videoId, {
        videoLabel: videoLabel(r.clip.hookText, videoId),
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

  return Array.from(byVideo.entries())
    .map(([videoId, acc]) => ({
      videoId,
      videoLabel: acc.videoLabel,
      clipCount: acc.clipIds.size,
      averageHighlightScore: average(acc.highlightScores),
      averageEngagementScore: average(acc.engagementScores),
      totalViews: acc.totalViews,
      totalLikes: acc.totalLikes,
      totalShares: acc.totalShares,
    }))
    .sort((a, b) => (b.averageEngagementScore ?? -1) - (a.averageEngagementScore ?? -1))
    .slice(0, TOP_PERFORMANCE_LIMIT);
}

export async function buildAnalyticsReportInputFromPrisma(
  prisma: PrismaClient,
  params: { userId: string },
): Promise<BuildAnalyticsReportInput> {
  const { userId } = params;
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - WINDOW_DAYS);
  const previousWindowStart = new Date(windowStart);
  previousWindowStart.setDate(previousWindowStart.getDate() - WINDOW_DAYS);

  const [
    totalVideos,
    totalClips,
    publishedClips,
    snapshots,
    videos,
    platformBreakdownRecords,
    currentRecords,
    previousRecords,
    currentVideoCount,
    previousVideoCount,
    currentClipCount,
    previousClipCount,
  ] = await Promise.all([
    prisma.video.count({ where: { ownerId: userId } }),
    prisma.clip.count({ where: { video: { ownerId: userId } } }),
    prisma.clip.count({
      where: {
        video: { ownerId: userId },
        publishRecords: { some: { status: PublishStatus.PUBLISHED } },
      },
    }),
    prisma.publishRecordStatsSnapshot.findMany({
      where: { publishRecord: { clip: { video: { ownerId: userId } } } },
      select: { publishRecordId: true, capturedAt: true, engagementScore: true },
    }),
    prisma.video.findMany({
      where: { ownerId: userId },
      select: { status: true, createdAt: true },
    }),
    prisma.publishRecord.findMany({
      where: { status: PublishStatus.PUBLISHED, clip: { video: { ownerId: userId } } },
      select: { socialAccount: { select: { platform: true } } },
    }),
    fetchPublishedRecords(prisma, userId, { publishedAfter: windowStart }),
    fetchPublishedRecords(prisma, userId, {
      publishedAfter: previousWindowStart,
      publishedBefore: windowStart,
    }),
    prisma.video.count({ where: { ownerId: userId, createdAt: { gte: windowStart } } }),
    prisma.video.count({
      where: { ownerId: userId, createdAt: { gte: previousWindowStart, lt: windowStart } },
    }),
    prisma.clip.count({
      where: { video: { ownerId: userId }, createdAt: { gte: windowStart } },
    }),
    prisma.clip.count({
      where: {
        video: { ownerId: userId },
        createdAt: { gte: previousWindowStart, lt: windowStart },
      },
    }),
  ]);

  // ---- Overview (mirrors AnalyticsService.getOverview) ----

  const processingStatusCounts = new Map<string, number>();
  for (const video of videos) {
    processingStatusCounts.set(video.status, (processingStatusCounts.get(video.status) ?? 0) + 1);
  }
  const platformCounts = new Map<string, number>();
  for (const record of platformBreakdownRecords) {
    const platform = record.socialAccount.platform;
    platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1);
  }

  const overview = {
    totalVideos,
    totalClips,
    publishedClips,
    averageEngagementScore: computeAverageEngagementScore(snapshots),
    platformBreakdown: Array.from(platformCounts.entries()).map(([platform, publishedCount]) => ({
      platform,
      publishedCount,
    })),
    processingStatus: Array.from(processingStatusCounts.entries()).map(([status, count]) => ({
      status,
      count,
    })),
    uploadTrend: bucketUploadsByDay(
      videos.map((v) => v.createdAt),
      WINDOW_DAYS,
      now,
    ),
  };

  // ---- Performance (mirrors AnalyticsService.getPerformance) ----

  const withPublishedAt = currentRecords.filter(
    (r): r is typeof r & { publishedAt: Date } => r.publishedAt !== null,
  );
  const engagementTrend = bucketByPublishDate(
    withPublishedAt.map((r) => ({
      publishedAt: r.publishedAt,
      viewCount: r.statsSnapshots[0]?.viewCount ?? null,
      engagementScore: r.statsSnapshots[0]?.engagementScore ?? null,
    })),
    WINDOW_DAYS,
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
      platform,
      averageEngagementScore: average(engagementScores),
      averageHighlightScore: average(highlightScores),
      publishCount: current.length,
      growthPct: computeGrowthPct(current.length, previous.length),
    };
  });

  const clipsById = new Map(currentRecords.map((r) => [r.clip.id, r.clip]));
  const clips = Array.from(clipsById.values());
  const highlightScores = clips.map((c) => c.highlightScore).filter((v): v is number => v !== null);
  const confidences = clips
    .map((c) => c.highlightConfidence)
    .filter((v): v is number => v !== null);
  const topFactorsPerClip = clips.map((c) =>
    toExplainability(c.highlightExplainability).topFactors.map((f) => f.signal),
  );
  const topHighlightReasons = clips
    .filter((c): c is typeof c & { highlightReason: string } => c.highlightReason !== null)
    .sort((a, b) => (b.highlightScore ?? -1) - (a.highlightScore ?? -1))
    .slice(0, TOP_HIGHLIGHT_REASON_COUNT)
    .map((c) => ({ clipId: c.id, highlightScore: c.highlightScore, reason: c.highlightReason }));
  const breakdowns = clips.map((c) => toBreakdown(c.highlightBreakdown));

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

  const performance = {
    growthSummary,
    engagementTrend,
    platformComparison,
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

  // ---- Top Clips / Top Videos (mirrors getPerformanceClips/getPerformanceVideos,
  // reusing currentRecords - the same "publishedAfter windowStart" fetch
  // both those methods run independently with no previous-window component) ----

  const topClips = currentRecords
    .map(toTopClipRow)
    .sort((a, b) => (b.engagementScore ?? -1) - (a.engagementScore ?? -1))
    .slice(0, TOP_PERFORMANCE_LIMIT);
  const topVideos = buildTopVideoRows(currentRecords);

  return {
    generatedAt: now.toISOString(),
    windowDays: WINDOW_DAYS,
    overview,
    performance,
    topClips,
    topVideos,
  };
}
