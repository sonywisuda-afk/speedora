import type {
  ExplainabilityReasonEntry,
  FusionBreakdown,
  FusionExplainability,
  HistogramBucket,
  SignalContributionEntry,
} from '@speedora/shared';

// Milestone 5C-A/5C-B - pure aggregation over Fusion Engine output, shared
// between AnalyticsService (owner-scoped input) and OpsAiService
// (system-wide input, no ownerId filter) - same functions, different
// candidate-clip set. No Prisma access here, same module/adapter split as
// performance.util.ts. Moved from apps/api/src/analytics/ into this package
// so apps/worker (which cannot import from apps/api) can reuse the exact
// same computation for the Analytics Report PDF.

const SCORE_BUCKET_COUNT = 10;

// 10 fixed-width buckets over highlightScore's [0, 100] range. Clamped
// defensively, same posture as computeConfidenceDistribution.
export function computeScoreDistribution(scores: number[]): HistogramBucket[] {
  const counts = new Array(SCORE_BUCKET_COUNT).fill(0) as number[];
  for (const score of scores) {
    const clamped = Math.min(100, Math.max(0, score));
    const index = clamped === 100 ? counts.length - 1 : Math.floor(clamped / 10);
    counts[index] += 1;
  }
  return counts.map((count, i) => ({ bucket: `${i * 10}-${(i + 1) * 10}`, count }));
}

// Each signal's share of the total weightedContribution mass across every
// clip's breakdown in scope - answers "what's actually moving highlightScore
// today," not "how strong is this signal's raw value" (that's
// normalizedValue, used by @speedora/dataset-quality's calibration
// suggestions instead). Most signals read ~0% since they're still weight 0
// pending calibration (packages/fusion-engine/src/weights.ts) - itself the
// correct, honest signal, not a bug. `clipsWithSignal` counts clips where
// the signal was extracted at all (an entry exists), regardless of its
// weighted magnitude - a completeness read, separate from the contribution %.
export function computeSignalContributions(
  breakdowns: FusionBreakdown[],
): SignalContributionEntry[] {
  const totalBySignal = new Map<string, number>();
  const clipsBySignal = new Map<string, number>();

  for (const breakdown of breakdowns) {
    const signalsSeenThisClip = new Set<string>();
    for (const contribution of breakdown) {
      totalBySignal.set(
        contribution.signal,
        (totalBySignal.get(contribution.signal) ?? 0) + contribution.weightedContribution,
      );
      signalsSeenThisClip.add(contribution.signal);
    }
    for (const signal of signalsSeenThisClip) {
      clipsBySignal.set(signal, (clipsBySignal.get(signal) ?? 0) + 1);
    }
  }

  const totalMass = Array.from(totalBySignal.values()).reduce((sum, v) => sum + v, 0);

  return Array.from(totalBySignal.entries())
    .map(([signal, total]) => ({
      signal,
      averageContributionPct: totalMass === 0 ? 0 : Math.round((total / totalMass) * 1000) / 10,
      clipsWithSignal: clipsBySignal.get(signal) ?? 0,
    }))
    .sort((a, b) => b.averageContributionPct - a.averageContributionPct);
}

// Aggregated reasons - frequency count of explainability.topFactors[].description
// across clips (e.g. "High Emotion" x 42, "Rapid Speech" x 31), normalized to
// a %. Not deduped per clip, same convention as performance.util.ts's
// computeMostCommonSignals.
export function computeExplainabilityReasonFrequency(
  explainabilities: FusionExplainability[],
): ExplainabilityReasonEntry[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const { topFactors } of explainabilities) {
    for (const { description } of topFactors) {
      counts.set(description, (counts.get(description) ?? 0) + 1);
      total += 1;
    }
  }

  return Array.from(counts.entries())
    .map(([description, count]) => ({
      description,
      count,
      pct: total === 0 ? 0 : Math.round((count / total) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);
}
