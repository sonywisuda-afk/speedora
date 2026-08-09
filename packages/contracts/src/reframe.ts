import { z } from 'zod';

// Normalized (0-1) bounding box for one detected face, as MediaPipe's
// FaceDetector reports it - xCenter/yCenter/width/height fractions of the
// source frame, not pixels.
export const faceBoxSchema = z.object({
  xCenter: z.number(),
  yCenter: z.number(),
  width: z.number(),
  height: z.number(),
});

export const faceSampleSchema = z.object({
  // Seconds relative to the clip's own start (0 = clip start), not the
  // source video's timeline.
  t: z.number(),
  // null when no face was detected in this sampled frame - not an error,
  // see @speedora/reframe's buildCropPath() fallback-to-center-crop handling.
  box: faceBoxSchema.nullable(),
});

export const detectFacesInputSchema = z.object({
  sourcePath: z.string(),
  startTime: z.number(),
  endTime: z.number(),
});

export const detectFacesOutputSchema = z.array(faceSampleSchema);

export const cropDimensionsSchema = z.object({
  width: z.number(),
  height: z.number(),
});

// One point in the final crop-window path sent to ffmpeg via sendcmd -
// width/height vary (Fase 11's zoom) alongside the x/y panning, all on the
// same clip-relative timeline.
export const cropWindowSchema = z.object({
  t: z.number(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

// Visual Emphasis Engine Phase C5 ("OCR Highlight", docs/ai/
// visual-emphasis-engine.md) - a positioned rectangle for ONE OCR
// highlight's visible window, in absolute OUTPUT-frame pixel coordinates
// (already transformed through the crop window nearest the highlight's
// own startTime, and already clamped to the frame - see @speedora/reframe's
// computeOcrHighlightBoxes()). Lives alongside cropWindowSchema above
// (both are "a positioned rectangle for one instant/window in output-pixel
// space") even though it's PRODUCED by @speedora/reframe and CONSUMED by
// @speedora/subtitles' buildAss() - a genuine cross-package boundary type,
// same reasoning every other contracts/src/*.ts type already follows.
export const ocrHighlightBoxSchema = z.object({
  // Clip-relative seconds (same convention as everywhere else).
  start: z.number(),
  end: z.number(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export type FaceBox = z.infer<typeof faceBoxSchema>;
export type FaceSample = z.infer<typeof faceSampleSchema>;
export type DetectFacesInput = z.infer<typeof detectFacesInputSchema>;
export type CropDimensions = z.infer<typeof cropDimensionsSchema>;
export type CropWindow = z.infer<typeof cropWindowSchema>;
export type OcrHighlightBox = z.infer<typeof ocrHighlightBoxSchema>;
