import type { FaceLandmarkSample } from '@speedora/contracts';
import { scoreFaceClarity } from './score-face-clarity';

function sample(overrides: Partial<FaceLandmarkSample> = {}): FaceLandmarkSample {
  return {
    t: 0,
    blendshapes: null,
    rotation: null,
    boundingBox: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.3 },
    leftIris: null,
    rightIris: null,
    leftEyeInnerCorner: null,
    leftEyeOuterCorner: null,
    rightEyeInnerCorner: null,
    rightEyeOuterCorner: null,
    sharpness: null,
    brightness: null,
    mouthContrastRatio: null,
    faceDescriptor: null,
    trackId: null,
    mouthWidth: null,
    ...overrides,
  };
}

describe('scoreFaceClarity', () => {
  it('returns an empty map for null input', () => {
    expect(scoreFaceClarity(null).size).toBe(0);
  });

  it('excludes samples with no bounding box entirely', () => {
    const scores = scoreFaceClarity([sample({ t: 1, boundingBox: null, sharpness: 500 })]);
    expect(scores.has(1)).toBe(false);
  });

  it('scores a sharp, frontal, smiling face near 1', () => {
    const scores = scoreFaceClarity([
      sample({
        t: 2,
        sharpness: 500,
        rotation: { pitch: 0, yaw: 0, roll: 0 },
        blendshapes: {
          eyeBlinkLeft: 0,
          eyeBlinkRight: 0,
          mouthSmileLeft: 1,
          mouthSmileRight: 1,
          jawOpen: 0,
          cheekSquintLeft: 0,
          cheekSquintRight: 0,
          eyeSquintLeft: 0,
          eyeSquintRight: 0,
          browDownLeft: 0,
          browDownRight: 0,
          browInnerUp: 0,
          browOuterUpLeft: 0,
          browOuterUpRight: 0,
        },
      }),
    ]);
    expect(scores.get(2)).toBeCloseTo(1);
  });

  it('averages only the components actually present', () => {
    const scores = scoreFaceClarity([sample({ t: 3, sharpness: 250 })]);
    // sharpness/SHARPNESS_CAP = 250/500 = 0.5, the only available component.
    expect(scores.get(3)).toBeCloseTo(0.5);
  });
});
