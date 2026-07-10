import { deriveMotionEnergyFeatures } from './derive-motion-energy-features';

describe('deriveMotionEnergyFeatures', () => {
  it('returns all-null fields when there are no samples', () => {
    const result = deriveMotionEnergyFeatures([], 60);
    expect(result).toEqual({
      averageMotionEnergy: null,
      peakMotionEnergy: null,
      staticRatio: null,
      dynamicRatio: null,
      peakCount: null,
      peakTimestamps: null,
      peakRatePerMinute: null,
      motionVariability: null,
    });
  });

  it('computes averageMotionEnergy as the mean of every sample', () => {
    const result = deriveMotionEnergyFeatures(
      [
        { t: 0, motionEnergy: 2 },
        { t: 1, motionEnergy: 4 },
        { t: 2, motionEnergy: 6 },
      ],
      60,
    );
    expect(result.averageMotionEnergy).toBe(4);
  });

  it('computes peakMotionEnergy as the maximum sample', () => {
    const result = deriveMotionEnergyFeatures(
      [
        { t: 0, motionEnergy: 2 },
        { t: 1, motionEnergy: 9.5 },
        { t: 2, motionEnergy: 6 },
      ],
      60,
    );
    expect(result.peakMotionEnergy).toBe(9.5);
  });

  it('classifies every sample as static when all are at/below the threshold', () => {
    const result = deriveMotionEnergyFeatures(
      [
        { t: 0, motionEnergy: 0 },
        { t: 1, motionEnergy: 4 },
      ],
      60,
    );
    expect(result.staticRatio).toBe(1);
    expect(result.dynamicRatio).toBe(0);
  });

  it('classifies every sample as dynamic when all are above the threshold', () => {
    const result = deriveMotionEnergyFeatures(
      [
        { t: 0, motionEnergy: 10 },
        { t: 1, motionEnergy: 20 },
      ],
      60,
    );
    expect(result.staticRatio).toBe(0);
    expect(result.dynamicRatio).toBe(1);
  });

  it('splits staticRatio/dynamicRatio proportionally for a mixed clip', () => {
    const result = deriveMotionEnergyFeatures(
      [
        { t: 0, motionEnergy: 1 },
        { t: 1, motionEnergy: 2 },
        { t: 2, motionEnergy: 10 },
        { t: 3, motionEnergy: 20 },
      ],
      60,
    );
    expect(result.staticRatio).toBe(0.5);
    expect(result.dynamicRatio).toBe(0.5);
  });

  it('always sums staticRatio + dynamicRatio to 1', () => {
    const result = deriveMotionEnergyFeatures(
      [
        { t: 0, motionEnergy: 1 },
        { t: 1, motionEnergy: 3.9 },
        { t: 2, motionEnergy: 4 },
        { t: 3, motionEnergy: 100 },
      ],
      60,
    );
    expect((result.staticRatio ?? 0) + (result.dynamicRatio ?? 0)).toBe(1);
  });

  // Batch SC-5 - Motion Peak Detection.
  describe('peak detection', () => {
    it('detects a single mid-clip spike as one peak', () => {
      const result = deriveMotionEnergyFeatures(
        [
          { t: 0, motionEnergy: 2 },
          { t: 1, motionEnergy: 2 },
          { t: 2, motionEnergy: 2 },
          { t: 3, motionEnergy: 20 },
          { t: 4, motionEnergy: 2 },
          { t: 5, motionEnergy: 2 },
          { t: 6, motionEnergy: 2 },
        ],
        60,
      );
      expect(result.peakCount).toBe(1);
      expect(result.peakTimestamps).toEqual([3]);
      expect(result.peakRatePerMinute).toBe(1);
    });

    it('detects a spike at the first sample (compared only to its one neighbor)', () => {
      const result = deriveMotionEnergyFeatures(
        [
          { t: 0, motionEnergy: 20 },
          { t: 1, motionEnergy: 2 },
          { t: 2, motionEnergy: 2 },
          { t: 3, motionEnergy: 2 },
          { t: 4, motionEnergy: 2 },
          { t: 5, motionEnergy: 2 },
          { t: 6, motionEnergy: 2 },
        ],
        60,
      );
      expect(result.peakCount).toBe(1);
      expect(result.peakTimestamps).toEqual([0]);
    });

    it('reports zero peaks for a perfectly flat signal (stddev 0)', () => {
      const result = deriveMotionEnergyFeatures(
        [
          { t: 0, motionEnergy: 5 },
          { t: 1, motionEnergy: 5 },
          { t: 2, motionEnergy: 5 },
        ],
        60,
      );
      expect(result.peakCount).toBe(0);
      expect(result.peakTimestamps).toEqual([]);
      expect(result.peakRatePerMinute).toBe(0);
    });

    it('does not count either sample of a high plateau (neither is a strict local maximum)', () => {
      const result = deriveMotionEnergyFeatures(
        [
          { t: 0, motionEnergy: 2 },
          { t: 1, motionEnergy: 20 },
          { t: 2, motionEnergy: 20 },
          { t: 3, motionEnergy: 2 },
        ],
        60,
      );
      expect(result.peakCount).toBe(0);
    });

    it('returns a null peakRatePerMinute when clip duration is 0', () => {
      const result = deriveMotionEnergyFeatures(
        [
          { t: 0, motionEnergy: 2 },
          { t: 1, motionEnergy: 2 },
          { t: 2, motionEnergy: 2 },
          { t: 3, motionEnergy: 20 },
          { t: 4, motionEnergy: 2 },
          { t: 5, motionEnergy: 2 },
          { t: 6, motionEnergy: 2 },
        ],
        0,
      );
      expect(result.peakCount).toBe(1);
      expect(result.peakRatePerMinute).toBeNull();
    });
  });

  // Batch SC-6 - Motion Complexity (motion-energy half).
  describe('motionVariability', () => {
    it('computes the coefficient of variation (stddev / mean)', () => {
      const result = deriveMotionEnergyFeatures(
        [
          { t: 0, motionEnergy: 2 },
          { t: 1, motionEnergy: 4 },
          { t: 2, motionEnergy: 6 },
        ],
        60,
      );
      // mean = 4, stddev = sqrt(((2-4)^2+(4-4)^2+(6-4)^2)/3) = sqrt(8/3) ≈ 1.633.
      expect(result.motionVariability).toBeCloseTo(1.63299 / 4, 4);
    });

    it('is 0 for a perfectly flat signal (stddev 0)', () => {
      const result = deriveMotionEnergyFeatures(
        [
          { t: 0, motionEnergy: 5 },
          { t: 1, motionEnergy: 5 },
        ],
        60,
      );
      expect(result.motionVariability).toBe(0);
    });

    it('is null when the mean is 0 (division undefined)', () => {
      const result = deriveMotionEnergyFeatures(
        [
          { t: 0, motionEnergy: 0 },
          { t: 1, motionEnergy: 0 },
        ],
        60,
      );
      expect(result.motionVariability).toBeNull();
    });
  });
});
