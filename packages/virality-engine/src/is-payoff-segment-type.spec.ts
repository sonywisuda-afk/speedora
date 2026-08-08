import { NARRATIVE_SEGMENT_TYPES } from '@speedora/contracts';
import { isPayoffSegmentType } from './is-payoff-segment-type';

describe('isPayoffSegmentType', () => {
  // The exhaustiveness guard itself - every NARRATIVE_SEGMENT_TYPES value
  // must return a real boolean. If Phase 3's taxonomy ever grows an 11th
  // type, this fails at the TYPE level (the switch itself won't compile)
  // well before this loop would.
  it.each(NARRATIVE_SEGMENT_TYPES)('returns a boolean for "%s"', (type) => {
    expect(typeof isPayoffSegmentType(type)).toBe('boolean');
  });

  it('marks resolution/takeaway/cta as payoff-bearing', () => {
    expect(isPayoffSegmentType('resolution')).toBe(true);
    expect(isPayoffSegmentType('takeaway')).toBe(true);
    expect(isPayoffSegmentType('cta')).toBe(true);
  });

  it('marks every other segment type as not payoff-bearing', () => {
    expect(isPayoffSegmentType('hook')).toBe(false);
    expect(isPayoffSegmentType('setup')).toBe(false);
    expect(isPayoffSegmentType('context')).toBe(false);
    expect(isPayoffSegmentType('problem')).toBe(false);
    expect(isPayoffSegmentType('conflict')).toBe(false);
    expect(isPayoffSegmentType('escalation')).toBe(false);
    expect(isPayoffSegmentType('peak')).toBe(false);
  });
});
