import { SEMANTIC_EVENT_TYPES } from '@speedora/contracts';
import { describeEventType } from './describe-event-type';

describe('describeEventType', () => {
  // The exhaustiveness guard itself - every SEMANTIC_EVENT_TYPES value must
  // have a real, non-empty description. If a 23rd type is ever added to the
  // taxonomy without updating describeEventType's switch, this test starts
  // failing at the TYPE level (the switch itself won't compile) well before
  // this loop would ever catch a runtime gap.
  it.each(SEMANTIC_EVENT_TYPES)('returns a non-empty description for "%s"', (type) => {
    const description = describeEventType(type);
    expect(typeof description).toBe('string');
    expect(description.length).toBeGreaterThan(0);
  });

  it('covers every declared type exactly once (no duplicates, no gaps)', () => {
    const descriptions = SEMANTIC_EVENT_TYPES.map(describeEventType);
    expect(new Set(descriptions).size).toBe(SEMANTIC_EVENT_TYPES.length);
  });
});
