import type { CropWindow, FaceBox, OcrHighlightBox } from '@speedora/contracts';

// Visual Emphasis Engine Phase C5 ("OCR Highlight", docs/ai/
// visual-emphasis-engine.md) - transforms an on-screen text track's own
// SOURCE-frame-normalized boundingBox into the final, cropped/scaled OUTPUT
// frame's pixel coordinates, ready for an ASS \pos() rectangle to draw at
// (see @speedora/subtitles' buildOcrHighlightEvents()).
//
// "C5 position tracking" decision (resolved via AskUserQuestion before
// implementation): a STATIC snapshot - the crop window nearest the
// highlight's own `startTime` (never the clip's start, which would only
// widen drift) - held fixed for the highlight's whole visible duration,
// rather than continuously tracking the crop path's own pan/zoom motion.
// Deliberately scoped this way, not an oversight - continuous tracking
// would turn this phase from "OCR highlight renderer" into "dynamic
// geometry synchronization between OCR tracks and an animated crop path",
// its own genuinely separate problem (sampling rate, interpolation shape,
// zoomEnvelopeAt() coupling, crop-path discontinuity handling - none of
// which is needed to prove OCR Highlight itself is worth having). No
// change to buildCropPath()/the crop path itself - this module only reads
// its already-computed output.
//
// KNOWN LIMITATION (by design, not a bug): a highlight box is anchored to
// the crop state at its own start and can visibly drift out of alignment
// with the source video's own on-screen text if the crop path pans/zooms
// substantially during a long highlight. No real footage was available in
// this sandbox to judge how often that matters in practice - a future
// phase (dynamic tracking) would need real footage evidence to design its
// sampling/interpolation against, not a guess made here.

export interface OcrHighlightTrack {
  boundingBox: FaceBox;
  // Clip-relative seconds (same convention as everywhere else in this
  // pipeline, and already how OcrTextTrack.startTime/endTime are defined).
  startTime: number;
  endTime: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Same "local copy, not a shared micro-package" convention every other
// nearestByTime()-shaped helper in this codebase already follows
// (@speedora/retention-curve-insights, @speedora/subtitle-rewriter,
// @speedora/dynamic-caption each have their own local copy) - a plain
// linear scan is more than fast enough for a clip-length CropWindow[]
// (~5 points/sec).
function nearestCropWindow(cropPath: CropWindow[], t: number): CropWindow {
  let best = cropPath[0];
  let bestDiff = Math.abs(cropPath[0].t - t);
  for (const window of cropPath) {
    const diff = Math.abs(window.t - t);
    if (diff < bestDiff) {
      best = window;
      bestDiff = diff;
    }
  }
  return best;
}

// Transforms every track's own source-normalized box through the crop
// window nearest its own startTime, into absolute output-frame pixel
// coordinates. `cropPath` must be non-empty (the caller supplies a
// single-element synthetic window spanning the whole clip when
// buildCropPath() itself returned null - a static center-crop is still a
// real, constant crop window for this function's purposes) - an empty
// array short-circuits to no boxes at all rather than guessing a position
// with nothing to anchor it to.
export function computeOcrHighlightBoxes(
  tracks: OcrHighlightTrack[],
  cropPath: CropWindow[],
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
): OcrHighlightBox[] {
  if (cropPath.length === 0) return [];

  const boxes: OcrHighlightBox[] = [];
  for (const track of tracks) {
    const crop = nearestCropWindow(cropPath, track.startTime);

    const sourcePixelX =
      track.boundingBox.xCenter * sourceWidth - (track.boundingBox.width * sourceWidth) / 2;
    const sourcePixelY =
      track.boundingBox.yCenter * sourceHeight - (track.boundingBox.height * sourceHeight) / 2;
    const sourcePixelWidth = track.boundingBox.width * sourceWidth;
    const sourcePixelHeight = track.boundingBox.height * sourceHeight;

    const scaleX = outputWidth / crop.width;
    const scaleY = outputHeight / crop.height;

    const rawX = (sourcePixelX - crop.x) * scaleX;
    const rawY = (sourcePixelY - crop.y) * scaleY;
    const rawWidth = sourcePixelWidth * scaleX;
    const rawHeight = sourcePixelHeight * scaleY;

    // Fully outside the crop window's own view (e.g. visible in the wide
    // source shot but cropped out of the 9:16 output) - drawing a box
    // around text the viewer can't even see would be worse than not
    // drawing one at all.
    if (
      rawX + rawWidth <= 0 ||
      rawX >= outputWidth ||
      rawY + rawHeight <= 0 ||
      rawY >= outputHeight
    ) {
      continue;
    }

    const x = clamp(rawX, 0, outputWidth);
    const y = clamp(rawY, 0, outputHeight);
    const width = clamp(rawX + rawWidth, 0, outputWidth) - x;
    const height = clamp(rawY + rawHeight, 0, outputHeight) - y;

    // A track that clamps down to nothing (a sliver at the very edge) -
    // same "don't draw a degenerate shape" caution as the full-outside
    // check above.
    if (width <= 0 || height <= 0) {
      continue;
    }

    boxes.push({
      start: track.startTime,
      end: track.endTime,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    });
  }
  return boxes;
}
