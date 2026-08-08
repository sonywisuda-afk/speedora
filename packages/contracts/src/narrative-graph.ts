import { z } from 'zod';

// AI Intelligence v4, Phase 3 (Narrative Graph - see docs/ai/
// intelligence-v4.md). Segments a clip into a real story structure - the
// exact 10-value taxonomy from the original brief, in lowercase
// (single-word, no underscore needed unlike Phase 2's SEMANTIC_EVENT_TYPES).
// Same "plain string union, not a Prisma-column enum" posture as
// SemanticEventType - Contract Governance rules 2-4 don't apply, but rule
// 1's exhaustiveness discipline does: packages/narrative-graph's
// describeSegmentType() is a real exhaustive switch/assertNever over every
// value below.
export const NARRATIVE_SEGMENT_TYPES = [
  'hook',
  'setup',
  'context',
  'problem',
  'conflict',
  'escalation',
  'peak',
  'resolution',
  'takeaway',
  'cta',
] as const;
export type NarrativeSegmentType = (typeof NARRATIVE_SEGMENT_TYPES)[number];

// Every numeric field below is a documented HEURISTIC (ADR D4,
// docs/coding-standards.md's "scale honesty") - no production engagement
// data exists yet to calibrate confidence against. Never present these as
// ML-model output downstream (UI copy, API docs) without this caveat.
export const narrativeSegmentSchema = z.object({
  // Stable within one graph (0-based) - what narrativeRelationSchema's
  // fromSegmentId/toSegmentId reference. Not a global id; only meaningful
  // alongside the sibling segments in the same NarrativeGraph.
  id: z.number().int().nonnegative(),
  type: z.enum(NARRATIVE_SEGMENT_TYPES),
  // Clip-relative seconds.
  startTime: z.number(),
  endTime: z.number(),
  // LLM-SELF-REPORTED certainty about this segment's `type` classification,
  // not a code-computed coverage fraction - same "kind of confidence" as
  // SemanticEvent.confidence, unlike HookPredictionOutput.confidence/
  // ViralityPrediction.confidence. Full taxonomy: docs/ai/intelligence-v4.md's
  // "Phase 8 architecture (as shipped)" section.
  confidence: z.number().min(0).max(1),
  // Human-readable explanation, same "written for a human, not a log
  // message" convention as SemanticEvent's own `reason` field.
  reason: z.string(),
});
export type NarrativeSegment = z.infer<typeof narrativeSegmentSchema>;

// What makes this a GRAPH, not a sliding window (the roadmap's own
// framing): `resolves` edges are explicitly allowed to connect
// NON-ADJACENT segments (e.g. a Takeaway resolving a Problem stated much
// earlier), something a sliding window has no way to express. Deliberately
// kept to 2 values, not a larger vocabulary - this is already the hardest
// LLM-reasoning task in the roadmap so far; a bigger relation taxonomy
// multiplies that risk without a clear product need yet.
export const NARRATIVE_RELATION_TYPES = ['leads_to', 'resolves'] as const;
export type NarrativeRelationType = (typeof NARRATIVE_RELATION_TYPES)[number];

export const narrativeRelationSchema = z.object({
  fromSegmentId: z.number().int().nonnegative(),
  toSegmentId: z.number().int().nonnegative(),
  type: z.enum(NARRATIVE_RELATION_TYPES),
});
export type NarrativeRelation = z.infer<typeof narrativeRelationSchema>;

// The module's full output. `unsegmented: true` (segments/relations both
// empty) is a REAL, SUCCESSFUL result - the LLM ran, and
// @speedora/narrative-graph's own validateGraph() determined this clip
// doesn't decompose cleanly into the taxonomy above - not a failure, and
// not distinguishable from one by checking for null (this whole object is
// still non-null in that case). Same "a degenerate-but-real result isn't
// an error" convention as Phase 2's empty SemanticEvent[] case. This is
// the roadmap's explicitly-required risk mitigation for this phase: never
// force a 10-node graph onto content that doesn't have one, since a
// silently-wrong graph would read as authoritative wherever it's surfaced.
export const narrativeGraphSchema = z.object({
  segments: z.array(narrativeSegmentSchema),
  relations: z.array(narrativeRelationSchema),
  unsegmented: z.boolean(),
});
export type NarrativeGraph = z.infer<typeof narrativeGraphSchema>;

// Deliberately narrower than hook-prediction's/semantic-events' own
// segment input shapes (no emotion/words) - same "keep input narrow"
// convention (ARCHITECTURE.md's checklist).
export const narrativeGraphDetectionSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
});
export type NarrativeGraphDetectionSegment = z.infer<typeof narrativeGraphDetectionSegmentSchema>;
