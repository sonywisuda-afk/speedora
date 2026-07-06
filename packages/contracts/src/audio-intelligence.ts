import { z } from 'zod';
import { intelligenceSignalSchema } from './intelligence-signal';

// A segment's time range, in the same absolute-seconds clock as the full
// audio track it's sliced from (matches TranscriptSegment.start/end).
export const audioSegmentRangeSchema = z.object({
  start: z.number(),
  end: z.number(),
});

export const analyzeAudioLoudnessInputSchema = z.object({
  audioPath: z.string(),
  segments: z.array(audioSegmentRangeSchema),
});

export const loudnessMeasurementSchema = z.object({
  // null when the segment's ffmpeg call failed or the slice was too
  // short/silent for a meaningful reading - not a fabricated 0. Absolute dB
  // values are only meaningful relative to other segments of the SAME
  // video, never across different recordings.
  rmsDb: z.number().nullable(),
  peakDb: z.number().nullable(),
});

export const analyzeAudioLoudnessOutputSchema = z.object({
  segments: z.array(loudnessMeasurementSchema),
});

export const speakingRateInputSchema = z.object({
  segmentStart: z.number(),
  segmentEnd: z.number(),
  wordCount: z.number(),
});

export const speakingRateOutputSchema = z.object({
  wordsPerSecond: z.number(),
});

// One TranscriptSegment's already-computed audio-intelligence fields
// (persisted at transcribe time, Fase 25) - the "raw" this module's
// clip-scoped feature derivation reduces over. Deliberately narrower than
// the full TranscriptSegment shape (no text/words/speaker/emotion), same
// "adapter narrows DB row to the module's own input" convention as every
// other module here.
export const audioSegmentSampleSchema = z.object({
  rmsDb: z.number().nullable(),
  peakDb: z.number().nullable(),
  speakingRateWordsPerSecond: z.number().nullable(),
});

// Derived summary (see packages/contracts/src/intelligence-signal.ts) - the
// dense features the Fusion Engine actually consumes, computed by
// @speedora/audio-intelligence's deriveAudioFeatures() over the transcript
// segments that overlap one clip. All fields null when zero segments had a
// non-null reading (analysis never ran, or every segment's ffmpeg call
// failed) - not fabricated zeros, same convention as the per-segment
// nullability above.
export const audioFeaturesSchema = z.object({
  averageRmsDb: z.number().nullable(),
  peakDb: z.number().nullable(),
  averageSpeakingRateWordsPerSecond: z.number().nullable(),
  // Population standard deviation of speakingRateWordsPerSecond across
  // segments that had a reading - a proxy for pacing variability (a
  // steady narrator vs. someone speeding up/slowing down a lot). Null
  // when fewer than 2 segments have a reading (undefined with 0-1 points).
  speakingRateStdDev: z.number().nonnegative().nullable(),
});

export const audioSignalSchema = intelligenceSignalSchema(
  audioSegmentSampleSchema,
  audioFeaturesSchema,
);

export type AudioSegmentRange = z.infer<typeof audioSegmentRangeSchema>;
export type AnalyzeAudioLoudnessInput = z.infer<typeof analyzeAudioLoudnessInputSchema>;
export type LoudnessMeasurement = z.infer<typeof loudnessMeasurementSchema>;
export type AnalyzeAudioLoudnessOutput = z.infer<typeof analyzeAudioLoudnessOutputSchema>;
export type SpeakingRateInput = z.infer<typeof speakingRateInputSchema>;
export type SpeakingRateOutput = z.infer<typeof speakingRateOutputSchema>;
export type AudioSegmentSample = z.infer<typeof audioSegmentSampleSchema>;
export type AudioFeatures = z.infer<typeof audioFeaturesSchema>;
export type AudioSignal = z.infer<typeof audioSignalSchema>;
