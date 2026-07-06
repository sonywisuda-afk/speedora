import { z } from 'zod';
import { intelligenceSignalSchema } from './intelligence-signal';

// MediaPipe Gesture Recognizer's built-in 7-class taxonomy (plus "None" for
// "a hand was detected but no recognized gesture"). Lower-case with
// underscores kept exactly as MediaPipe's own labels to avoid a second
// translation layer in the detection script.
export const GESTURES = [
  'none',
  'closed_fist',
  'open_palm',
  'pointing_up',
  'thumb_down',
  'thumb_up',
  'victory',
  'i_love_you',
] as const;

export type Gesture = (typeof GESTURES)[number];

export const detectGesturesInputSchema = z.object({
  sourcePath: z.string().min(1),
  startTime: z.number(),
  endTime: z.number(),
});

// null gesture/confidence means no hand was detected at all in this sampled
// frame - not the same as "none" (a hand was detected but didn't match any
// of the 7 recognized gestures). Same distinction as
// @speedora/facial-intelligence's null-emotion-vs-neutral-emotion.
export const gestureSampleSchema = z.object({
  t: z.number(),
  gesture: z.enum(GESTURES).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});

export const detectGesturesOutputSchema = z.array(gestureSampleSchema);

// Derived summary (see packages/contracts/src/intelligence-signal.ts) - same
// shape/math as facial-intelligence's features (dominant category + a
// transitions/stability pair), mirrored rather than shared because the two
// taxonomies are conceptually distinct.
export const gestureFeaturesSchema = z.object({
  dominantGesture: z.enum(GESTURES).nullable(),
  gestureTransitions: z.number().int().nonnegative(),
  peakConfidence: z.number().min(0).max(1).nullable(),
  stability: z.number().min(0).max(1).nullable(),
});

export const gestureSignalSchema = intelligenceSignalSchema(
  gestureSampleSchema,
  gestureFeaturesSchema,
);

export type DetectGesturesInput = z.infer<typeof detectGesturesInputSchema>;
export type GestureSample = z.infer<typeof gestureSampleSchema>;
export type GestureFeatures = z.infer<typeof gestureFeaturesSchema>;
export type GestureSignal = z.infer<typeof gestureSignalSchema>;
