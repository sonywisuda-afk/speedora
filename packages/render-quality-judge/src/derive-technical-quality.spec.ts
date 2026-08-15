import { deriveTechnicalQuality } from './derive-technical-quality';

const baseInput = {
  renderVerificationPassed: true,
  hasVideoStream: true,
  hasAudioStream: true,
  requestedDurationSeconds: 45,
  renderedDurationSeconds: 45,
};

describe('deriveTechnicalQuality', () => {
  it('returns a perfect measured score when everything matches', () => {
    const result = deriveTechnicalQuality(baseInput);
    expect(result.basis).toBe('measured');
    expect(result.score).toBe(100);
  });

  it('returns unavailable when the probe failed entirely', () => {
    const result = deriveTechnicalQuality({
      renderVerificationPassed: null,
      hasVideoStream: null,
      hasAudioStream: null,
      requestedDurationSeconds: 45,
      renderedDurationSeconds: null,
    });
    expect(result.score).toBeNull();
    expect(result.basis).toBe('unavailable');
  });

  it('penalizes a missing video stream heavily', () => {
    const result = deriveTechnicalQuality({ ...baseInput, hasVideoStream: false });
    expect(result.score).toBeLessThan(50);
    expect(result.notes).toContain('no video stream');
  });

  it('penalizes a missing audio stream', () => {
    const result = deriveTechnicalQuality({ ...baseInput, hasAudioStream: false });
    expect(result.score).toBe(80);
    expect(result.notes).toContain('no audio stream');
  });

  it('penalizes a RenderVerificationResult mismatch', () => {
    const result = deriveTechnicalQuality({ ...baseInput, renderVerificationPassed: false });
    expect(result.score).toBe(70);
    expect(result.notes).toContain('mismatch');
  });

  it('penalizes duration drift proportionally, saturating at the configured fraction', () => {
    // 10% drift, half of the 20% saturation fraction -> half the max 30-point penalty (15)
    const halfDrift = deriveTechnicalQuality({
      ...baseInput,
      renderedDurationSeconds: 45 * 1.1,
    });
    expect(halfDrift.score).toBeCloseTo(85, 0);

    // 40% drift, well beyond the 20% saturation fraction -> full 30-point penalty
    const fullDrift = deriveTechnicalQuality({
      ...baseInput,
      renderedDurationSeconds: 45 * 1.4,
    });
    expect(fullDrift.score).toBe(70);
  });

  it('never drops below 0 when multiple penalties stack', () => {
    const result = deriveTechnicalQuality({
      renderVerificationPassed: false,
      hasVideoStream: false,
      hasAudioStream: false,
      requestedDurationSeconds: 45,
      renderedDurationSeconds: 100,
    });
    expect(result.score).toBe(0);
  });
});
