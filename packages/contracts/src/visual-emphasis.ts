import { z } from 'zod';
import { highlightTimelineSchema } from './subtitle-rewriter';
import { ocrTextTrackSchema } from './ocr';
import { primarySubjectSampleSchema } from './primary-subject';
import { retentionCurveInsightsSchema } from './retention-curve-insights';
import { speakerTurnSchema } from './speaker-diarization';
import { transcriptWordSchema } from './transcript-word';

// AI Intelligence v4 Track B, Phase C1 (Visual Emphasis Engine, spec Part
// 9 - "generate editing suggestions", data only - see docs/ai/
// visual-emphasis-engine.md). PURE composition over already-computed
// signals (Phase A1/B1's HighlightTimeline, OCR Intelligence, Primary
// Subject Selection, Phase 10's Retention Curve Insights) - no new
// detector, no LLM call, same zero-LLM shape as most of Track A/B. Covers
// 5 of the spec's 9 named techniques - the other 4 (Auto Zoom, Auto Crop,
// Face Priority already shipped via @speedora/reframe; Object Priority
// becomes real once Phase C2 unifies reframe with
// @speedora/primary-subject) need no suggestion timeline at all, see the
// design doc's own audit table for why.
//
// Every numeric field below is a documented HEURISTIC (ADR D4,
// docs/coding-standards.md's "scale honesty") - no engagement data exists
// to calibrate against. This phase only decides WHICH technique applies
// WHEN; wiring any of them into actual rendering is a later phase's job
// (C2-C7), same "data first" split every prior Track B phase already used.

// 'digital_push' covers BOTH "Auto Zoom" and "Digital Push" from the spec
// - real filmmaking terminology for the same push-in-zoom effect, not two
// techniques (see the design doc's own audit table). The already-shipped
// mechanism (@speedora/reframe's buildCropPath()) is keyword-regex
// triggered only; this suggestion type is where v4's own richer "this
// moment matters" signals get a say, for a future phase (C4) to actually
// wire in.
// 'attention_cut' is NOT one of spec Part 9's 9 named Visual Emphasis
// techniques (that roadmap is complete as its own closed set - see
// docs/ai/visual-emphasis-engine.md). It reuses this same
// EditingSuggestionTimeline delivery shape for a separate initiative
// ("Attention Curve Optimization," a Phase 10/Retention Curve Insights
// follow-up: flag a moment where predicted momentum drops sharply enough
// that a viewer plausibly starts losing interest) rather than inventing a
// parallel data structure - see from-drop-points.ts's own comment.
//
// 'speaker_focus_shift' is likewise NOT one of spec Part 9's 9 techniques -
// Speaker Intelligence Phase E (see docs/ai/speaker-intelligence.md),
// reusing this same delivery shape again, same precedent as attention_cut.
// Deliberately a SEPARATE value from 'focus_shift', not a second source
// feeding the same one: both end up merged into the identical downstream
// {start,end}[] window list @speedora/reframe's buildCropPath() already
// consumes (zero changes there), but keeping them distinct lets
// render-clip.worker.ts gate each source with its own independent flag -
// the same "one flag per trigger source" precedent Visual Emphasis Engine
// Phase C4 (Digital Push) already established for extending Auto Zoom's
// trigger set, not a new one invented here.
export const EDITING_TECHNIQUES = [
  'digital_push',
  'ocr_highlight',
  'focus_shift',
  'reaction_hold',
  'pause_hold',
  'attention_cut',
  'speaker_focus_shift',
] as const;
export const editingTechniqueSchema = z.enum(EDITING_TECHNIQUES);
export type EditingTechnique = z.infer<typeof editingTechniqueSchema>;

// One suggested moment. `score` is RELATIVE within this clip's own
// suggestions only, same "not comparable across clips" caveat every other
// v4 0-1 score already carries. `reason` is written for a human, same
// convention as clip-scoring's own `reason` field - this is what makes
// "generate editing suggestions" legible to a future editor UI, not just
// a number.
export const editingSuggestionSchema = z.object({
  technique: editingTechniqueSchema,
  // Clip-relative seconds.
  start: z.number(),
  end: z.number(),
  score: z.number().min(0).max(1),
  reason: z.string(),
});
export type EditingSuggestion = z.infer<typeof editingSuggestionSchema>;

// A sparse timeline (not every instant gets a suggestion, unlike Phase
// B1's dense CaptionTreatmentTimeline) - bare array, no clipId wrapper,
// same shape as HighlightTimeline/MomentumCurve. An empty array is a real,
// honest "nothing suggested" result for a clip with no qualifying moment
// in any of the 5 techniques - same convention every other v4 array
// output already uses.
export const editingSuggestionTimelineSchema = z.array(editingSuggestionSchema);
export type EditingSuggestionTimeline = z.infer<typeof editingSuggestionTimelineSchema>;

// Deliberately narrow (ARCHITECTURE.md's checklist) - every field is
// already-computed elsewhere in the render pipeline; this module derives
// nothing raw of its own. Reuses existing contracts directly (not
// near-duplicate copies) - same cross-contract-file-import precedent every
// phase since contextual-momentum.ts already set. `ocrTracks` is nullable
// (OCR Intelligence is itself an optional, can-fail detector); every other
// field is always a real (possibly empty) array/object once its own
// upstream node has run, matching those signals' own established
// null-semantics.
export const computeEditingSuggestionsInputSchema = z.object({
  highlights: highlightTimelineSchema,
  ocrTracks: z.array(ocrTextTrackSchema).nullable(),
  primarySubjectSamples: z.array(primarySubjectSampleSchema),
  retentionCurveInsights: retentionCurveInsightsSchema,
  words: z.array(transcriptWordSchema),
  clipDurationSeconds: z.number().nonnegative(),
  // Speaker Intelligence Phase E ('speaker_focus_shift', see above). Raw,
  // clip-relative turns - the SAME apps/worker ctx.speakerTurns Phase C's
  // conversationIntelligence node already reads directly (deps: []), not a
  // second detector. This module derives deriveDiarizationFeatures()/
  // deriveConversationDynamics() from it itself (both already-shipped, pure
  // @speedora/speaker-diarization / @speedora/conversation-intelligence
  // functions) rather than depending on that node's own output, keeping
  // this module's dependency graph a straight line from raw turns (same
  // shape every other input field here already has - "already-computed
  // elsewhere," not "depends on a sibling render-graph node"). Always a
  // real (possibly empty) array, never null - matches every other field's
  // established null-semantics in this schema.
  speakerTurns: z.array(speakerTurnSchema),
});
export type ComputeEditingSuggestionsInput = z.infer<typeof computeEditingSuggestionsInputSchema>;
