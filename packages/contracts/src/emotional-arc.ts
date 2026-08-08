import { z } from 'zod';
import { semanticEventSchema } from './semantic-events';
import { VOCAL_EMOTIONS } from './vocal-emotion';

// AI Intelligence v4, Phase 5 (Emotional Arc - see docs/ai/
// intelligence-v4.md). The vocal-emotion half of spec Part 5 (Retention
// Curve Prediction), pairing with Phase 4's MomentumCurve (the visual/
// structural half) - together they fulfill Part 5's full output. Same
// architecture as Phase 4: NO LLM call - a pure composition over
// already-persisted TranscriptSegment.emotion labels (the classifier itself
// already ran at transcribe time, see apps/worker/src/vocalEmotion.ts) plus
// Phase 2's SemanticEvent[] as optional context. Every numeric field is a
// documented HEURISTIC (ADR D4, docs/coding-standards.md's "scale honesty")
// - no engagement data exists to calibrate against, and the underlying
// classifier is itself trained on IEMOCAP's *acted*, not natural, speech
// (see vocal-emotion.ts's own caveat) - carried forward into this module's
// doc comments too. Never present these as ML-model output downstream (UI
// copy, API docs) without this caveat. No confidence field: a pure derive
// with no natural weighted-budget/coverage concept the way Phase 1/7 have
// (docs/ai/intelligence-v4.md's "Phase 8 architecture (as shipped)" section).

// A per-instant timeline (array), one sample per transcript segment - not
// resampled onto motionEnergy's fixed grid, since transcript segments are
// vocal emotion's own natural granularity (same "native cadence per signal"
// precedent semanticEvents/ocrTracks already use).
export const emotionalArcSampleSchema = z.object({
  // Clip-relative seconds - the segment's own start time.
  t: z.number(),
  // The model's own 4-class label for this segment, or null when the
  // segment has no classification (too short to classify, detection didn't
  // run for this video, or the stored label is unrecognized) - a real,
  // distinct state from a low-intensity 'neu' result, not coerced to it.
  emotion: z.enum(VOCAL_EMOTIONS).nullable(),
  // 0-1, RELATIVE within this clip's own samples only - not a calibrated
  // cross-clip score (same caveat as MomentumCurve's momentumScore). 0 when
  // `emotion` is null.
  intensity: z.number().min(0).max(1),
});
export type EmotionalArcSample = z.infer<typeof emotionalArcSampleSchema>;

export const emotionalArcSchema = z.array(emotionalArcSampleSchema);
export type EmotionalArc = z.infer<typeof emotionalArcSchema>;

// The clip-relative transcript-segment input shape this module reads -
// deliberately narrow (ARCHITECTURE.md's checklist), just enough to derive
// the arc. `emotion` is a plain nullable string (not VocalEmotion) because
// it comes straight from TranscriptSegment.emotion, whose column predates
// this contract's own VOCAL_EMOTIONS enum and is validated defensively
// inside computeEmotionalArc rather than trusted at the type level here.
export const emotionalArcSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  emotion: z.string().nullable(),
});
export type EmotionalArcSegment = z.infer<typeof emotionalArcSegmentSchema>;

// semanticEvents is an independently optional upstream signal (Phase 2) that
// degrades gracefully to no boost when absent - same "optional context,
// never a hard dependency" pattern Phase 3/4 already use for it.
export const computeEmotionalArcInputSchema = z.object({
  clipDurationSeconds: z.number().nonnegative(),
  segments: z.array(emotionalArcSegmentSchema),
  semanticEvents: z.array(semanticEventSchema).nullable(),
});
export type ComputeEmotionalArcInput = z.infer<typeof computeEmotionalArcInputSchema>;
