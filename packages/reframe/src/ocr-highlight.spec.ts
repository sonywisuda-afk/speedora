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
});
