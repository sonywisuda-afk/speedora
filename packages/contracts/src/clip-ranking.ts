import { z } from 'zod';
import { clipScoresSchema } from './clip-scoring';
import {
  conversationDynamicsSchema,
  conversationTypeResultSchema,
} from './conversation-intelligence';
import { hookPredictionOutputSchema } from './hook-prediction';
import { narrativeGraphSchema } from './narrative-graph';
import { retentionCurveInsightsSchema } from './retention-curve-insights';
import { semanticEventSchema } from './semantic-events';
import { viralityPredictionSchema } from './virality-engine';

// AI Intelligence v4 Phase 14.1 (Clip Ranking Engine, Stage D scoring - see
// docs/ai/clip-ranking-engine.md). Originally composed the 12 dimensions
// named in the mission (Fusion, Virality, Narrative, Hook, Retention,
// Semantic Importance, Novelty, Emotion, Practical Value, Educational
// Value, Curiosity, Trust) into one ranked order over a batch of
// already-rendered clips (Stage C's shortlist survivors). This is scoring
// only - Phase 14.1 deliberately does NOT wire this into the render
// pipeline; assembling the input batch from real Clip rows, and deciding
// WHEN enough of a shortlist has finished rendering to call it, is Phase
// 14.2's own, separately-confirmed job (clip-ranking-engine.md's "pipeline
// join point" note).
//
// Speaker Intelligence Phase D added a 13th dimension, conversationEngagement
// (see docs/ai/speaker-intelligence.md) - deliberately NOT named
// "conversationDynamics" to avoid colliding with @speedora/contracts' own
// ConversationDynamics type name one level down. Reuses Phase C's own
// already-computed ConversationDynamics/ConversationTypeResult as input -
// no new detector, no new LLM call, no change to Fusion Engine v2's
// weights.ts (a completely separate module from this one).
//
// Every numeric field here is a documented HEURISTIC (ADR D4,
// docs/coding-standards.md's "scale honesty") - no engagement data exists
// to calibrate weights against. Never present as ML-model output
// downstream (UI copy, API docs) without this caveat.

export const clipRankSubScoresSchema = z.object({
  // Each already 0-100, null when its source phase's data is genuinely
  // unavailable for this clip (an LLM call failed, or that signal never
  // ran) - never a fabricated 0/50 default, same convention every prior
  // v4 composite (ViralityPrediction, HookPredictionOutput) already uses.
  fusion: z.number().min(0).max(100).nullable(),
  virality: z.number().min(0).max(100).nullable(),
  narrative: z.number().min(0).max(100).nullable(),
  hook: z.number().min(0).max(100).nullable(),
  // Never null - RetentionCurveInsights is a pure, zero-LLM derive that
  // always runs (Phase 10); an empty point set still yields a real,
  // neutral-baseline score, not an absence.
  retention: z.number().min(0).max(100),
  semanticImportance: z.number().min(0).max(100).nullable(),
  // From ClipScores - always present (persisted at candidate-creation
  // time, Fase 32), never null.
  novelty: z.number().min(0).max(100),
  emotion: z.number().min(0).max(100),
  practicalValue: z.number().min(0).max(100),
  educationalValue: z.number().min(0).max(100),
  curiosity: z.number().min(0).max(100),
  trustAuthority: z.number().min(0).max(100),
  // Speaker Intelligence Phase D. Unlike `retention`, deliberately
  // NULLABLE, not "never null" - even though ConversationDynamics/
  // ConversationTypeResult are ALSO a pure, zero-LLM derive that always
  // runs (same characteristic that makes `retention` non-nullable), a
  // Clip row rendered before Phase C's migration genuinely has no data
  // (Prisma column is real SQL NULL) - see deriveConversationEngagement's
  // own doc comment for the full null-vs-real-0 reasoning, including why
  // monologue clips also score null here (not a low number) rather than
  // being penalized for having nothing to measure on this axis.
  conversationEngagement: z.number().min(0).max(100).nullable(),
});
export type ClipRankSubScores = z.infer<typeof clipRankSubScoresSchema>;

export const clipRankSchema = z.object({
  clipId: z.string(),
  // Average of every non-null dimension in subScores (all already 0-100) -
  // the same "average of non-null" pattern ViralityPrediction.
  // overallViralScore already established one level down (within a single
  // phase's own sub-probabilities), applied here one level up across all
  // 13 dimensions (12 from Phase 14.1 + Phase D's conversationEngagement).
  // Null only if every one of the 13 is null - never happens in practice,
  // since the 6 ClipScores-derived dimensions and `retention` are always
  // present.
  compositeScore: z.number().min(0).max(100).nullable(),
  // CODE-COMPUTED coverage: count(non-null dimensions) / 13 (12 Phase 14.1
  // dimensions + Phase D's conversationEngagement). Same "kind of
  // confidence" as ViralityPrediction.confidence/HookPredictionOutput.
  // confidence - full taxonomy in docs/ai/intelligence-v4.md's "Phase 8
  // architecture (as shipped)" section. Object.keys(subScores).length in
  // the implementation, never a hardcoded literal - stays correct as the
  // dimension count grows.
  confidence: z.number().min(0).max(1),
  subScores: clipRankSubScoresSchema,
  // 1 = highest compositeScore. Clips with a null compositeScore rank
  // last, stable by input order among themselves - same convention as
  // @speedora/fusion-engine's own rankedClipSchema.
  rank: z.number().int().positive(),
});
export type ClipRank = z.infer<typeof clipRankSchema>;

// Deliberately narrow (ARCHITECTURE.md's checklist) - every field is
// already-computed elsewhere in the render pipeline; this module derives
// nothing raw of its own, only composes.
export const computeClipRankInputSchema = z.object({
  clipId: z.string(),
  highlightScore: z.number().min(0).max(100).nullable(),
  scores: clipScoresSchema,
  viralityPrediction: viralityPredictionSchema,
  hookPrediction: hookPredictionOutputSchema.nullable(),
  narrativeGraph: narrativeGraphSchema.nullable(),
  retentionCurveInsights: retentionCurveInsightsSchema,
  semanticEvents: z.array(semanticEventSchema).nullable(),
  // Speaker Intelligence Phase D. Both null together whenever Clip.
  // conversationDynamics/conversationType predate Phase C's migration -
  // the render-graph node that produces them is optional: false, so a
  // post-migration clip always has both or neither, never one alone.
  conversationDynamics: conversationDynamicsSchema.nullable(),
  conversationType: conversationTypeResultSchema.nullable(),
});
export type ComputeClipRankInput = z.infer<typeof computeClipRankInputSchema>;
