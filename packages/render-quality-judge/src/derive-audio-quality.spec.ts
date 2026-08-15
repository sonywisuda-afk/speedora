import { deriveAudioQuality } from './derive-audio-quality';

describe('deriveAudioQuality', () => {
  it('returns speakerClarity as a proxy score', () => {
    const result = deriveAudioQuality({ speakerClarity: 65 });
    expect(result).toEqual({
      score: 65,
      basis: 'proxy',
      notes: expect.stringContaining('PROXY ONLY'),
    });
  });

  it('returns unavailable when speakerClarity is null (monologue or no EditorialDecision)', () => {
    const result = deriveAudioQuality({ speakerClarity: null });
    expect(result.score).toBeNull();
    expect(result.basis).toBe('unavailable');
  });
});
