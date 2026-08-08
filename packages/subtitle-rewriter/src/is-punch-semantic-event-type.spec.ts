import { SEMANTIC_EVENT_TYPES } from '@speedora/contracts';
import { isPunchSemanticEventType } from './is-punch-semantic-event-type';

describe('isPunchSemanticEventType', () => {
  // The exhaustiveness guard itself - every SEMANTIC_EVENT_TYPES value must
  // return a real boolean. If Phase 2's taxonomy ever grows a 23rd type,
  // this fails at the TYPE level (the switch itself won't compile) well
  // before this loop would.
  it.each(SEMANTIC_EVENT_TYPES)('returns a boolean for "%s"', (type) => {
    expect(typeof isPunchSemanticEventType(type)).toBe('boolean');
  });

  it('marks breaking_news/controversy/warning/urgency/conflict/fear/achievement/transformation as punch-worthy', () => {
    expect(isPunchSemanticEventType('breaking_news')).toBe(true);
    expect(isPunchSemanticEventType('controversy')).toBe(true);
    expect(isPunchSemanticEventType('warning')).toBe(true);
    expect(isPunchSemanticEventType('urgency')).toBe(true);
    expect(isPunchSemanticEventType('conflict')).toBe(true);
    expect(isPunchSemanticEventType('fear')).toBe(true);
    expect(isPunchSemanticEventType('achievement')).toBe(true);
    expect(isPunchSemanticEventType('transformation')).toBe(true);
  });

  it('marks every other event type as not punch-worthy', () => {
    expect(isPunchSemanticEventType('confession')).toBe(false);
    expect(isPunchSemanticEventType('mistake')).toBe(false);
    expect(isPunchSemanticEventType('failure')).toBe(false);
    expect(isPunchSemanticEventType('success')).toBe(false);
    expect(isPunchSemanticEventType('secret')).toBe(false);
    expect(isPunchSemanticEventType('prediction')).toBe(false);
    expect(isPunchSemanticEventType('tutorial')).toBe(false);
    expect(isPunchSemanticEventType('lawsuit')).toBe(false);
    expect(isPunchSemanticEventType('money')).toBe(false);
    expect(isPunchSemanticEventType('ai')).toBe(false);
    expect(isPunchSemanticEventType('business')).toBe(false);
    expect(isPunchSemanticEventType('career')).toBe(false);
    expect(isPunchSemanticEventType('health')).toBe(false);
    expect(isPunchSemanticEventType('life_lesson')).toBe(false);
  });
});
