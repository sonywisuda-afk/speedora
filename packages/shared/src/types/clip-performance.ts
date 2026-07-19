import type { ClipEngineExplainability } from './explainability';
import type { PublishStatus, SocialPlatform } from './social';
import type { UnavailableSection } from './unavailable';
import type { FusionContribution, FusionFactor } from './video';

// Sprint 6C (Analytics Dashboard Expansion - Per-Clip Performance). One
// point per PublishRecordStatsSnapshot for one PublishRecord - full history,
// not just the latest snapshot AnalyticsService's Top Clips/Videos
// endpoints use, so a creator can see a real trend for this one clip on
// this one platform. Same field set/semantics as
// PublishRecordStatsSnapshot itself - never recomputed, so these numbers
// can never drift from what the Overview/Trend dashboards show for the
// same publish record.
export interface ClipPerformanceHistoryPoint {
  capturedAt: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  watchTimeSeconds: number | null;
  engagementScore: number | null;
}

export interface ClipPerformancePlatformSeries {
  publishRecordId: string;
  platform: SocialPlatform;
  status: PublishStatus;
  publishedAt: string | null;
  // Oldest-first, ready to plot directly - same convention as
  // AnalyticsPerformanceDto's engagementTrend.
  history: ClipPerformanceHistoryPoint[];
}

// Speedora's own distribution metadata - never platform-referrer traffic
// (search/browse/suggested/external), which no connected platform exposes
// without the deferred YouTube Analytics API. campaign/recurringSchedule are
// independent, not mutually exclusive - a PublishRecord can belong to
// neither, either, or both (see PublishRecord's own schema comment), so
// this stays two nullable fields rather than collapsing into one invented
// "source" enum that would misrepresent that combination.
export interface ClipTrafficEntry {
  publishRecordId: string;
  platform: SocialPlatform;
  status: PublishStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  campaign: { id: string; name: string } | null;
  recurringSchedule: { id: string; name: string } | null;
  // Sprint 6K (Conversion) - null means "no TrackedLink created for this
  // publish record yet" (not zero clicks - a real, honest distinction,
  // same "no data is not zero" convention used throughout this app).
  // Summed across every TrackedLink attached to this one publish record if
  // more than one exists, bot-filtered.
  conversionCount: number | null;
}

// No platform this app integrates with exposes audience demographics data
// today (see platform-capability.util.ts) - always unavailable in v1,
// honestly, rather than a fabricated estimate. Sprint 6H generalized this
// shape into UnavailableSection (Retention/Drop-off/Replay reuse it too) -
// kept as its own named type here since existing callers already reference
// ClipAudienceSection directly.
export type ClipAudienceSection = UnavailableSection;

// Sprint 6I (AI Insight) - rules-based narrative composed entirely over
// already-computed numbers (highlightExplainability.topFactors/
// highlightBreakdown, plus real engagementScore outcomes) - zero new AI
// inference, no Fusion Engine changes. topSignals/lowSignals reuse
// FusionFactor/FusionContribution directly (the same shapes
// highlightExplainability.topFactors/highlightBreakdown already use)
// rather than inventing a parallel signal shape.
export type ClipPerformanceClassification =
  | 'over_performed'
  | 'under_performed'
  | 'as_expected'
  | 'not_enough_data';

export interface ClipInsightSection {
  classification: ClipPerformanceClassification;
  summary: string;
  // Highest-weightedContribution factors - "why viral" - straight from
  // highlightExplainability.topFactors, just re-sorted defensively (same
  // "don't assume the API's ordering forever" posture as
  // lib/explainability.ts's sortTopFactors).
  topSignals: FusionFactor[];
  // Lowest-weightedContribution factors among signals that actually have
  // real weight (weight 0 = not yet calibrated, so "low" there is
  // meaningless, not a real finding about this clip) - "why fail."
  lowSignals: FusionContribution[];
  // How many of this clip's owner's OTHER published clips this comparison
  // was based on - shown so a `not_enough_data` classification is
  // self-explanatory rather than silently indistinguishable from a real
  // classification with zero history.
  comparedAgainst: number;
  // Sprint 6J - the "predicted" half of AI Insight. A heuristic statistical
  // projection (Pearson correlation + simple linear regression, reusing
  // packages/dataset-quality's exact pearsonCorrelation/
  // MIN_SAMPLES_FOR_CORRELATION - the same function /ops/ai/correlation
  // already uses, just scoped per-owner instead of pooled system-wide) -
  // explicitly NOT a new trained model (Fusion Engine v3's ML pipeline is
  // paused pending real production data and untouched by this). Scoped to
  // engagementScore only - predicting Revenue or Conversion is out of
  // scope here and everywhere else in this app; see the project's
  // no-fabricated-business-KPIs rule.
  prediction: ClipPredictionSection;
}

export interface ClipPredictionSection {
  available: boolean;
  // Present whenever available is false - same "hasEnoughSamples" graceful-
  // degrade convention /ops/ai/correlation already uses, just explained in
  // prose here instead of a raw boolean+count pair.
  reason?: string;
  sampleCount: number;
  minSamplesRequired: number;
  // Null whenever a coefficient couldn't be computed (too little
  // variance/data) - see pearsonCorrelation's own null-return cases.
  correlation: number | null;
  predictedEngagementScore: number | null;
}

// GET /clips/:id/performance - deliberately single-clip-oriented: every
// field here is this one clip's own publish records/snapshots/AI output,
// never an aggregate across other clips (that's AnalyticsService's job) -
// insight's comparedAgainst count is the one deliberate exception, needed
// to classify this clip's own outcome against a real baseline. Each
// section is independently shaped so a future section can be added as a
// new top-level key without changing any existing one - performance/
// traffic entries carry publishRecordId (and traffic carries campaign.id)
// specifically so a future Revenue/Conversion surface (Sprint 6G/6K) can
// join against this same response without a contract change either.
export interface ClipPerformanceDto {
  clipId: string;
  videoId: string;
  performance: ClipPerformancePlatformSeries[];
  // Same shape as ClipEngineExplainability itself (GET
  // /clips/:id/explainability's own `results` array) - reused directly so
  // this section can never drift from what that endpoint already returns
  // for the same clip.
  score: ClipEngineExplainability[];
  traffic: ClipTrafficEntry[];
  audience: ClipAudienceSection;
  insight: ClipInsightSection;
}
