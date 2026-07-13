import type { OcrTextTrack } from '@speedora/contracts';
import { scoreOcrImportance } from './score-ocr-importance';

function track(overrides: Partial<OcrTextTrack> = {}): OcrTextTrack {
  return {
    trackId: 1,
    text: 'hello',
    boundingBox: { xCenter: 0.5, yCenter: 0.9, width: 0.5, height: 0.1 },
    confidence: 0.9,
    startTime: 1,
    endTime: 3,
    durationSeconds: 2,
    appearsFrames: 2,
    persistenceScore: 0.5,
    motionScore: null,
    nearFace: null,
    language: null,
    regexFlags: { isPriceLike: false, isNameLike: false },
    category: 'subtitle',
    categoryConfidence: 0.8,
    classificationMethod: 'HybridRuleEngine',
    ...overrides,
  };
}

describe('scoreOcrImportance', () => {
  it('returns an empty map for null tracks', () => {
    expect(scoreOcrImportance(null, [1, 2, 3]).size).toBe(0);
  });

  it('scores candidates inside the track window by category weight * confidence', () => {
    const scores = scoreOcrImportance(
      [track({ category: 'subtitle', categoryConfidence: 0.8 })],
      [1, 2, 3],
    );
    // subtitle weight 0.6 * confidence 0.8 = 0.48
    expect(scores.get(2)).toBeCloseTo(0.48);
  });

  it('does not score candidates outside the track window', () => {
    const scores = scoreOcrImportance([track({ startTime: 1, endTime: 2 })], [0, 5]);
    expect(scores.size).toBe(0);
  });

  it('picks the highest-weighted overlapping track at a given instant', () => {
    const scores = scoreOcrImportance(
      [
        track({ category: 'logo', categoryConfidence: 1, startTime: 0, endTime: 5 }),
        track({ category: 'price', categoryConfidence: 1, startTime: 0, endTime: 5 }),
      ],
      [1],
    );
    expect(scores.get(1)).toBeCloseTo(0.9);
  });
});
