import { z } from 'zod';
import { emotionalArcSampleSchema } from './emotional-arc';
import { highlightTimelineSchema, subtitleTimelineSchema } from './subtitle-rewriter';

// AI Intelligence v4 Track B, Phase B1 (Dynamic Caption Engine, spec Part 8
// - data only, see docs/ai/subtitle-intelligence.md). PURE composition over
// Phase A1's own already-computed outputs (SubtitleTimeline/
// HighlightTimeline) plus Phase 5's EmotionalArc - no new detector, no LLM
// call, same zero-LLM shape as Phase 4/5/6/7/10/A1 (DB2/DB7). This phase
// only decides WHAT treatment each caption line deserves (size/animation);
// wiring that decision into the actual ASS renderer is Phase B2's job
// (DB4's "data first" pattern, same split A1/A2 already used).
//
// Every field below is a documented HEURISTIC (ADR D4, docs/coding-
// standards.md's "scale honesty") - no engagement/readability data exists
// to calibrate the intensity/animation thresholds against. Never present
// this as a trained "optimal caption styling" model downstream without
// this caveat.
//
// CaptionSizeTier/CaptionAnimation/TreatmentMoment/CaptionTreatmentTimeline
// themselves now live in ./subtitles (moved there in Phase B2 - see that
// file's own comment for why: subtitleSegmentSchema needs them too, and
// this file already imports from ./subtitle-rewriter, which itself imports
// from ./subtitles - defining them here would create a cycle). Nothing
// downstream of this file needs to change: every consumer already imports
// these types from '@speedora/contracts' (the package root), never from
// this specific file.

// Deliberately narrow (ARCHITECTURE.md's checklist) - every field is
// already-computed elsewhere in the render pipeline; this module derives
// nothing raw of its own. Reuses @speedora/subtitle-rewriter's own
// subtitleTimelineSchema/highlightTimelineSchema directly (not
// near-duplicate copies) - same cross-contract-file-import precedent every
// phase since contextual-momentum.ts already set.
export const computeCaptionTreatmentInputSchema = z.object({
  timeline: subtitleTimelineSchema,
  highlights: highlightTimelineSchema,
  emotionalArc: z.array(emotionalArcSampleSchema),
});
export type ComputeCaptionTreatmentInput = z.infer<typeof computeCaptionTreatmentInputSchema>;
