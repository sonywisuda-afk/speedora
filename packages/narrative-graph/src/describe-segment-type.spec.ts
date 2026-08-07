import { NARRATIVE_SEGMENT_TYPES } from '@speedora/contracts';
import { describeSegmentType } from './describe-segment-type';

describe('describeSegmentType', () => {
  // The exhaustiveness guard itself - every NARRATIVE_SEGMENT_TYPES value
  // must have a real, non-empty description. If an 11th type is ever added
  // without updating describeSegmentType's switch, this fails at the TYPE
  // level (the switch itself won't compile) well before this loop would.
  it.each(NARRATIVE_SEGMENT_TYPES)('returns a non-empty description for "%s"', (type) => {
    const description = describeSegmentType(type);
    expect(typeof description).toBe('string');
    expect(description.length).toBeGreaterThan(0);
  });

  it('covers every declared type exactly once (no duplicates, no gaps)', () => {
    const descriptions = NARRATIVE_SEGMENT_TYPES.map(describeSegmentType);
    expect(new Set(descriptions).size).toBe(NARRATIVE_SEGMENT_TYPES.length);
  });
});
