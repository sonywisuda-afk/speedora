import type { TranscriptWord } from '@speedora/shared';
import {
  buildCropPath,
  buildSendCmdScript,
  computeCropDimensions,
  findEmphasisWords,
} from './reframe';
import type { FaceSample } from './faceDetection';

function word(text: string, start: number, end: number): TranscriptWord {
  return { word: text, start, end };
}

describe('computeCropDimensions', () => {
  it('crops width and keeps full height for a landscape (16:9) source', () => {
    const result = computeCropDimensions(1920, 1080);

    expect(result.height).toBe(1080);
    expect(result.width).toBeLessThan(1920);
    // Matches 9:16 within one rounding step (even-number rounding).
    expect(result.width / result.height).toBeCloseTo(9 / 16, 1);
  });

  it('crops height and keeps full width for an already-portrait source', () => {
    const result = computeCropDimensions(1080, 1920);

    expect(result.width).toBe(1080);
    expect(result.height).toBeLessThanOrEqual(1920);
  });

  it('always returns even dimensions (libx264/yuv420p requirement)', () => {
    const result = computeCropDimensions(321, 241);

    expect(result.width % 2).toBe(0);
    expect(result.height % 2).toBe(0);
  });
});

describe('findEmphasisWords', () => {
  it('picks out numbers, ALL-CAPS words, and quoted phrases', () => {
    const words = [
      word('so', 0, 0.2),
      word('50%', 0.2, 0.5),
      word('NEVER', 0.5, 0.8),
      word('"insane"', 0.8, 1.2),
      word('the', 1.2, 1.4),
      word('growth.', 1.4, 1.7),
    ];

    expect(findEmphasisWords(words)).toEqual([words[1], words[2], words[3]]);
  });

  it('strips surrounding punctuation before matching', () => {
    // "NEVER," (trailing comma) should still match ALL-CAPS once stripped.
    expect(findEmphasisWords([word('NEVER,', 0, 0.3)])).toEqual([word('NEVER,', 0, 0.3)]);
  });

  it('returns an empty array when nothing qualifies', () => {
    expect(findEmphasisWords([word('just', 0, 0.2), word('talking', 0.2, 0.5)])).toEqual([]);
  });
});

