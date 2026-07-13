import { z } from 'zod';
import { faceLandmarkSampleSchema } from './face-landmarks';
import { facialEmotionSampleSchema } from './facial-intelligence';
import { gestureSampleSchema } from './gesture-intelligence';
import { motionEnergySampleSchema, sceneCutEventSchema } from './scene-intelligence';
import { ocrTextTrackSchema } from './ocr';
import { primarySubjectSampleSchema } from './primary-subject';

// Phase 4 of the thumbnail roadmap (AI Thumbnail Selection) - see
// docs/ai/... roadmap notes. Per the codebase's "reuse first, derive second,
// extend third" principle, this module adds NO new detector: every input
// field below is an already-computed, already-persisted per-timestamp
// signal from another module's render-graph node.
//
// POLICY (do not violate): this contract governs TWO INDEPENDENT SELECTION
// LEVELS that must never be conflated:
//   Level 1 - WHICH CLIP is the video's cover. Decided entirely OUTSIDE this
//     module, by @speedora/fusion-engine's highlightScore/highlightRank
//     (Clip-level, no time resolution). This module is never called to
//     choose a clip.
//   Level 2 - WHICH FRAME inside an ALREADY-CHOSEN clip is the thumbnail.
//     Decided entirely by this module, using only signals that carry
//     per-timestamp resolution. highlightScore/highlightRank/
//     highlightBreakdown are Clip-level aggregates with NO per-timestamp
//     semantics and MUST NEVER be read, imported, or passed into
//     selectThumbnailTimestamp() or this input schema. If a future signal
//     only exists as a per-clip aggregate (no `t` field), it does not
//     belong here - add it to the Fusion Engine instead.
//
// editingRhythmFeatures/compositionFeatures are deliberately EXCLUDED from
// the input below - both are aggregate-only (no per-timestamp array to
// score candidates against). `primarySubjectSamples` is included instead of
// raw compositionSamples, since it's the one composition-adjacent signal
// that genuinely carries a real per-`t` position.
export const THUMBNAIL_SIGNALS = [
  'faceClarity',
  'emotion',
  'ocrImportance',
  'gesture',
  'motion',
  'composition',
] as const;
export type ThumbnailSignal = (typeof THUMBNAIL_SIGNALS)[number];

export const selectThumbnailTimestampInputSchema = z.object({
  clipDurationSeconds: z.number().positive(),
  faceLandmarks: z.array(faceLandmarkSampleSchema).nullable(),
  facialEmotions: z.array(facialEmotionSampleSchema).nullable(),
  ocrTracks: z.array(ocrTextTrackSchema).nullable(),
  gestures: z.array(gestureSampleSchema).nullable(),
  motionEnergy: z.array(motionEnergySampleSchema).nullable(),
  sceneCutEvents: z.array(sceneCutEventSchema).nullable(),
  primarySubjectSamples: z.array(primarySubjectSampleSchema).nullable(),
});
export type SelectThumbnailTimestampInput = z.infer<typeof selectThumbnailTimestampInputSchema>;

// Injectable, same "collect first, calibrate later" precedent as
// @speedora/fusion-engine's weights.ts - but see weights.ts's own comment
// in @speedora/thumbnail-selection for why the DEFAULT values here are
// deliberately non-zero from day one (an all-zero start would make this
// whole feature a no-op).
export const thumbnailWeightsSchema = z.record(z.enum(THUMBNAIL_SIGNALS), z.number().min(0));
export type ThumbnailWeights = Partial<Record<ThumbnailSignal, number>>;

// One signal's contribution AT THE WINNING TIMESTAMP - not per-candidate
// (an array-per-candidate would be unbounded and isn't useful for a UI).
// rawValue is null for a categorical hit (e.g. "a gesture was present here")
// rather than a raw measurement, same convention as fusion-engine's
// ExtractedFeature.isCategoryDerived.
export const thumbnailContributionSchema = z.object({
  signal: z.enum(THUMBNAIL_SIGNALS),
  rawValue: z.number().nullable(),
  normalizedValue: z.number().min(0).max(1),
  weight: z.number().min(0),
  weightedContribution: z.number(),
});
export type ThumbnailContribution = z.infer<typeof thumbnailContributionSchema>;

// Ordered worst-signal to best-signal for readability, not by preference.
// 'midpoint' guarantees this feature can never produce a worse result than
// today's naive clip-midpoint thumbnail - it degrades to exactly that
// behavior when zero signals have any data, never to something undefined.
export const THUMBNAIL_FALLBACK_LEVELS = ['midpoint', 'single_signal', 'multi_signal'] as const;
export type ThumbnailFallbackLevel = (typeof THUMBNAIL_FALLBACK_LEVELS)[number];

export const selectThumbnailTimestampOutputSchema = z.object({
  timestampSeconds: z.number().min(0),
  // Coverage-based, same spirit as FusionOutput.confidence - fraction of
  // weighted (weight > 0) signals that had ANY usable data anywhere in this
  // clip, not just at the winning timestamp.
  confidence: z.number().min(0).max(1),
  contributions: z.array(thumbnailContributionSchema),
  fallbackLevel: z.enum(THUMBNAIL_FALLBACK_LEVELS),
  reason: z.string(),
});
export type SelectThumbnailTimestampOutput = z.infer<typeof selectThumbnailTimestampOutputSchema>;
