import { NARRATIVE_SEGMENT_TYPES } from '@speedora/contracts';
import { momentumMultiplierForSegmentType } from './segment-type-multiplier';

describe('momentumMultiplierForSegmentType', () => {
  // The exhaustiveness guard itself - every NARRATIVE_SEGMENT_TYPES value
  // must return a real, finite multiplier. If Phase 3's taxonomy ever
  // grows an 11th type, this fails at the TYPE level (the switch itself
  // won't compile) well before this loop would.
  it.each(NARRATIVE_SEGMENT_TYPES)('returns a finite positive multiplier for "%s"', (type) => {
    const multiplier = momentumMultiplierForSegmentType(type);
    expect(Number.isFinite(multiplier)).toBe(true);
    expect(multiplier).toBeGreaterThan(0);
  });

  it('boosts escalation/peak/conflict above neutral', () => {
    expect(momentumMultiplierForSegmentType('escalation')).toBeGreaterThan(1);
    expect(momentumMultiplierForSegmentType('peak')).toBeGreaterThan(1);
    expect(momentumMultiplierForSegmentType('conflict')).toBeGreaterThan(1);
  });

  it('reduces resolution/takeaway below neutral', () => {
    expect(momentumMultiplierForSegmentType('resolution')).toBeLessThan(1);
    expect(momentumMultiplierForSegmentType('takeaway')).toBeLessThan(1);
  });

  it('leaves hook/setup/context/problem/cta neutral', () => {
    expect(momentumMultiplierForSegmentType('hook')).toBe(1);
    expect(momentumMultiplierForSegmentType('setup')).toBe(1);
    expect(momentumMultiplierForSegmentType('context')).toBe(1);
    expect(momentumMultiplierForSegmentType('problem')).toBe(1);
    expect(momentumMultiplierForSegmentType('cta')).toBe(1);
  });
});