describe('buildCropPath', () => {
  const crop = { width: 136, height: 240 }; // matches a 320x240 source cropped to 9:16
  const sourceWidth = 320;
  const sourceHeight = 240;

  it('returns null when there is no detected face and no emphasis word anywhere in the clip', () => {
    const samples: FaceSample[] = [
      { t: 0, box: null },
      { t: 1, box: null },
    ];

    expect(buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 1)).toBeNull();
  });

  it('returns null for an empty sample list and no emphasis words', () => {
    expect(buildCropPath([], [], crop, sourceWidth, sourceHeight, 1)).toBeNull();
  });

  it('centers the crop on the detected face, only moving the axis that is actually cropped', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.3 } },
    ];

    const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 0);

    expect(path).not.toBeNull();
    // Face centered at xCenter=0.5 -> pixel 160 -> crop x = 160 - 136/2 = 92.
    expect(path![0].x).toBe(92);
    // Height isn't cropped for this landscape source (crop.height === sourceHeight) - y never moves.
    expect(path!.every((p) => p.y === 0)).toBe(true);
  });

  it('clamps the crop position so it never goes outside the frame', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.01, yCenter: 0.5, width: 0.1, height: 0.1 } },
    ];

    const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 0);

    expect(path![0].x).toBeGreaterThanOrEqual(0);
  });

  it('clamps the crop position at the far edge too', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.99, yCenter: 0.5, width: 0.1, height: 0.1 } },
    ];

    const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 0);

    expect(path![0].x).toBeLessThanOrEqual(sourceWidth - crop.width);
  });

  it('linearly interpolates between two known samples', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.25, yCenter: 0.5, width: 0.1, height: 0.1 } }, // x = 80 - 68 = 12
      { t: 1, box: { xCenter: 0.75, yCenter: 0.5, width: 0.1, height: 0.1 } }, // x = 240 - 68 = 172
    ];

    const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 1)!;
    // CROP_PATH_STEP_SECONDS is 0.2, so 0.5 itself is never a path point -
    // 0.4 (40% of the way from t=0 to t=1) is.
    const point = path.find((p) => Math.abs(p.t - 0.4) < 1e-6);

    expect(point).toBeDefined();
    // 40% of the way from x=12 to x=172 is 12 + (172-12)*0.4 = 76.
    expect(point!.x).toBe(76);
  });

  it('holds the nearest known position flat for samples with no detected face', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.25, yCenter: 0.5, width: 0.1, height: 0.1 } },
      { t: 1, box: null },
      { t: 2, box: { xCenter: 0.25, yCenter: 0.5, width: 0.1, height: 0.1 } },
    ];

    const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 2)!;

    // No face detected anywhere except t=0 and t=2, both at the same
    // position - the path should stay flat at that x the whole time.
    expect(path.every((p) => p.x === path[0].x)).toBe(true);
  });

  it('spans the full clip duration, holding the last known face position flat past the last sample', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.5, yCenter: 0.5, width: 0.1, height: 0.1 } },
    ];

    const path = buildCropPath(samples, [], crop, sourceWidth, sourceHeight, 3)!;

    expect(path[path.length - 1].t).toBeCloseTo(3, 3);
  });

  describe('auto zoom (emphasis words)', () => {
    it('builds a zoom-only path (no face data) centered on the frame, punching in at an emphasis word', () => {
      const samples: FaceSample[] = [{ t: 0, box: null }];
      const emphasisWords = [word('NEVER', 1, 1.3)];

      const path = buildCropPath(samples, emphasisWords, crop, sourceWidth, sourceHeight, 2)!;

      expect(path).not.toBeNull();
      // At the emphasis word's start (t=1), zoom should be at its peak -
      // crop shrinks to 70% of its base size (MAX_ZOOM_IN_FRACTION = 0.3).
      const atPeak = path.find((p) => Math.abs(p.t - 1) < 1e-6)!;
      expect(atPeak.width).toBeLessThan(crop.width);
      expect(atPeak.height).toBeLessThan(crop.height);

      // Well before/after the envelope, the crop is back to its base size.
      const before = path.find((p) => Math.abs(p.t - 0) < 1e-6)!;
      const after = path.find((p) => Math.abs(p.t - 2) < 1e-6)!;
      expect(before.width).toBe(crop.width);
      expect(after.width).toBe(crop.width);
    });

    it('re-centers the zoomed crop on the same point the pan would have used', () => {
      const samples: FaceSample[] = [
        { t: 0, box: { xCenter: 0.5, yCenter: 0.5, width: 0.1, height: 0.1 } },
      ];
      const emphasisWords = [word('50%', 0, 0.1)];

      const path = buildCropPath(samples, emphasisWords, crop, sourceWidth, sourceHeight, 0.5)!;
      const atPeak = path.find((p) => Math.abs(p.t - 0) < 1e-6)!;

      const baseCenterX = 92 + crop.width / 2; // face-centered base crop x from the earlier test
      const zoomedCenterX = atPeak.x + atPeak.width / 2;
      expect(zoomedCenterX).toBeCloseTo(baseCenterX, 0);
    });

    it('combines overlapping emphasis words by taking the strongest zoom, not stacking them', () => {
      const samples: FaceSample[] = [{ t: 0, box: null }];
      const emphasisWords = [word('NEVER', 1, 1.2), word('100%', 1.05, 1.3)];

      const path = buildCropPath(samples, emphasisWords, crop, sourceWidth, sourceHeight, 2)!;
      const atPeak = path.find((p) => Math.abs(p.t - 1) < 1e-6)!;

      // Still exactly the single-word peak shrink, not smaller than that.
      expect(atPeak.width).toBe(Math.round((crop.width * 0.7) / 2) * 2);
    });
  });
});

describe('buildSendCmdScript', () => {
  it('formats one sendcmd line per path point, setting x, y, w, and h', () => {
    const script = buildSendCmdScript(
      [
        { t: 0, x: 10, y: 0, width: 136, height: 240 },
        { t: 0.2, x: 20, y: 0, width: 120, height: 210 },
      ],
      'crop@reframe',
    );

    expect(script).toBe(
      '0 crop@reframe x 10, crop@reframe y 0, crop@reframe w 136, crop@reframe h 240;\n' +
        '0.2 crop@reframe x 20, crop@reframe y 0, crop@reframe w 120, crop@reframe h 210;',
    );
  });
});
