import { z } from 'zod';
import { clipScoresSchema } from './clip-scoring';
import { narrativeGraphSchema } from './narrative-graph';
import { semanticEventSchema } from './semantic-events';

// AI Intelligence v4 Phase 13.2 (Clip Ranking Engine, Stage B - see
// docs/ai/clip-ranking-engine.md). A cheap, transcript-only pre-rank over a
// scoreClipCandidates() pool, run BEFORE any Clip row is persisted or any
// render-graph work happens - shortlists an expanded candidate pool (up to
// Phase 13.1's 30) down to a size Stage C's (existing, unchanged)
// render-graph can affordably run on. Every numeric field here is a
// documented HEURISTIC (ADR D4, docs/coding-standards.md's "scale
// honesty") - never present as ML-model output downstream without this
// caveat.

// Deliberately narrower than a full TranscriptSegment (no
// speaker/emotion/words) - same "keep input narrow" convention as
// semanticEventDetectionSegmentSchema/narrativeGraphDetectionSegmentSchema,
// which this module re-derives its own per-candidate segments into
// internally.
export const shortlistDetectionSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
});
export type ShortlistDetectionSegment = z.infer<typeof shortlistDetectionSegmentSchema>;

export const shortlistCandidateInputSchema = z.object({
  // Absolute (video-relative) seconds, same units as `segments` below - the
  // module re-anchors to candidate-relative time internally before calling
  // @speedora/semantic-events/@speedora/narrative-graph, same convention as
  // every render-graph node's own toXSegments() helper.
  startTime: z.number(),
  endTime: z.number(),
  // Tier 1 (free) signals - already computed by the same
  // scoreClipCandidates() LLM call that produced this candidate, reused
  // here rather than recomputed.
  scores: clipScoresSchema,
  viralityScore: z.number().min(0).max(100),
  // This candidate's own overlapping transcript slice.
  segments: z.array(shortlistDetectionSegmentSchema),
});
export type ShortlistCandidateInput = z.infer<typeof shortlistCandidateInputSchema>;

export const shortlistCandidatesInputSchema = z.object({
  candidates: z.array(shortlistCandidateInputSchema),
  // Optional - omitted means the module's own default (see
  // @speedora/candidate-shortlist's DEFAULT_SHORTLIST_TARGET_SIZE).
  targetSize: z.number().int().positive().optional(),
});
export type ShortlistCandidatesInput = z.infer<typeof shortlistCandidatesInputSchema>;

export const shortlistedCandidateSchema = z.object({
  // Position in the ORIGINAL candidates[] array passed in - this module
  // never reorders/mutates the caller's own candidate objects, only
  // reports which indices survived and in what order.
  index: z.number().int().nonnegative(),
  preRankScore: z.number(),
  // Present for transparency/debugging only - Phase 13.2 does not persist
  // either onto any Clip row (no schema change this phase). Stage C's
  // (unchanged) render-graph independently recomputes both for whichever
  // candidates survive to render, WITH real OCR/object grounding evidence
  // this pre-render pass can never have - see clip-ranking-engine.md's
  // "Phase 13.2 architecture" section for why paying for both is a
  // deliberate scope decision, not an oversight.
  semanticEvents: z.array(semanticEventSchema).nullable(),
  narrativeGraph: narrativeGraphSchema.nullable(),
});
export type ShortlistedCandidate = z.infer<typeof shortlistedCandidateSchema>;

export const shortlistCandidatesOutputSchema = z.object({
  // Sorted desc by preRankScore, length = min(targetSize, candidates.length).
  shortlisted: z.array(shortlistedCandidateSchema),
});
export type ShortlistCandidatesOutput = z.infer<typeof shortlistCandidatesOutputSchema>;
