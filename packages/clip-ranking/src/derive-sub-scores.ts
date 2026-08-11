import type {
  ClipRankSubScores,
  ComputeClipRankInput,
  ConversationDynamics,
  ConversationTypeResult,
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

// Speaker Intelligence Phase D. Reuses Phase C's own two already-computed
// outputs directly - interactionIntensity (already a 0-1 heuristic
// composite of turn density/back-and-forth/overlap) as the score, scaled
// to 0-100, gated by ConversationTypeResult.type as the "is this axis even
// meaningful for this clip" check. No new detector, no new heuristic
// composite beyond a straight linear scale, no LLM call.
//
// Deliberately null (excluded from the composite average), not a low
// number, for two cases:
// - type === null: genuinely no diarization data (speakerCount 0) -
//   nothing to measure, same "don't fabricate" convention as everywhere
//   else in this codebase.
// - type === 'monologue': a solo speaker. Scoring interactionIntensity
//   here would systematically penalize every solo-creator clip purely for
//   being solo (interactionIntensity is mechanically near-0 for a single
//   speaker - see @speedora/conversation-intelligence's own test fixture),
//   even though solo content is not inherently less valuable. This
//   mirrors classifyConversationType's own explicit non-penalization rule
//   ("single speaker is always monologue... never penalized for having
//   many (self-)turns") one level up: conversational interactivity simply
//   isn't a meaningful axis for monologue content, so it's excluded from
//   the average entirely rather than dragging it down.
//
// Every other type (interview/discussion/debate/podcast, and the
// documented-but-never-produced 'presentation') scores real
// interactionIntensity * 100 - a genuinely low-interaction discussion
// still scores low here, that's real signal, not a penalty for content
// type.
function conversationEngagementScore(
  dynamics: ConversationDynamics,
  classification: ConversationTypeResult,
): number | null {
  if (classification.type === null || classification.type === 'monologue') return null;
  return dynamics.interactionIntensity * 100;
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
    conversationEngagement:
      input.conversationDynamics === null || input.conversationType === null
        ? null
        : conversationEngagementScore(input.conversationDynamics, input.conversationType),
  };
}
