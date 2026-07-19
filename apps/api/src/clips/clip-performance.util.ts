import type { Prisma } from '@speedora/database';
import type {
  ClipPerformanceDto,
  PublishStatus as SharedPublishStatus,
  SocialPlatform as SharedSocialPlatform,
} from '@speedora/shared';
import { generateClipNarrative, predictEngagement, type PredictionPair } from '@speedora/analytics-report';
import {
  toSharedHighlightBreakdown,
  toSharedHighlightExplainability,
  toSharedHighlightPrediction,
  toSharedHighlightRecommendation,
} from '../videos/transcript-segment.util';

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// One shape serving both Sprint 6I's narrative baseline (just the
// engagementScore side) and Sprint 6J's prediction baseline (the paired
// highlightScore+engagementScore side) - both are derived from the exact
// same fetched historical records, not two separate queries.
export interface HistoricalOwnerRecord {
  highlightScore: number | null;
  engagementScore: number | null;
}

// Sprint 6C (Per-Clip Performance) - one query, no per-publish-record
// follow-up queries: publishRecords/statsSnapshots/socialAccount/campaign/
// recurringSchedule are all fetched via Prisma's nested `include` in the
// same round trip as the clip itself, same "nested include, not a loop that
// queries per record" pattern as ClipsService's own CLIP_WITH_VIDEO and
// AnalyticsService's fetchPublishedRecords.
export const CLIP_WITH_PERFORMANCE = {
  include: {
    video: true,
    publishRecords: {
      include: {
        socialAccount: { select: { platform: true } },
        campaign: { select: { id: true, name: true } },
        recurringSchedule: { select: { id: true, name: true } },
        // Oldest-first so ClipPerformancePlatformSeries.history is
        // pre-sorted for a line chart - no caller-side sort needed.
        statsSnapshots: { orderBy: { capturedAt: 'asc' } },
        // Sprint 6K (Conversion) - only the denormalized clickCount is
        // needed here (never the full click-detail history), so
        // traffic[].conversionCount stays an O(1) read per TrackedLink,
        // not a COUNT() scan.
        trackedLinks: { select: { clickCount: true } },
      },
    },
  },
} as const;

// Explicit named type (not inferred at the call site) for the same TS2742
// declaration-emit reason CLIP_WITH_VIDEO documents - a Clip row includes
// Json columns (scores, highlightBreakdown, etc.).
export type ClipWithPerformance = Prisma.ClipGetPayload<typeof CLIP_WITH_PERFORMANCE>;

// Pure mapping, no Prisma access - takes the single already-fetched clip
// row plus its owner's OTHER published clips' latest engagementScores
// (Sprint 6I's comparison baseline - the one thing about this DTO that
// isn't purely this clip's own data, see ClipPerformanceDto's own comment)
// and shapes ClipPerformanceDto's 5 sections. Every number here
// (performance/traffic) is read directly off PublishRecord/
// PublishRecordStatsSnapshot columns, never recomputed - the same source
// AnalyticsService's Top Clips/Videos and Overview/Trend endpoints read, so
// this can never disagree with those dashboards for the same publish
// record. `score` reuses getExplainability's own mapping calls so this
// section can never drift from GET /clips/:id/explainability's output for
// the same clip. `audience` is always unavailable in v1 - no connected
// platform exposes demographics data through this app's API access today.
// `insight` is a rules-based narrative over already-computed numbers
// (generateClipNarrative) plus a heuristic statistical projection
// (predictEngagement) - no new AI inference, no Fusion Engine changes, no
// new trained model.
export function toClipPerformanceDto(
  clip: ClipWithPerformance,
  historicalRecords: HistoricalOwnerRecord[],
): ClipPerformanceDto {
  const performance: ClipPerformanceDto['performance'] = clip.publishRecords.map((record) => ({
    publishRecordId: record.id,
    platform: record.socialAccount.platform as unknown as SharedSocialPlatform,
    status: record.status as unknown as SharedPublishStatus,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    history: record.statsSnapshots.map((snapshot) => ({
      capturedAt: snapshot.capturedAt.toISOString(),
      viewCount: snapshot.viewCount,
      likeCount: snapshot.likeCount,
      commentCount: snapshot.commentCount,
      shareCount: snapshot.shareCount,
      watchTimeSeconds: snapshot.watchTimeSeconds,
      engagementScore: snapshot.engagementScore,
    })),
  }));

  const traffic: ClipPerformanceDto['traffic'] = clip.publishRecords.map((record) => ({
    publishRecordId: record.id,
    platform: record.socialAccount.platform as unknown as SharedSocialPlatform,
    status: record.status as unknown as SharedPublishStatus,
    scheduledAt: record.scheduledAt?.toISOString() ?? null,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    campaign: record.campaign ? { id: record.campaign.id, name: record.campaign.name } : null,
    recurringSchedule: record.recurringSchedule
      ? { id: record.recurringSchedule.id, name: record.recurringSchedule.name }
      : null,
    // Sprint 6K (Conversion) - null means "no TrackedLink created for this
    // publish record yet," never a fabricated 0.
    conversionCount:
      record.trackedLinks.length > 0
        ? record.trackedLinks.reduce((sum, link) => sum + link.clickCount, 0)
        : null,
  }));

  const sharedBreakdown = toSharedHighlightBreakdown(clip.highlightBreakdown);
  const sharedExplainability = toSharedHighlightExplainability(clip.highlightExplainability);

  // This clip's own real outcome - averaged across its own publish
  // records' LATEST snapshot only (not blended across full history, which
  // would skew toward older/lower numbers) - each series' history is
  // oldest-first, so the last entry is the latest.
  const ownEngagementScores = performance
    .map((p) => p.history[p.history.length - 1]?.engagementScore ?? null)
    .filter((v): v is number => v !== null);

  const historicalEngagementScores = historicalRecords
    .map((r) => r.engagementScore)
    .filter((v): v is number => v !== null);
  const historicalPairs: PredictionPair[] = historicalRecords.filter(
    (r): r is { highlightScore: number; engagementScore: number } =>
      r.highlightScore !== null && r.engagementScore !== null,
  );

  const narrative = generateClipNarrative(
    { topFactors: sharedExplainability.topFactors, breakdown: sharedBreakdown },
    { engagementScore: average(ownEngagementScores), ownerEngagementScores: historicalEngagementScores },
  );
  const prediction = predictEngagement(clip.highlightScore, historicalPairs);
  const insight: ClipPerformanceDto['insight'] = { ...narrative, prediction };

  return {
    clipId: clip.id,
    videoId: clip.videoId,
    performance,
    score: [
      {
        engine: 'v2',
        highlightScore: clip.highlightScore,
        highlightConfidence: clip.highlightConfidence,
        highlightReason: clip.highlightReason,
        highlightBreakdown: sharedBreakdown,
        highlightExplainability: sharedExplainability,
        highlightPrediction: toSharedHighlightPrediction(clip.highlightPrediction),
        highlightRecommendation: toSharedHighlightRecommendation(clip.highlightRecommendation),
        highlightRank: clip.highlightRank,
      },
    ],
    traffic,
    audience: {
      available: false,
      reason: "No connected platform exposes audience demographics through this app's API access today.",
    },
    insight,
  };
}
