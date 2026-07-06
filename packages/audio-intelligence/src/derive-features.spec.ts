import { deriveAudioFeatures } from './derive-features';

describe('deriveAudioFeatures', () => {
  it('returns all-null features when there are no segments at all', () => {
    expect(deriveAudioFeatures([])).toEqual({
      averageRmsDb: null,
      peakDb: null,
      averageSpeakingRateWordsPerSecond: null,
      speakingRateStdDev: null,
    });
  });

  it('returns all-null features when every segment reading is null', () => {
    const result = deriveAudioFeatures([
      { rmsDb: null, peakDb: null, speakingRateWordsPerSecond: null },
      { rmsDb: null, peakDb: null, speakingRateWordsPerSecond: null },
    ]);
    expect(result).toEqual({
      averageRmsDb: null,
      peakDb: null,
      averageSpeakingRateWordsPerSecond: null,
      speakingRateStdDev: null,
    });
  });

  it('averages rmsDb and speaking rate across segments that have a reading', () => {
    const result = deriveAudioFeatures([
      { rmsDb: -20, peakDb: -5, speakingRateWordsPerSecond: 2 },
      { rmsDb: -10, peakDb: -2, speakingRateWordsPerSecond: 4 },
    ]);
    expect(result.averageRmsDb).toBe(-15);
    expect(result.averageSpeakingRateWordsPerSecond).toBe(3);
  });

  it('takes peakDb as the max (loudest) across segments, not an average', () => {
    const result = deriveAudioFeatures([
      { rmsDb: -20, peakDb: -8, speakingRateWordsPerSecond: 2 },
      { rmsDb: -10, peakDb: -2, speakingRateWordsPerSecond: 2 },
    ]);
    expect(result.peakDb).toBe(-2);
  });

  it('ignores null readings within an otherwise-populated segment list', () => {
    const result = deriveAudioFeatures([
      { rmsDb: -20, peakDb: -5, speakingRateWordsPerSecond: 2 },
      { rmsDb: null, peakDb: null, speakingRateWordsPerSecond: null },
    ]);
    expect(result.averageRmsDb).toBe(-20);
    expect(result.peakDb).toBe(-5);
    expect(result.averageSpeakingRateWordsPerSecond).toBe(2);
  });

  it('computes a non-zero speakingRateStdDev when rates vary across segments', () => {
    const result = deriveAudioFeatures([
      { rmsDb: -20, peakDb: -5, speakingRateWordsPerSecond: 1 },
      { rmsDb: -20, peakDb: -5, speakingRateWordsPerSecond: 3 },
    ]);
    expect(result.speakingRateStdDev).toBe(1);
  });

  it('returns null speakingRateStdDev when fewer than 2 segments have a rate reading', () => {
    const result = deriveAudioFeatures([{ rmsDb: -20, peakDb: -5, speakingRateWordsPerSecond: 2 }]);
    expect(result.speakingRateStdDev).toBeNull();
  });
});
