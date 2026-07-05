import { z } from 'zod';

// The clip-scoring module's OWN transcript shape - deliberately narrower than
// packages/shared's DB-hydrated TranscriptSegment (which also carries
// speaker/emotion labels this module never reads). The module's input
// contract should only demand what the module actually uses; the adapter
// (apps/worker) is responsible for narrowing a full TranscriptSegment down
// to this shape, so the module itself never needs to know a TranscriptSegment
// row exists.
export const transcriptWordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});

export const clipScoringSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(transcriptWordSchema).optional(),
});

export const clipScoringInputSchema = z.object({
  segments: z.array(clipScoringSegmentSchema),
});

// Mirrors packages/shared's ClipScores shape (Fase 8 - Content
// Intelligence). Duplicated here rather than imported so this contract has
// no dependency on packages/shared at all - the two are expected to stay in
// sync by convention (both describe the same 7 LLM-scored dimensions), not
// by a shared import, since a DB-facing package and a DB-agnostic contract
// package should not depend on each other in either direction.
export const clipScoresSchema = z.object({
  hookStrength: z.number(),
  educationalValue: z.number(),
  curiosity: z.number(),
  emotion: z.number(),
  storytelling: z.number(),
  novelty: z.number(),
  trustAuthority: z.number(),
});

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

export type TranscriptWordInput = z.infer<typeof transcriptWordSchema>;
export type ClipScoringSegment = z.infer<typeof clipScoringSegmentSchema>;
export type ClipScoringInput = z.infer<typeof clipScoringInputSchema>;
export type ClipScores = z.infer<typeof clipScoresSchema>;
export type ClipIntent = (typeof CLIP_INTENTS)[number];
export type ClipScoringCandidate = z.infer<typeof clipScoringCandidateSchema>;
export type ClipScoringOutput = z.infer<typeof clipScoringOutputSchema>;
