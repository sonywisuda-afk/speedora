import { z } from 'zod';
import { emotionalArcSampleSchema } from './emotional-arc';
import { momentumSampleSchema } from './contextual-momentum';
import { speakerTimelineEntrySchema } from './speaker-timeline';
import { VOCAL_EMOTIONS } from './vocal-emotion';

// AI Intelligence v4, Phase 6 (Multi-speaker Reasoning - see docs/ai/
// intelligence-v4.md). Extends spec Part 6 (Multimodal Reasoning) along a
// different axis than Phase 2's @speedora/multimodal-reasoning: attributing
// Phases 1/4/5's already-computed signals to WHICH SPEAKER, not just WHEN.
// NO LLM call - a pure, post-hoc composition over already-computed data
// (SpeakerTimelineEntry[] from Speaker Intelligence + Phase 4's
// MomentumCurve + Phase 5's EmotionalArc), same zero-LLM shape as Phases
// 4-5. Every numeric field is a documented HEURISTIC (ADR D4) - no
// engagement data exists to calibrate against.

// One entry per distinct speaker with any turn in the clip - not a
// per-instant timeline like MomentumCurve/EmotionalArc.
export const speakerAttributionSchema = z.object({
  // SpeakerTimelineEntry's own label ("Speaker A", "Speaker B", ...).
  speaker: z.string(),
  // 0-1 - this speaker's share of the clip's total speaking time.
  talkTimeRatio: z.number().min(0).max(1),
  // 0-1 - this speaker's share of the OPENING HOOK WINDOW's speaking time
  // (Phase 1 tie-in) - reuses hook-prediction's own HOOK_WINDOW_SECONDS=5
  // heuristic (re-declared locally, not exported from
  // @speedora/hook-prediction - not worth a cross-package dependency for
  // one constant).
  hookWindowTalkTimeRatio: z.number().min(0).max(1),
  // 0-1, RELATIVE within this clip's own samples only (Phase 4 tie-in) -
  // MomentumCurve samples whose `t` falls within any of this speaker's
  // turns, averaged/peak-reduced. Null when this speaker has zero
  // overlapping samples (e.g. the clip has no motionEnergy data at all).
  averageMomentumScore: z.number().min(0).max(1).nullable(),
  peakMomentumScore: z.number().min(0).max(1).nullable(),
  // The model's own 4-class label (Phase 5 tie-in) - the most frequent
  // non-null emotion among EmotionalArc samples within this speaker's
  // turns. Null when this speaker has zero overlapping classified samples.
  dominantEmotion: z.enum(VOCAL_EMOTIONS).nullable(),
  averageEmotionalIntensity: z.number().min(0).max(1).nullable(),
});
export type SpeakerAttribution = z.infer<typeof speakerAttributionSchema>;

// Null for the majority single-speaker case (see the module's own
// computeMultiSpeakerBreakdown() doc comment) - this is a genuinely
// different null-meaning than Phase 4/5's "predates migration" null; it's
// this field's own correct, honest "not applicable" result. A present
// array (length >= 2, sorted by talkTimeRatio descending) means the clip
// genuinely has multiple speakers and was attributed successfully.
export const multiSpeakerBreakdownSchema = z.array(speakerAttributionSchema);
export type MultiSpeakerBreakdown = z.infer<typeof multiSpeakerBreakdownSchema>;

// Deliberately narrow (ARCHITECTURE.md's checklist) - every field is
// already-computed elsewhere in the render pipeline; this module derives
// nothing raw of its own.
export const computeMultiSpeakerBreakdownInputSchema = z.object({
  speakerTimeline: z.array(speakerTimelineEntrySchema).nullable(),
  momentumCurve: z.array(momentumSampleSchema),
  emotionalArc: z.array(emotionalArcSampleSchema),
});
export type ComputeMultiSpeakerBreakdownInput = z.infer<
  typeof computeMultiSpeakerBreakdownInputSchema
>;
