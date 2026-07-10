import { deriveCameraMotionFeatures } from './derive-camera-motion-features';

const NULL_SAMPLE = { dx: null, dy: null, scale: null, rotation: null, ecc: null };

describe('deriveCameraMotionFeatures', () => {
  it('returns all-null fields when there are no samples', () => {
    const result = deriveCameraMotionFeatures([]);
    expect(result).toEqual({
      panScore: null,
      tiltScore: null,
      zoomScore: null,
      shakeScore: null,
      dominantMotionType: null,
      dominantDirection: null,
      motionTypeDiversity: null,
      smoothnessScore: null,
    });
  });

  it('returns all-null fields when the only sample is the unclassifiable first one', () => {
    const result = deriveCameraMotionFeatures([{ t: 0, ...NULL_SAMPLE }]);
    expect(result).toEqual({
      panScore: null,
      tiltScore: null,
      zoomScore: null,
      shakeScore: null,
      dominantMotionType: null,
      dominantDirection: null,
      motionTypeDiversity: null,
      smoothnessScore: null,
    });
  });

  it('classifies sustained horizontal translation as dominant pan', () => {
    const result = deriveCameraMotionFeatures([
      { t: 0, ...NULL_SAMPLE },
      { t: 1, dx: 0.05, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 },
      { t: 2, dx: 0.05, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 },
    ]);
    expect(result.panScore).toBe(1);
    expect(result.tiltScore).toBe(0);
    expect(result.zoomScore).toBe(0);
    expect(result.dominantMotionType).toBe('pan');
  });

  it('classifies sustained vertical translation as dominant tilt', () => {
    const result = deriveCameraMotionFeatures([
      { t: 0, ...NULL_SAMPLE },
      { t: 1, dx: 0.001, dy: 0.05, scale: 1.0, rotation: 0, ecc: 0.9 },
      { t: 2, dx: 0.001, dy: 0.05, scale: 1.0, rotation: 0, ecc: 0.9 },
    ]);
    expect(result.tiltScore).toBe(1);
    expect(result.panScore).toBe(0);
    expect(result.dominantMotionType).toBe('tilt');
  });

  it('classifies a large scale change as dominant zoom', () => {
    const result = deriveCameraMotionFeatures([
      { t: 0, ...NULL_SAMPLE },
      { t: 1, dx: 0.001, dy: 0.001, scale: 1.1, rotation: 0, ecc: 0.9 },
      { t: 2, dx: 0.001, dy: 0.001, scale: 1.12, rotation: 0, ecc: 0.9 },
    ]);
    expect(result.zoomScore).toBe(1);
    expect(result.dominantMotionType).toBe('zoom');
  });

  it('classifies tiny sub-threshold movement as static with zero shakeScore', () => {
    const result = deriveCameraMotionFeatures([
      { t: 0, ...NULL_SAMPLE },
      { t: 1, dx: 0.001, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 },
      { t: 2, dx: -0.001, dy: -0.001, scale: 1.001, rotation: 0, ecc: 0.9 },
    ]);
    expect(result.dominantMotionType).toBe('static');
    // The dx/dy sign flips between the two samples, but both are below
    // PAN_TILT_THRESHOLD - sub-threshold noise must not count as a "shake"
    // reversal.
    expect(result.shakeScore).toBe(0);
  });

  it('detects alternating above-threshold translation as dominant shake, overriding the per-sample pan majority', () => {
    const result = deriveCameraMotionFeatures([
      { t: 0, ...NULL_SAMPLE },
      { t: 1, dx: 0.03, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
      { t: 2, dx: -0.03, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
      { t: 3, dx: 0.03, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
      { t: 4, dx: -0.03, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
    ]);
    expect(result.panScore).toBe(1);
    expect(result.shakeScore).toBe(1);
    expect(result.dominantMotionType).toBe('shake');
  });

  it('returns a null shakeScore when fewer than two samples are classifiable', () => {
    const result = deriveCameraMotionFeatures([
      { t: 0, ...NULL_SAMPLE },
      { t: 1, dx: 0.05, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
    ]);
    expect(result.shakeScore).toBeNull();
  });

  it('breaks a pan/tilt count tie toward pan (earlier in the fixed priority order)', () => {
    const result = deriveCameraMotionFeatures([
      { t: 0, ...NULL_SAMPLE },
      { t: 1, dx: 0.05, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 },
      { t: 2, dx: 0.001, dy: 0.05, scale: 1.0, rotation: 0, ecc: 0.9 },
    ]);
    expect(result.panScore).toBe(0.5);
    expect(result.tiltScore).toBe(0.5);
    expect(result.dominantMotionType).toBe('pan');
  });

  it('ignores samples that failed to align (null transform) when computing scores', () => {
    const result = deriveCameraMotionFeatures([
      { t: 0, ...NULL_SAMPLE },
      { t: 1, dx: 0.05, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
      { t: 2, ...NULL_SAMPLE },
      { t: 3, dx: 0.05, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
    ]);
    expect(result.panScore).toBe(1);
  });

  // Batch SC-4 - Motion Direction.
  describe('dominantDirection', () => {
    it('classifies a rightward pan (positive dx) as "right"', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0.05, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 2, dx: 0.05, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 },
      ]);
      expect(result.dominantDirection).toBe('right');
    });

    it('classifies a leftward pan (negative dx) as "left"', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: -0.05, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 2, dx: -0.05, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 },
      ]);
      expect(result.dominantDirection).toBe('left');
    });

    it('classifies a downward tilt (positive dy) as "down"', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0.001, dy: 0.05, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 2, dx: 0.001, dy: 0.05, scale: 1.0, rotation: 0, ecc: 0.9 },
      ]);
      expect(result.dominantDirection).toBe('down');
    });

    it('classifies an upward tilt (negative dy) as "up"', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0.001, dy: -0.05, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 2, dx: 0.001, dy: -0.05, scale: 1.0, rotation: 0, ecc: 0.9 },
      ]);
      expect(result.dominantDirection).toBe('up');
    });

    it('classifies a scale increase (zooming in) as "in"', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0.001, dy: 0.001, scale: 1.1, rotation: 0, ecc: 0.9 },
        { t: 2, dx: 0.001, dy: 0.001, scale: 1.12, rotation: 0, ecc: 0.9 },
      ]);
      expect(result.dominantDirection).toBe('in');
    });

    it('classifies a scale decrease (zooming out) as "out"', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0.001, dy: 0.001, scale: 0.9, rotation: 0, ecc: 0.9 },
        { t: 2, dx: 0.001, dy: 0.001, scale: 0.88, rotation: 0, ecc: 0.9 },
      ]);
      expect(result.dominantDirection).toBe('out');
    });

    it('classifies tiny sub-threshold movement as "static"', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0.001, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 2, dx: -0.001, dy: -0.001, scale: 1.001, rotation: 0, ecc: 0.9 },
      ]);
      expect(result.dominantDirection).toBe('static');
    });

    it('picks a meaningful direction for a shake-dominant clip rather than falling back to shake', () => {
      // Alternating rightward/leftward whips, but with an extra rightward
      // sample breaking the tie. dominantMotionType is 'shake' (still
      // enough reversals to clear SHAKE_DOMINANT_THRESHOLD), but
      // dominantDirection is computed independently and still reports the
      // majority sub-direction ('right', 3 samples vs 'left'’s 2).
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0.03, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 2, dx: -0.03, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 3, dx: 0.03, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 4, dx: -0.03, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 5, dx: 0.03, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
      ]);
      expect(result.dominantMotionType).toBe('shake');
      expect(result.dominantDirection).toBe('right');
    });

    it('breaks a left/right direction tie toward "left" (earlier in the fixed priority order)', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0.03, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 2, dx: -0.03, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
      ]);
      expect(result.dominantDirection).toBe('left');
    });
  });

  // Batch SC-6 - Motion Complexity (camera-motion half).
  describe('motionTypeDiversity', () => {
    it('is 0 when every classifiable sample falls in one category', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0.05, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 2, dx: 0.05, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 },
      ]);
      expect(result.motionTypeDiversity).toBe(0);
    });

    it('is 1 when samples are evenly spread across all four categories', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0.05, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 }, // pan
        { t: 2, dx: 0.001, dy: 0.05, scale: 1.0, rotation: 0, ecc: 0.9 }, // tilt
        { t: 3, dx: 0.001, dy: 0.001, scale: 1.1, rotation: 0, ecc: 0.9 }, // zoom
        { t: 4, dx: 0.001, dy: 0.001, scale: 1.0, rotation: 0, ecc: 0.9 }, // static
      ]);
      expect(result.motionTypeDiversity).toBeCloseTo(1);
    });

    it('returns null when there are no classifiable samples', () => {
      const result = deriveCameraMotionFeatures([{ t: 0, ...NULL_SAMPLE }]);
      expect(result.motionTypeDiversity).toBeNull();
    });
  });

  // Batch SC-7 - Motion Smoothness (Camera Jitter).
  describe('smoothnessScore', () => {
    it('is 1 for a perfectly smooth pan (zero frame-to-frame delta)', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0.05, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 2, dx: 0.05, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
      ]);
      expect(result.smoothnessScore).toBe(1);
    });

    it('is 0 (clamped) when the average delta clears the jitter cap', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: -0.05, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 2, dx: 0.05, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
      ]);
      // delta = |0.05 - -0.05| = 0.1, well above JITTER_CAP (0.04).
      expect(result.smoothnessScore).toBe(0);
    });

    it('maps a half-of-cap average delta to the midpoint', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 2, dx: 0.02, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
      ]);
      // delta = 0.02, half of JITTER_CAP (0.04) -> score 0.5.
      expect(result.smoothnessScore).toBeCloseTo(0.5);
    });

    it('returns null when fewer than two samples are classifiable', () => {
      const result = deriveCameraMotionFeatures([
        { t: 0, ...NULL_SAMPLE },
        { t: 1, dx: 0.05, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
      ]);
      expect(result.smoothnessScore).toBeNull();
    });
  });
});
