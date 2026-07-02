import { buildCropPath, buildSendCmdScript, computeCropDimensions } from './reframe';
import type { FaceSample } from './faceDetection';

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

describe('buildCropPath', () => {
  const crop = { width: 136, height: 240 }; // matches a 320x240 source cropped to 9:16
  const sourceWidth = 320;
  const sourceHeight = 240;

  it('returns null when no sample in the clip has a detected face', () => {
    const samples: FaceSample[] = [
      { t: 0, box: null },
      { t: 1, box: null },
    ];

    expect(buildCropPath(samples, crop, sourceWidth, sourceHeight)).toBeNull();
  });

  it('returns null for an empty sample list', () => {
    expect(buildCropPath([], crop, sourceWidth, sourceHeight)).toBeNull();
  });

  it('centers the crop on the detected face, only moving the axis that is actually cropped', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.3 } },
    ];

    const path = buildCropPath(samples, crop, sourceWidth, sourceHeight);

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

    const path = buildCropPath(samples, crop, sourceWidth, sourceHeight);

    expect(path![0].x).toBeGreaterThanOrEqual(0);
  });

  it('clamps the crop position at the far edge too', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.99, yCenter: 0.5, width: 0.1, height: 0.1 } },
    ];

    const path = buildCropPath(samples, crop, sourceWidth, sourceHeight);

    expect(path![0].x).toBeLessThanOrEqual(sourceWidth - crop.width);
  });

  it('linearly interpolates between two known samples', () => {
    const samples: FaceSample[] = [
      { t: 0, box: { xCenter: 0.25, yCenter: 0.5, width: 0.1, height: 0.1 } }, // x = 80 - 68 = 12
      { t: 1, box: { xCenter: 0.75, yCenter: 0.5, width: 0.1, height: 0.1 } }, // x = 240 - 68 = 172
    ];

    const path = buildCropPath(samples, crop, sourceWidth, sourceHeight)!;
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

    const path = buildCropPath(samples, crop, sourceWidth, sourceHeight)!;

    // No face detected anywhere except t=0 and t=2, both at the same
    // position - the path should stay flat at that x the whole time.
    expect(path.every((p) => p.x === path[0].x)).toBe(true);
  });
});

describe('buildSendCmdScript', () => {
  it('formats one sendcmd line per path point, setting both x and y', () => {
    const script = buildSendCmdScript(
      [
        { t: 0, x: 10, y: 0 },
        { t: 0.2, x: 20, y: 0 },
      ],
      'crop@reframe',
    );

    expect(script).toBe(
      '0 crop@reframe x 10, crop@reframe y 0;\n0.2 crop@reframe x 20, crop@reframe y 0;',
    );
  });
});
