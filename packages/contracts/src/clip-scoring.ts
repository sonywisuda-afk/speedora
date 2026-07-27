import { z } from 'zod';
import { transcriptWordSchema } from './transcript-word';

// The clip-scoring module's OWN transcript shape - deliberately narrower than
// packages/shared's DB-hydrated TranscriptSegment (which also carries
// speaker/emotion labels this module never reads). The module's input
// contract should only demand what the module actually uses; the adapter
// (apps/worker) is responsible for narrowing a full TranscriptSegment down
// to this shape, so the module itself never needs to know a TranscriptSegment
// row exists.
export const clipScoringSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(transcriptWordSchema).optional(),
});

export const clipScoringInputSchema = z.object({
  segments: z.array(clipScoringSegmentSchema),
  // Pre-Processing Settings roadmap (Phase 0/1) - overrides for the
  // module's own MAX_CANDIDATES/MIN_CLIP_SECONDS/MAX_CLIP_SECONDS constants,
  // threaded through from Video.processingOptions by the caller (apps/worker's
  // detect-clips adapter). Optional/omitted means "use the module's own
  // default" - every existing caller/fixture that predates this field keeps
  // its exact current behavior.
  maxCandidates: z.number().int().positive().optional(),
  minClipSeconds: z.number().positive().optional(),
  maxClipSeconds: z.number().positive().optional(),
  // Pre-Processing Settings roadmap (Phase 2) - a real pre-cap minimum on
  // the LLM's own viralityScore (0-100), not a fabricated new confidence
  // signal. Optional/omitted means "no minimum" - every existing
  // caller/fixture keeps its exact current behavior.
  minConfidence: z.number().min(0).max(100).optional(),
  // Pre-Processing Settings roadmap (Phase 2) - a subset of CLIP_INTENTS
  // (below) the caller wants prioritized when there are more in-range,
  // long-enough candidates than maxCandidates allows. A stable re-ordering
  // before the cap, not a hard filter - a candidate whose intent isn't
  // listed can still survive if there's room. Optional/omitted (or empty)
  // means "no preference," same current behavior.
  preferredIntents: z.array(z.string()).optional(),
});

// Mirrors packages/shared's ClipScores shape (Fase 8 - Content
// Intelligence, extended Fase 32 with practicalValue/ctaStrength).
// Duplicated here rather than imported so this contract has no dependency
// on packages/shared at all - the two are expected to stay in sync by
// convention (both describe the same LLM-scored dimensions), not by a
// shared import, since a DB-facing package and a DB-agnostic contract
// package should not depend on each other in either direction.
//
// Fase 32 (explicit user direction) - grouped into four domains so future
// metrics get added to an existing domain rather than growing this object
// one field at a time forever:
//   - Engagement: hookStrength, curiosity, emotion, storytelling
//   - Knowledge:  educationalValue, practicalValue, novelty, trustAuthority
//   - Conversion: ctaStrength
// See SCORE_DOMAINS below - the grouping is documented/used for feature
// naming in the Fusion Engine's extraction step (packages/fusion-engine),
// not (yet) a separate domain-level weighting mechanism - see that
// package's own comments for why that's an intentionally-deferred next
// step, not an oversight.
export const clipScoresSchema = z.object({
  hookStrength: z.number(),
  educationalValue: z.number(),
  // Fase 32 - "how much a viewer can immediately apply the clip's
  // information with minimal additional knowledge." Scored independently
  // from educationalValue/curiosity/etc. Higher for concrete steps,
  // followable instructions, worked examples, checklists/procedures,
  // directly-applicable solutions, or content that answers a "how do I"
  // question. Lower for content that's purely opinion, motivation, theory,
  // a story with no concrete takeaway, or too abstract to act on.
  practicalValue: z.number(),
  curiosity: z.number(),
  emotion: z.number(),
  storytelling: z.number(),
  novelty: z.number(),
  trustAuthority: z.number(),
  // Fase 32 - how persuasive/compelling the clip's call-to-action is (0 if
  // there's no CTA at all) - a numeric companion to the existing free-text
  // ctaText field, scored independently so the Fusion Engine has a number
  // to weight rather than needing to infer strength from ctaText's prose.
  ctaStrength: z.number(),
});

export const SCORE_DOMAINS = {
  engagement: ['hookStrength', 'curiosity', 'emotion', 'storytelling'],
  knowledge: ['educationalValue', 'practicalValue', 'novelty', 'trustAuthority'],
  conversion: ['ctaStrength'],
} as const satisfies Record<string, (keyof z.infer<typeof clipScoresSchema>)[]>;

export const CLIP_INTENTS = [
  'educate',
  'entertain',
  'persuade',
  'inspire',
  'story',
  'other',
] as const;

export const clipScoringCandidateSchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  viralityScore: z.number().min(0).max(100),
  hookText: z.string(),
  hashtags: z.array(z.string()),
  scores: clipScoresSchema,
  reason: z.string(),
  topics: z.array(z.string()),
  keywords: z.array(z.string()),
  intent: z.enum(CLIP_INTENTS),
  ctaText: z.string(),
});

export const clipScoringOutputSchema = z.object({
  candidates: z.array(clipScoringCandidateSchema),
});

export type ClipScoringSegment = z.infer<typeof clipScoringSegmentSchema>;
export type ClipScoringInput = z.infer<typeof clipScoringInputSchema>;
export type ClipScores = z.infer<typeof clipScoresSchema>;
export type ClipIntent = (typeof CLIP_INTENTS)[number];
export type ClipScoringCandidate = z.infer<typeof clipScoringCandidateSchema>;
export type ClipScoringOutput = z.infer<typeof clipScoringOutputSchema>;
