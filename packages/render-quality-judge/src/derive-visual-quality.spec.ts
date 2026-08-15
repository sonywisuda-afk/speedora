import { deriveVisualQuality } from './derive-visual-quality';

describe('deriveVisualQuality', () => {
  it('returns visualEngagement as a proxy score when there is no instability signal', () => {
    const result = deriveVisualQuality({
      visualEngagement: 60,
      hasVisualInstabilitySignal: false,
    });
    expect(result.basis).toBe('proxy');
    expect(result.score).toBe(60);
    expect(result.notes).toContain('PROXY ONLY');
  });

  it('applies the instability penalty when the negative signal is present', () => {
    const result = deriveVisualQuality({
      visualEngagement: 60,
      hasVisualInstabilitySignal: true,
    });
    expect(result.score).toBe(40);
  });

  it('never drops below 0', () => {
    const result = deriveVisualQuality({
      visualEngagement: 10,
      hasVisualInstabilitySignal: true,
    });
    expect(result.score).toBe(0);
  });

  it('returns unavailable when visualEngagement is null', () => {
    const result = deriveVisualQuality({
      visualEngagement: null,
      hasVisualInstabilitySignal: false,
    });
    expect(result.score).toBeNull();
    expect(result.basis).toBe('unavailable');
  });
});
