import type {
  CameraMotionSample,
  ComputeMomentumCurveInput,
  MotionEnergySample,
  NarrativeGraph,
} from '@speedora/contracts';
import { computeMomentumCurve } from './compute-momentum-curve';

function baseInput(overrides: Partial<ComputeMomentumCurveInput> = {}): ComputeMomentumCurveInput {
  return {
    clipDurationSeconds: 5,
    motionEnergySamples: [],
    cameraMotionSamples: null,
    accelerationScore: null,
    narrativeGraph: null,
    ...overrides,
  };
}

function motionSample(t: number, motionEnergy: number): MotionEnergySample {
  return { t, motionEnergy };
}

describe('computeMomentumCurve', () => {
  it('returns an empty curve when there are no motion energy samples', () => {
    expect(computeMomentumCurve(baseInput())).toEqual([]);
  });

  it('does not throw when cameraMotionSamples/accelerationScore/narrativeGraph are all null', () => {
    const input = baseInput({
      motionEnergySamples: [motionSample(0, 1), motionSample(1, 2)],
    });
    expect(() => computeMomentumCurve(input)).not.toThrow();
  });

  it('produces a monotonically non-decreasing base curve from steadily-rising motion energy', () => {
    const input = baseInput({
      motionEnergySamples: [motionSample(0, 1), motionSample(1, 2), motionSample(2, 3)],
    });

    const result = computeMomentumCurve(input);

    expect(result).toEqual([
      { t: 0, momentumScore: 0 },
      { t: 1, momentumScore: 0.5 },
      { t: 2, momentumScore: 1 },
    ]);
  });

  it('returns an all-zero curve when every motion energy sample is identical (no range to normalize)', () => {
    const input = baseInput({
      motionEnergySamples: [motionSample(0, 5), motionSample(1, 5), motionSample(2, 5)],
    });

    const result = computeMomentumCurve(input);

    expect(result.every((sample) => sample.momentumScore === 0)).toBe(true);
  });

  function narrativeGraphWithSegment(
    type: 'peak' | 'resolution',
    startTime: number,
    endTime: number,
  ): NarrativeGraph {
    return {
      segments: [{ id: 0, type, startTime, endTime, confidence: 0.9, reason: 'test' }],
      relations: [],
      unsegmented: false,
    };
  }

  const NON_EXTREME_SAMPLES: MotionEnergySample[] = [
    motionSample(0, 1),
    motionSample(1, 2),
    motionSample(2, 4),
    motionSample(3, 2),
    motionSample(4, 1),
  ];

  it('boosts momentumScore for a sample covered by a "peak" narrative segment', () => {
    const withoutGraph = computeMomentumCurve(
      baseInput({ motionEnergySamples: NON_EXTREME_SAMPLES }),
    );
    const withGraph = computeMomentumCurve(
      baseInput({
        motionEnergySamples: NON_EXTREME_SAMPLES,
        narrativeGraph: narrativeGraphWithSegment('peak', 0.5, 1.5),
      }),
    );

    const baseline = withoutGraph.find((sample) => sample.t === 1)!.momentumScore;
    const boosted = withGraph.find((sample) => sample.t === 1)!.momentumScore;
    expect(boosted).toBeCloseTo(baseline * 1.2, 5);
    expect(boosted).toBeGreaterThan(baseline);
  });

  it('reduces momentumScore for a sample covered by a "resolution" narrative segment', () => {
    const withoutGraph = computeMomentumCurve(
      baseInput({ motionEnergySamples: NON_EXTREME_SAMPLES }),
    );
    const withGraph = computeMomentumCurve(
      baseInput({
        motionEnergySamples: NON_EXTREME_SAMPLES,
        narrativeGraph: narrativeGraphWithSegment('resolution', 2.5, 3.5),
      }),
    );

    const baseline = withoutGraph.find((sample) => sample.t === 3)!.momentumScore;
    const reduced = withGraph.find((sample) => sample.t === 3)!.momentumScore;
    expect(reduced).toBeCloseTo(baseline * 0.85, 5);
    expect(reduced).toBeLessThan(baseline);
  });

  it('treats a null narrativeGraph and an unsegmented one identically (no modifier)', () => {
    const withNull = computeMomentumCurve(
      baseInput({ motionEnergySamples: NON_EXTREME_SAMPLES, narrativeGraph: null }),
    );
    const withUnsegmented = computeMomentumCurve(
      baseInput({
        motionEnergySamples: NON_EXTREME_SAMPLES,
        narrativeGraph: { segments: [], relations: [], unsegmented: true },
      }),
    );

    expect(withUnsegmented).toEqual(withNull);
  });

  it('blends in camera motion magnitude when a concurrent cameraMotionSample is available', () => {
    const flatSamples: MotionEnergySample[] = [motionSample(0, 1), motionSample(10, 1)];
    const cameraMotionSamples: CameraMotionSample[] = [
      { t: 1, dx: 0.1, dy: 0.1, scale: 1.1, rotation: 0, ecc: 0.9 },
    ];

    const withoutCamera = computeMomentumCurve(baseInput({ motionEnergySamples: flatSamples }));
    const withCamera = computeMomentumCurve(
      baseInput({ motionEnergySamples: flatSamples, cameraMotionSamples }),
    );

    // Both motion-energy samples are identical -> base is 0 everywhere, so
    // any non-zero score must come entirely from the camera term.
    expect(withoutCamera.find((s) => s.t === 0)!.momentumScore).toBe(0);
    // t=0 is within the match window of the camera sample at t=1.
    expect(withCamera.find((s) => s.t === 0)!.momentumScore).toBeGreaterThan(0);
    // t=10 is far outside the match window - no boost.
    expect(withCamera.find((s) => s.t === 10)!.momentumScore).toBe(0);
  });

  it('biases later samples upward when accelerationScore is positive', () => {
    const flatSamples: MotionEnergySample[] = [motionSample(0, 1), motionSample(4, 1)];

    const result = computeMomentumCurve(
      baseInput({
        motionEnergySamples: flatSamples,
        clipDurationSeconds: 4,
        accelerationScore: 1,
      }),
    );

    const first = result.find((s) => s.t === 0)!.momentumScore;
    const last = result.find((s) => s.t === 4)!.momentumScore;
    expect(last).toBeGreaterThan(first);
  });
});
