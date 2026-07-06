import { z } from 'zod';
import { intelligenceSignalSchema } from './intelligence-signal';

// FER+ / IEMOCAP-style 7-class taxonomy - the same set used by most public
// facial-expression HF models (see packages/facial-intelligence's module
// comment for the specific model chosen). Lower-case, matching what the
// detection script is expected to emit.
export const FACIAL_EMOTIONS = [
  'angry',
  'disgust',
  'fear',
  'happy',
  'neutral',
  'sad',
  'surprise',
] as const;

export type FacialEmotion = (typeof FACIAL_EMOTIONS)[number];

export const detectFacialEmotionInputSchema = z.object({
  sourcePath: z.string().min(1),
  startTime: z.number(),
  endTime: z.number(),
});

// null emotion/score means "no face found in this sampled frame, or
// classification failed" - not an error, same as @speedora/reframe's
// FaceSample.box being null. Seconds are clip-relative (0 = clip start),
// same convention as FaceSample.t.
export const facialEmotionSampleSchema = z.object({
  t: z.number(),
  emotion: z.enum(FACIAL_EMOTIONS).nullable(),
  score: z.number().min(0).max(1).nullable(),
});

export const detectFacialEmotionOutputSchema = z.array(facialEmotionSampleSchema);

// Derived summary (see packages/contracts/src/intelligence-signal.ts) - the
// dense features the Fusion Engine actually consumes, computed from the raw
// samples above by @speedora/facial-intelligence's deriveFacialEmotionFeatures().
// All fields null when there were zero classified samples (no face found in
// any sampled frame, or the whole analysis failed) - not fabricated zeros.
export const facialEmotionFeaturesSchema = z.object({
  // The most frequently classified emotion across samples that had one -
  // ties broken by first occurrence.
  dominantEmotion: z.enum(FACIAL_EMOTIONS).nullable(),
  // Count of consecutive classified samples whose emotion differs from the
  // previous classified sample - a rough proxy for expressiveness/volatility.
  emotionTransitions: z.number().int().nonnegative(),
  // Highest confidence score seen across all classified samples.
  peakConfidence: z.number().min(0).max(1).nullable(),
  // 1 - (emotionTransitions / (classifiedSamples - 1)), clamped to [0, 1] -
  // 1 means every classified sample agreed, 0 means it changed every single
  // time. Null when fewer than 2 samples were classified (transitions are
  // undefined with 0 or 1 data points).
  stability: z.number().min(0).max(1).nullable(),
});

export const facialEmotionSignalSchema = intelligenceSignalSchema(
  facialEmotionSampleSchema,
  facialEmotionFeaturesSchema,
);

export type DetectFacialEmotionInput = z.infer<typeof detectFacialEmotionInputSchema>;
export type FacialEmotionSample = z.infer<typeof facialEmotionSampleSchema>;
export type FacialEmotionFeatures = z.infer<typeof facialEmotionFeaturesSchema>;
export type FacialEmotionSignal = z.infer<typeof facialEmotionSignalSchema>;
