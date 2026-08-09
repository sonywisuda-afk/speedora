import type { CropWindow, FaceBox } from '@speedora/contracts';
import { computeOcrHighlightBoxes, type OcrHighlightTrack } from './ocr-highlight';

function track(
  overrides: Partial<OcrHighlightTrack> & { boundingBox: FaceBox },
): OcrHighlightTrack {
  return { startTime: 0, endTime: 1, ...overrides };
}

// A static (non-moving/non-zooming) crop window spanning the whole clip -
// the shape a caller passes when buildCropPath() itself returned null (a
// static center-crop was used).
const staticCrop: CropWindow[] = [{ t: 0, x: 40, y: 0, width: 240, height: 240 }];

describe('computeOcrHighlightBoxes', () => {
  it('returns an empty array for an empty crop path (nothing to anchor a position to)', () => {
    const tracks = [
      track({ boundingBox: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.1 } }),
    ];
    expect(computeOcrHighlightBoxes(tracks, [], 320, 240, 136, 240)).toEqual([]);
  });

  it('returns an empty array for an empty track list', () => {
    expect(computeOcrHighlightBoxes([], staticCrop, 320, 240, 136, 240)).toEqual([]);
  });

  it('transforms a source-normalized box through a static crop window into output pixel coordinates', () => {
    // Source is 320x240, crop window is x=40,y=0,w=240,h=240 (the 9:16
    // center crop of a 320x240 landscape source), output is 136x240 -
    // scaleX = 136/240, scaleY = 240/240 = 1.
    const tracks = [
      track({
        boundingBox: { xCenter: 0.5, yCenter: 0.5, width: 0.1, height: 0.1 },
        startTime: 2,
        endTime: 4,
      }),
    ];

    const boxes = computeOcrHighlightBoxes(tracks, staticCrop, 320, 240, 136, 240);

    expect(boxes).toHaveLength(1);
    // Source pixel box: xCenter 0.5*320=160, width 0.1*320=32 -> left edge
    // 160-16=144. Minus crop.x (40) = 104. Scaled by 136/240 -> 58.9 -> 59.
    expect(boxes[0].x).toBe(Math.round((144 - 40) * (136 / 240)));
    expect(boxes[0].start).toBe(2);
    expect(boxes[0].end).toBe(4);
  });

  it("picks the crop window nearest the highlight track's own startTime, not the clip start", () => {
    const movingCrop: CropWindow[] = [
      { t: 0, x: 0, y: 0, width: 240, height: 240 },
      { t: 5, x: 80, y: 0, width: 240, height: 240 },
    ];
    const tracks = [
      track({
        boundingBox: { xCenter: 0.5, yCenter: 0.5, width: 0.1, height: 0.1 },
        startTime: 5,
        endTime: 6,
      }),
    ];

    const boxes = computeOcrHighlightBoxes(tracks, movingCrop, 320, 240, 136, 240);

    // Uses the t=5 crop window (x=80), not the t=0 one (x=0) - proves the
    // snapshot is anchored to the highlight's own start, never clip start.
    const usingT5Crop = Math.round((160 - 16 - 80) * (136 / 240));
    const usingT0Crop = Math.round((160 - 16 - 0) * (136 / 240));
    expect(boxes[0].x).toBe(usingT5Crop);
    expect(boxes[0].x).not.toBe(usingT0Crop);
  });

  it('emits one box per track for multiple qualifying tracks', () => {
    const tracks = [
      track({
        boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.1, height: 0.1 },
        startTime: 0,
        endTime: 1,
      }),
      track({
        boundingBox: { xCenter: 0.7, yCenter: 0.5, width: 0.1, height: 0.1 },
        startTime: 3,
        endTime: 4,
      }),
    ];

    const boxes = computeOcrHighlightBoxes(tracks, staticCrop, 320, 240, 136, 240);

    expect(boxes).toHaveLength(2);
    expect(boxes[0].start).toBe(0);
    expect(boxes[1].start).toBe(3);
  });

  it('skips a track that falls entirely outside the crop window (cropped out of the output frame)', () => {
    // Crop window only covers x=[40,280] of the 320-wide source - a track
    // centered at xCenter=0.05 (pixel 16) sits entirely to its left.
    const tracks = [
      track({ boundingBox: { xCenter: 0.05, yCenter: 0.5, width: 0.05, height: 0.05 } }),
    ];

    expect(computeOcrHighlightBoxes(tracks, staticCrop, 320, 240, 136, 240)).toEqual([]);
  });

  it('clamps a track that partially overlaps the crop window edge instead of drawing an out-of-bounds box', () => {
    // Centered at the very left edge of the crop window (source pixel 40,
    // matching crop.x) with a box that extends further left, off-frame.
    const tracks = [
      track({ boundingBox: { xCenter: 0.1, yCenter: 0.5, width: 0.2, height: 0.1 } }),
    ];

    const boxes = computeOcrHighlightBoxes(tracks, staticCrop, 320, 240, 136, 240);

    expect(boxes).toHaveLength(1);
    expect(boxes[0].x).toBeGreaterThanOrEqual(0);
    expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(136);
  });

  it('skips a degenerate (zero-size) box safely instead of emitting an invalid rectangle', () => {
    const tracks = [track({ boundingBox: { xCenter: 0.5, yCenter: 0.5, width: 0, height: 0 } })];

    expect(computeOcrHighlightBoxes(tracks, staticCrop, 320, 240, 136, 240)).toEqual([]);
  });

  // Visual Emphasis Integration Audit, Gate B2 (docs/ai/
  // visual-emphasis-integration-audit.md) - EVIDENCE GATHERING for the
  // audit's MEDIUM finding: the static-snapshot design (this module's own
  // documented limitation) can desync from the real on-screen text if the
  // crop pans/zooms during a highlight's own visible window. This
  // describe block does NOT change the design - it quantifies exactly
  // how much drift results at low/medium/large movement, so Gate C can
  // judge against real numbers instead of an assumption.
  //
  // Technique: computeOcrHighlightBoxes() already picks whichever crop
  // window is NEAREST a track's own startTime (nearestCropWindow()) - a
  // SECOND call with the SAME bounding box but startTime set to the
  // highlight's own endTime reuses that exact mechanism to compute "where
  // would this box be if it were anchored to the crop window at the
  // highlight's END instead of its START" - a legitimate stand-in for "a
  // continuously-tracked box" without needing any new production code.
  // The delta between the two calls IS the drift the static design
  // leaves unaddressed for that highlight's own visible duration.
  describe('Gate B2 evidence: static-snapshot drift at low/medium/large crop movement (no mechanism change)', () => {
    // A representative on-screen price/name box (the two OCR_HIGHLIGHT_CATEGORIES
    // this phase actually highlights) - source-normalized, fixed across
    // all 3 scenarios so movement level is the only variable.
    const boundingBox: FaceBox = { xCenter: 0.5, yCenter: 0.5, width: 0.15, height: 0.08 };
    // A 2s highlight - long enough for a crop-path move to actually
    // happen during its own visible window, matching Focus Shift/Digital
    // Push's own real timescales (B1's fixture moved 160px in 0.4s).
    const highlightStart = 0;
    const highlightEnd = 2;

    // Mirrors computeOcrHighlightBoxes()'s own internal formula exactly
    // (same technique ocr-highlight.spec.ts's own pre-existing tests
    // already use, e.g. "picks the crop window nearest...") - self-
    // verifying against the real transform, not a hand-typed guess.
    function expectedBoxAt(crop: CropWindow, outputWidth: number, outputHeight: number) {
      const sourcePixelX = boundingBox.xCenter * 320 - (boundingBox.width * 320) / 2;
      const sourcePixelY = boundingBox.yCenter * 240 - (boundingBox.height * 240) / 2;
      const scaleX = outputWidth / crop.width;
      const scaleY = outputHeight / crop.height;
      const rawX = (sourcePixelX - crop.x) * scaleX;
      const rawY = (sourcePixelY - crop.y) * scaleY;
      return { x: Math.round(rawX), y: Math.round(rawY) };
    }

    function driftFor(label: string, startCrop: CropWindow, endCrop: CropWindow) {
      const cropPath = [startCrop, endCrop];
      const outputWidth = 136;
      const outputHeight = 240;

      const boxAtStart = computeOcrHighlightBoxes(
        [
          track({
            boundingBox,
            startTime: highlightStart,
            endTime: highlightEnd,
          }),
        ],
        cropPath,
        320,
        240,
        outputWidth,
        outputHeight,
      )[0];
      // The counterfactual "continuously tracked" position - same track,
      // same box, but anchored to the crop window nearest the
      // highlight's own END instead of its START.
      const boxIfTrackedAtEnd = computeOcrHighlightBoxes(
        [
          track({
            boundingBox,
            startTime: highlightEnd,
            endTime: highlightEnd,
          }),
        ],
        cropPath,
        320,
        240,
        outputWidth,
        outputHeight,
      )[0];

      const driftX = boxIfTrackedAtEnd ? Math.abs(boxIfTrackedAtEnd.x - boxAtStart.x) : null;
      const driftFractionOfOutputWidth = driftX === null ? null : driftX / outputWidth;

      return { label, boxAtStart, boxIfTrackedAtEnd, driftX, driftFractionOfOutputWidth };
    }

    it('LOW movement (10px pan, no zoom, over 2s) - the static box stays close to where a tracked box would be', () => {
      const startCrop: CropWindow = { t: highlightStart, x: 40, y: 0, width: 240, height: 240 };
      const endCrop: CropWindow = { t: highlightEnd, x: 50, y: 0, width: 240, height: 240 };
      const result = driftFor('low', startCrop, endCrop);

      expect(result.boxAtStart.x).toBe(expectedBoxAt(startCrop, 136, 240).x);
      expect(result.boxIfTrackedAtEnd!.x).toBe(expectedBoxAt(endCrop, 136, 240).x);
      // 10px of crop pan -> a small fraction of the output's own width.
      expect(result.driftX).toBeLessThan(10);
      expect(result.driftFractionOfOutputWidth!).toBeLessThan(0.05);
    });

    it('MEDIUM movement (80px pan, no zoom, over 2s - a single Focus-Shift-scale move) - drift becomes visually noticeable', () => {
      const startCrop: CropWindow = { t: highlightStart, x: 40, y: 0, width: 240, height: 240 };
      const endCrop: CropWindow = { t: highlightEnd, x: 120, y: 0, width: 240, height: 240 };
      const result = driftFor('medium', startCrop, endCrop);

      expect(result.boxAtStart.x).toBe(expectedBoxAt(startCrop, 136, 240).x);
      expect(result.boxIfTrackedAtEnd!.x).toBe(expectedBoxAt(endCrop, 136, 240).x);
      expect(result.driftFractionOfOutputWidth!).toBeGreaterThan(0.2);
    });

    it("LARGE movement (110px pan + 30% zoom over 2s) - the static box would be substantially wrong, clamped to the frame edge, by the highlight's own end", () => {
      const startCrop: CropWindow = { t: highlightStart, x: 40, y: 0, width: 240, height: 240 };
      // 240 * 0.7 = 168 - the identical 30% punch-in B1's own fixture uses.
      const endCrop: CropWindow = { t: highlightEnd, x: 150, y: 0, width: 168, height: 240 };
      const result = driftFor('large', startCrop, endCrop);

      expect(result.boxAtStart.x).toBe(expectedBoxAt(startCrop, 136, 240).x);
      // Unlike the low/medium cases, the "tracked" box at this movement
      // level clamps hard against the output frame's left edge (x=0) -
      // the zoomed-in crop window has moved far enough that the text's
      // own source position sits mostly outside it by the highlight's
      // end, not just shifted.
      expect(result.boxIfTrackedAtEnd!.x).toBe(0);
      expect(result.driftFractionOfOutputWidth!).toBeGreaterThan(0.3);
    });

    it('EXTREME movement (160px pan + 30% zoom over 2s - the SAME combined magnitude B1 found for Focus Shift x Digital Push) - the tracked text leaves the crop entirely, but the static box keeps showing anyway', () => {
      const startCrop: CropWindow = { t: highlightStart, x: 40, y: 0, width: 240, height: 240 };
      const endCrop: CropWindow = { t: highlightEnd, x: 200, y: 0, width: 168, height: 240 };
      const result = driftFor('extreme', startCrop, endCrop);

      // The static box (what actually gets burned in, anchored to t=0)
      // is a real, valid box - this is what the viewer would see for the
      // highlight's ENTIRE 2s duration, unconditionally.
      expect(result.boxAtStart).toBeDefined();
      expect(result.boxAtStart.x).toBe(expectedBoxAt(startCrop, 136, 240).x);
      // But a continuously-tracked box, anchored to where the crop
      // ACTUALLY is by the highlight's own end, finds nothing at all -
      // computeOcrHighlightBoxes()'s own "fully outside the crop window"
      // guard drops it (the text's real on-screen position has been
      // panned/zoomed out of frame entirely). This is a qualitatively
      // WORSE failure mode than drift: the static design keeps a
      // highlight box on screen pointing at text that, if truly tracked,
      // wouldn't be visible in the output frame at all by the end of its
      // own highlight window.
      expect(result.boxIfTrackedAtEnd).toBeUndefined();
    });
  });
});
