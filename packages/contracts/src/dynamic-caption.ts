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

// "High emotion -> large text; whisper -> small text" (spec Part 8).
// 'normal' is the majority-case default - most caption lines get no size
// change at all.
export const CAPTION_SIZE_TIERS = ['small', 'normal', 'large'] as const;
export const captionSizeTierSchema = z.enum(CAPTION_SIZE_TIERS);
export type CaptionSizeTier = z.infer<typeof captionSizeTierSchema>;

// "Shock -> punch animation; question -> attention animation" (spec Part
// 8) - 'none' is the majority-case default. Mutually exclusive with each
// other (a line gets at most one animation), and rate-limited across the
// whole clip so animation stays a highlight, not a constant flicker
// ("Do NOT overuse animation" - spec Part 8's own explicit constraint,
// enforced by @speedora/dynamic-caption's cooldown, not by this contract).
export const CAPTION_ANIMATIONS = ['none', 'punch', 'attention'] as const;
export const captionAnimationSchema = z.enum(CAPTION_ANIMATIONS);
export type CaptionAnimation = z.infer<typeof captionAnimationSchema>;

// One treatment decision per SubtitleLine (start/end mirror that line's
// own timing exactly - clip-relative seconds, same coordinate frame as
// SubtitleTimeline).
export const treatmentMomentSchema = z.object({
  start: z.number(),
  end: z.number(),
  sizeTier: captionSizeTierSchema,
  animation: captionAnimationSchema,
});
export type TreatmentMoment = z.infer<typeof treatmentMomentSchema>;

// A dense, 1:1-with-`SubtitleTimeline` array (not a filtered/sparse one
// like HighlightTimeline) - every caption line gets a real treatment
// decision, even when it's the 'normal'/'none' default. Bare array, no
// clipId wrapper - same shape as MomentumCurve/EmotionalArc (a single
// per-instant timeline, not a compound multi-array object like
// SubtitleIntelligence/RetentionCurveInsights).
export const captionTreatmentTimelineSchema = z.array(treatmentMomentSchema);
export type CaptionTreatmentTimeline = z.infer<typeof captionTreatmentTimelineSchema>;

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
