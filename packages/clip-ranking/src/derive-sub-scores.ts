import type {
  ClipRankSubScores,
  ComputeClipRankInput,
  RetentionCurveInsights,
  RetentionPoint,
} from '@speedora/contracts';
import { deriveNarrativeGraphScore, deriveSemanticEventsScore } from '@speedora/virality-engine';

function average(points: RetentionPoint[]): number {
  return points.reduce((sum, point) => sum + point.score, 0) / points.length;
}

// Retention (never null - RetentionCurveInsights is a pure, zero-LLM
// derive that always runs, Phase 10). Two components: a penalty from
// dropPoints (each point's own `score` is ALREADY the drop's severity,
// 0-1 - see @speedora/retention-curve-insights' findDropPoints, which
// computes it as `1 - momentumScore` at the trough), and a bonus from the
// three positive-signal arrays (replayZones/emotionalPeaks/
// curiosityPeaks, each already scored 0-1 in the direction "higher is
// better"). A clip with no detected points in either direction lands at
// the neutral baseline - a genuinely flat/uneventful momentum curve is
// neither penalized nor rewarded, since this signal alone can't tell
// whether that's actually bad.
const RETENTION_BASELINE = 60;
const RETENTION_DROP_PENALTY_WEIGHT = 40;
const RETENTION_ENGAGEMENT_BONUS_WEIGHT = 40;

function retentionScore(insights: RetentionCurveInsights): number {
  const dropPenalty =
    insights.dropPoints.length === 0
      ? 0
      : average(insights.dropPoints) * RETENTION_DROP_PENALTY_WEIGHT;
  const engagementPoints = [
    ...insights.replayZones,
    ...insights.emotionalPeaks,
    ...insights.curiosityPeaks,
  ];
  const engagementBonus =
    engagementPoints.length === 0
      ? 0
      : average(engagementPoints) * RETENTION_ENGAGEMENT_BONUS_WEIGHT;
  return Math.max(0, Math.min(100, RETENTION_BASELINE - dropPenalty + engagementBonus));
}

// Pure, synchronous - the module's own per-clip sub-score derivation, one
// dimension at a time. Narrative/Semantic Importance reuse
// @speedora/virality-engine's own scoring formulas (also used by Stage B's
// @speedora/candidate-shortlist - see that package's own doc comment on
// why they were relocated there rather than kept package-private) but
// apply Stage D's own null-handling: excluded from the composite entirely
// (null) rather than scored at virality-engine's own neutral midpoint (50)
// - achieved by simply not calling the shared function when the input
// itself is null, not by changing that function's behavior.
export function deriveSubScores(input: ComputeClipRankInput): ClipRankSubScores {
  return {
    fusion: input.highlightScore,
    virality:
      input.viralityPrediction.overallViralScore === null
        ? null
        : input.viralityPrediction.overallViralScore * 100,
    narrative:
      input.narrativeGraph === null ? null : deriveNarrativeGraphScore(input.narrativeGraph),
    hook: input.hookPrediction === null ? null : input.hookPrediction.hookProbability,
    retention: retentionScore(input.retentionCurveInsights),
    semanticImportance:
      input.semanticEvents === null ? null : deriveSemanticEventsScore(input.semanticEvents),
    novelty: input.scores.novelty,
    emotion: input.scores.emotion,
    practicalValue: input.scores.practicalValue,
    educationalValue: input.scores.educationalValue,
    curiosity: input.scores.curiosity,
    trustAuthority: input.scores.trustAuthority,
  };
}
