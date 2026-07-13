import { scoreEmotion } from './score-emotion';

describe('scoreEmotion', () => {
  it('returns an empty map for null input', () => {
    expect(scoreEmotion(null).size).toBe(0);
  });

  it('scores happy and surprise by their own confidence', () => {
    const scores = scoreEmotion([
      { t: 1, emotion: 'happy', score: 0.8 },
      { t: 2, emotion: 'surprise', score: 0.6 },
    ]);
    expect(scores.get(1)).toBe(0.8);
    expect(scores.get(2)).toBe(0.6);
  });

  it('ignores every other emotion, including neutral', () => {
    const scores = scoreEmotion([
      { t: 1, emotion: 'neutral', score: 0.9 },
      { t: 2, emotion: 'sad', score: 0.9 },
      { t: 3, emotion: 'angry', score: 0.9 },
    ]);
    expect(scores.size).toBe(0);
  });

  it('ignores samples with no detected face', () => {
    const scores = scoreEmotion([{ t: 1, emotion: null, score: null }]);
    expect(scores.size).toBe(0);
  });
});
