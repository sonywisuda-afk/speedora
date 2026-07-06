import { z } from 'zod';
import { intelligenceSignalSchema } from './intelligence-signal';

export const detectSceneCutsInputSchema = z.object({
  videoPath: z.string(),
  // Absolute source-video seconds - same convention as detectFaces'
  // startTime/endTime (packages/reframe).
  startTime: z.number(),
  endTime: z.number(),
  // ffmpeg's own "scene" score is 0-1 (higher = more different from the
  // previous frame) - optional, defaults to a conventional 0.4 inside the
  // module itself (see detect-scene-cuts.ts).
  threshold: z.number().min(0).max(1).optional(),
});

export const detectSceneCutsOutputSchema = z.object({
  // Clip-relative seconds (0 = clip start), same convention as
  // FaceSample.t (packages/reframe) - NOT absolute source-video time.
  cuts: z.array(z.number()),
});

// Derived summary (see packages/contracts/src/intelligence-signal.ts) - the
// dense features the Fusion Engine actually consumes, computed from the raw
// `cuts` array above by @speedora/scene-intelligence's deriveSceneFeatures().
export const sceneFeaturesSchema = z.object({
  cutCount: z.number().int().nonnegative(),
  // Cuts per 60 seconds of clip duration - normalizes cut frequency across
  // clips of different lengths so it's directly comparable. Null when the
  // clip's duration is 0 (division undefined).
  cutsPerMinute: z.number().nonnegative().nullable(),
  // Mean length of the segments cuts divide the clip into (including the
  // segments before the first cut and after the last) - null when the
  // clip's duration is 0.
  averageSegmentSeconds: z.number().nonnegative().nullable(),
});

export const sceneSignalSchema = intelligenceSignalSchema(z.number(), sceneFeaturesSchema);

export type DetectSceneCutsInput = z.infer<typeof detectSceneCutsInputSchema>;
export type DetectSceneCutsOutput = z.infer<typeof detectSceneCutsOutputSchema>;
export type SceneFeatures = z.infer<typeof sceneFeaturesSchema>;
export type SceneSignal = z.infer<typeof sceneSignalSchema>;
