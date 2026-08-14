import { z } from 'zod';
import {
  effectiveRenderConfigSchema,
  exportQualityPresetSchema,
  resolvedAspectRatioLabelSchema,
} from './render-config';

// Render Fidelity & Composition Execution Engine, Phase 2 (OutputProfile) - see
// render-config.ts's own module comment for Phase 1's scope boundary; this file fills in exactly
// what Phase 1 deliberately deferred: concrete output pixel width/height (after crop + scale-up
// policy) plus fps/codec/pixel-format/quality/audio, all as ONE canonical object.
//
// SCOPE BOUNDARY (deliberate, same discipline as render-config.ts):
// - Geometry (width/height) is NOT re-derived here - it reuses @speedora/reframe's own already-
//   proven computeCropDimensions()/resolveOutputResolution(), the exact functions
//   render-clip.worker.ts's computeReframeDimensions() already calls today. This contract exists
//   to give their OUTPUT one canonical shape, not to define a second resolution algorithm.
// - fps is the RAW resolved source frame rate, not a crossfade-safety-floored value -
//   trimCutRanges()'s own 15fps floor is a rendering-mechanism concern (only relevant when a
//   crossfade junction exists), not a general output property; conflating the two would make
//   OutputProfile.fps lie about what the source/output actually runs at in the common case.
// - videoCodec/audioCodec/pixelFormat are fixed constants (this product has never offered a
//   codec choice) - centralized here as one canonical representation, not turned into new
//   user-facing settings.
// - AI decisions, render-graph output, and clip-generation settings are NOT here - same
//   exclusions as EffectiveRenderConfig, for the same reasons (see render-config.ts).
// - Final-media verification (ffprobe) is explicitly a LATER phase's job, not this one's -
//   OutputProfile states intent, it doesn't confirm the rendered file matches it yet.

export const outputResolutionPresetSchema = z.enum(['1080p', '720p', 'natural']);
export type OutputResolutionPreset = z.infer<typeof outputResolutionPresetSchema>;

// Plain, ffprobe-free source media data - the caller (adapter) is responsible for having already
// probed/resolved these; buildOutputProfile() itself performs no I/O of any kind.
// - `audioChannels` is expected to be the ALREADY-CLAMPED value (same one already threaded to
//   trimCutRanges()/applyReactionHolds()/concatBrandSegment() today via computeReframeDimensions()'s
//   own clampedAudioChannels) - buildOutputProfile() does no additional clamping itself, so it can
//   never silently upmix mono to stereo; that guarantee lives entirely in the value the adapter
//   passes in, reusing the SAME existing policy rather than inventing a second one.
// - `audioSampleRate` mirrors the one real sample-rate concept that exists anywhere in this
//   codebase's ffmpeg pipeline today - the fixed BRAND_SEGMENT_AUDIO_SAMPLE_RATE (44100) constant
//   trimCutRanges()'s crossfade join/applyReactionHolds()/concatBrandSegment() already normalize
//   every audio stream to. There is no per-source PROBED sample rate anywhere in this pipeline
//   (only a channel-count probe, getAudioChannelCount()) - the adapter supplies this constant.
export const sourceMediaCharacteristicsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  frameRate: z.string().nullable(),
  audioSampleRate: z.number().positive(),
  audioChannels: z.number().positive(),
});
export type SourceMediaCharacteristics = z.infer<typeof sourceMediaCharacteristicsSchema>;

export const buildOutputProfileInputSchema = z.object({
  effectiveRenderConfig: effectiveRenderConfigSchema,
  sourceMedia: sourceMediaCharacteristicsSchema,
});
export type BuildOutputProfileInput = z.infer<typeof buildOutputProfileInputSchema>;

export const outputProfileSchema = z.object({
  aspectRatio: resolvedAspectRatioLabelSchema,
  width: z.number().positive(),
  height: z.number().positive(),
  // 'natural' when EffectiveRenderConfig.output.resolutionTier was null - the exact same "no
  // normalization policy configured" case resolveOutputResolution() already treats as
  // "return crop unchanged", not a new policy invented here.
  resolutionPreset: outputResolutionPresetSchema,
  // The raw resolved source frame rate, verbatim - see this file's own module comment for why no
  // floor/normalization is applied here.
  fps: z.string().nullable(),
  videoCodec: z.literal('libx264'),
  audioCodec: z.literal('aac'),
  pixelFormat: z.literal('yuv420p'),
  qualityPreset: exportQualityPresetSchema.nullable(),
  // The resolved CRF number only - carried straight through from
  // EffectiveRenderConfig.output.quality?.crf, never recomputed or re-mapped to a different
  // value.
  qualityCrf: z.number().nullable(),
  audioSampleRate: z.number().positive(),
  audioChannels: z.number().positive(),
});
export type OutputProfile = z.infer<typeof outputProfileSchema>;
