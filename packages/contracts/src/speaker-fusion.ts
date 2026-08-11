import { z } from 'zod';
import { CONVERSATION_TYPES } from './conversation-intelligence';

// Speaker Intelligence Phase F ("Cross-module Fusion" - see docs/ai/
// speaker-intelligence.md). Consolidates Phase C (Conversation Dynamics),
// the EXISTING Speaker Intelligence Level 3 scoring (@speedora/speaker-
// scoring's SpeakerFusionFeatures, already wired into @speedora/fusion-
// engine's own `speaker` FUSION_SIGNALS key), and Phase E (speaker-aware
// visual response) into ONE queryable read-model.
//
// Explicit user direction shaped this contract - NOT a naive "sum
// everything into one number" fusion: this stays a structured, 3-branch
// object with per-field null-semantics preserved throughout, no top-level
// composite score. The reasoning, per branch:
//
// - `conversation` and `speaker` are genuinely ORTHOGONAL signal families
//   (confirmed by reading every @speedora/speaker-scoring derive function:
//   confidence/engagement/importance are built from eye contact, gesture,
//   voice energy/stability, facial expression, and talk-time/screen-time
//   ratio - none of it turn-taking/transition-frequency-derived). A single
//   flat average across all of it would obscure genuinely independent
//   information behind one number, the opposite of "orthogonality over
//   signal count."
// - `visual.speakerFocusShift` is explicitly DIAGNOSTIC ONLY, never scored
//   here. Phase E's speaker_focus_shift suggestions are a FILTERED SUBSET
//   of `conversation`'s own interactionIntensity/hold-duration logic
//   (@speedora/visual-emphasis's fromSpeakerTransitions() calls Phase C's
//   deriveDiarizationFeatures()/deriveConversationDynamics() internally) -
//   treating it as independent evidence alongside `conversation` would
//   double-count the same underlying speaker-transition events. Surfaced
//   here purely so a consumer can see whether the render pipeline actually
//   produced a visual response, not as a second vote for "this clip is
//   engaging."
//
// Fusion Engine v2 (`@speedora/fusion-engine`, `weights.ts`) is
// DELIBERATELY UNTOUCHED by this phase - a genuinely separate, standalone
// composite, not a v2 extension. A concrete, scoped follow-up (re-adding a
// `conversationType`-derived field to `speakerFusionFeaturesSchema`, which
// explicitly dropped one before because no deriving function existed - see
// that schema's own comment) is intentionally NOT done here; it needs its
// own explicit decision when picked up, per the user's own "don't silently
// change Fusion Engine v2" instruction.

// Deliberately a curated subset of ConversationDynamics (turnDensity/
// backAndForthScore/responseLatency/overlapRatio), NOT interactionIntensity
// - that field is ALREADY a fused composite of these same 3 raw components,
// and re-exposing it here would be a second, undocumented "fusion within
// fusion" layer on top of Phase C's own. `null` at the object level means
// this Clip row predates Phase C's migration (never computed at all) -
// distinct from a per-field `null` (computed, but that specific facet has
// no data, e.g. fewer than 2 turns for backAndForthScore).
export const finalSpeakerIntelligenceConversationSchema = z.object({
  type: z.enum(CONVERSATION_TYPES).nullable(),
  turnDensity: z.number().min(0),
  backAndForthScore: z.number().min(0).max(1).nullable(),
  responseLatency: z.number().min(0).nullable(),
  overlapRatio: z.number().min(0).max(1),
});
export type FinalSpeakerIntelligenceConversation = z.infer<
  typeof finalSpeakerIntelligenceConversationSchema
>;

// Mirrors SpeakerFusionFeatures' own 4 fields, renamed to this read-model's
// own shorter vocabulary (confidence/engagement/importance/highlight) -
// same values, no re-derivation. `null` at the object level means Phase F
// had no SpeakerFusionFeatures to consume at all (no speakerTimeline data
// for this clip) - distinct from a per-field `null` (a score component
// genuinely unavailable for the dominant speaker).
export const finalSpeakerIntelligenceSpeakerSchema = z.object({
  confidence: z.number().min(0).max(1).nullable(),
  engagement: z.number().min(0).max(1).nullable(),
  importance: z.number().min(0).max(1).nullable(),
  highlight: z.number().min(0).max(1).nullable(),
});
export type FinalSpeakerIntelligenceSpeaker = z.infer<typeof finalSpeakerIntelligenceSpeakerSchema>;

// Never null - always a real (possibly count: 0) object, since it's
// computed live from this clip's own editingSuggestions array (always
// present once the render graph has run). `averageConfidence` is null only
// when `count` is 0 (nothing to average).
export const finalSpeakerIntelligenceVisualSchema = z.object({
  speakerFocusShift: z.object({
    count: z.number().int().min(0),
    averageConfidence: z.number().min(0).max(1).nullable(),
  }),
});
export type FinalSpeakerIntelligenceVisual = z.infer<typeof finalSpeakerIntelligenceVisualSchema>;

export const finalSpeakerIntelligenceSchema = z.object({
  clipId: z.string(),
  conversation: finalSpeakerIntelligenceConversationSchema.nullable(),
  speaker: finalSpeakerIntelligenceSpeakerSchema.nullable(),
  visual: finalSpeakerIntelligenceVisualSchema,
});
export type FinalSpeakerIntelligence = z.infer<typeof finalSpeakerIntelligenceSchema>;

// Deliberately narrow (ARCHITECTURE.md's checklist) - every field is
// already-computed elsewhere in the render pipeline; this module derives
// nothing raw of its own, only composes/reshapes.
export const composeFinalSpeakerIntelligenceInputSchema = z.object({
  clipId: z.string(),
  conversationDynamics: z
    .object({
      turnDensityPerMinute: z.number().min(0),
      backAndForthScore: z.number().min(0).max(1).nullable(),
      responseLatencySeconds: z.number().min(0).nullable(),
      overlapRatio: z.number().min(0).max(1),
    })
    .nullable(),
  conversationType: z
    .object({
      type: z.enum(CONVERSATION_TYPES).nullable(),
    })
    .nullable(),
  speakerFusionFeatures: z
    .object({
      dominantSpeakerConfidence: z.number().min(0).max(1).nullable(),
      dominantSpeakerEngagement: z.number().min(0).max(1).nullable(),
      dominantSpeakerImportance: z.number().min(0).max(1).nullable(),
      averageSpeakerHighlightScore: z.number().min(0).max(1).nullable(),
    })
    .nullable(),
  // Already filtered to technique === 'speaker_focus_shift' by the caller -
  // this module only reads `score`, staying decoupled from the full
  // EditingSuggestion vocabulary the same way @speedora/reframe's
  // buildCropPath() already does for the SAME suggestions.
  speakerFocusShiftScores: z.array(z.number().min(0).max(1)),
});
export type ComposeFinalSpeakerIntelligenceInput = z.infer<
  typeof composeFinalSpeakerIntelligenceInputSchema
>;
