import type {
  ClipInsightSection,
  ClipPerformanceClassification,
  FusionBreakdown,
  FusionFactor,
} from '@speedora/shared';

// Sprint 6I (AI Insight) - pure narrative composition, no Prisma access,
// no LLM call, no new inference of any kind - every number consumed here
// is already computed (the frozen Fusion Engine's highlightExplainability/
// highlightBreakdown, and real engagementScore outcomes read from
// PublishRecordStatsSnapshot the same way every other sprint's aggregation
// does). This narrates what already happened; it does not predict
// anything - Sprint 6J's predictEngagement() is a deliberately separate
// function (its own concern: a statistical projection, not a narrative),
// so this returns everything on ClipInsightSection except `prediction` -
// the caller composes the two together.
export type ClipNarrativeResult = Omit<ClipInsightSection, 'prediction'>;

const MIN_HISTORICAL_SAMPLES = 5;
// +/-15% of the owner's median engagementScore counts as "as expected" -
// an arbitrary but documented band, not a statistically derived threshold
// (this app has nowhere near enough production engagement data yet to fit
// one - see docs/ai/fusion-v3.md's "0 usable samples" note).
const AS_EXPECTED_BAND = 0.15;
const TOP_SIGNAL_COUNT = 3;
const LOW_SIGNAL_COUNT = 3;

export interface ClipNarrativeClip {
  topFactors: FusionFactor[];
  breakdown: FusionBreakdown;
}

export interface ClipNarrativeOutcome {
  // This clip's own real outcome (e.g. averaged across its own publish
  // records' latest snapshots) - null when it hasn't published yet or
  // stats haven't synced.
  engagementScore: number | null;
  // Real engagementScore outcomes from this clip's owner's OTHER published
  // clips - the baseline this clip is compared against. Never this
  // clip's own records.
  ownerEngagementScores: number[];
}

function median(sortedAscending: number[]): number {
  const mid = Math.floor(sortedAscending.length / 2);
  return sortedAscending.length % 2 === 0
    ? (sortedAscending[mid - 1] + sortedAscending[mid]) / 2
    : sortedAscending[mid];
}

function selectTopSignals(topFactors: FusionFactor[]): FusionFactor[] {
  return [...topFactors]
    .sort((a, b) => Math.abs(b.weightedContribution) - Math.abs(a.weightedContribution))
    .slice(0, TOP_SIGNAL_COUNT);
}

// Only signals with real weight - a weight-0 (not-yet-calibrated) signal
// being "low" isn't a finding about this clip, it was always going to
// contribute 0 regardless of what the clip actually did. Filtering these
// out keeps "why fail" honest given most signals are still weight-0
// pending calibration (see CLAUDE.md's Fusion Engine status).
function selectLowSignals(breakdown: FusionBreakdown): FusionBreakdown {
  return [...breakdown]
    .filter((c) => c.weight > 0)
    .sort((a, b) => a.weightedContribution - b.weightedContribution)
    .slice(0, LOW_SIGNAL_COUNT);
}

export function generateClipNarrative(
  clip: ClipNarrativeClip,
  outcome: ClipNarrativeOutcome,
): ClipNarrativeResult {
  const topSignals = selectTopSignals(clip.topFactors);
  const lowSignals = selectLowSignals(clip.breakdown);

  if (outcome.engagementScore === null) {
    return {
      classification: 'not_enough_data',
      summary:
        'This clip has no real engagement data yet - it may not be published, or stats have not synced.',
      topSignals,
      lowSignals,
      comparedAgainst: 0,
    };
  }

  const validHistory = outcome.ownerEngagementScores
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (validHistory.length < MIN_HISTORICAL_SAMPLES) {
    return {
      classification: 'not_enough_data',
      summary: `Not enough of this creator's other published clips yet (${validHistory.length}) to compare this clip's performance fairly.`,
      topSignals,
      lowSignals,
      comparedAgainst: validHistory.length,
    };
  }

  const baseline = median(validHistory);
  const upperBound = baseline * (1 + AS_EXPECTED_BAND);
  const lowerBound = baseline * (1 - AS_EXPECTED_BAND);

  let classification: ClipPerformanceClassification;
  let summary: string;
  if (outcome.engagementScore > upperBound) {
    classification = 'over_performed';
    summary =
      topSignals.length > 0
        ? `This clip over-performed this creator's typical engagement, consistent with a strong ${topSignals[0].signal} signal (${topSignals[0].description}).`
        : "This clip over-performed this creator's typical engagement.";
  } else if (outcome.engagementScore < lowerBound) {
    classification = 'under_performed';
    summary =
      lowSignals.length > 0
        ? `This clip under-performed this creator's typical engagement, consistent with a low ${lowSignals[0].signal} contribution (${lowSignals[0].feature}).`
        : "This clip under-performed this creator's typical engagement.";
  } else {
    classification = 'as_expected';
    summary = "This clip performed roughly as expected compared to this creator's other published clips.";
  }

  return { classification, summary, topSignals, lowSignals, comparedAgainst: validHistory.length };
}
