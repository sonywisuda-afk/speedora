import { SEMANTIC_EVENT_TYPES } from '@speedora/contracts';
import { isCuriositySemanticEventType } from './is-curiosity-semantic-event-type';

describe('isCuriositySemanticEventType', () => {
  // The exhaustiveness guard itself - every SEMANTIC_EVENT_TYPES value
  // must return a real boolean. If Phase 2's taxonomy ever grows a 23rd
  // type, this fails at the TYPE level (the switch itself won't compile)
  // well before this loop would.
  it.each(SEMANTIC_EVENT_TYPES)('returns a boolean for "%s"', (type) => {
    expect(typeof isCuriositySemanticEventType(type)).toBe('boolean');
  });

  it('marks secret/prediction/warning/breaking_news/controversy as curiosity-evoking', () => {
    expect(isCuriositySemanticEventType('secret')).toBe(true);
    expect(isCuriositySemanticEventType('prediction')).toBe(true);
    expect(isCuriositySemanticEventType('warning')).toBe(true);
    expect(isCuriositySemanticEventType('breaking_news')).toBe(true);
    expect(isCuriositySemanticEventType('controversy')).toBe(true);
  });

  it('marks every other event type as not curiosity-evoking', () => {
    expect(isCuriositySemanticEventType('confession')).toBe(false);
    expect(isCuriositySemanticEventType('mistake')).toBe(false);
    expect(isCuriositySemanticEventType('failure')).toBe(false);
    expect(isCuriositySemanticEventType('success')).toBe(false);
    expect(isCuriositySemanticEventType('tutorial')).toBe(false);
    expect(isCuriositySemanticEventType('conflict')).toBe(false);
    expect(isCuriositySemanticEventType('lawsuit')).toBe(false);
    expect(isCuriositySemanticEventType('money')).toBe(false);
    expect(isCuriositySemanticEventType('ai')).toBe(false);
    expect(isCuriositySemanticEventType('business')).toBe(false);
    expect(isCuriositySemanticEventType('career')).toBe(false);
    expect(isCuriositySemanticEventType('health')).toBe(false);
    expect(isCuriositySemanticEventType('fear')).toBe(false);
    expect(isCuriositySemanticEventType('urgency')).toBe(false);
    expect(isCuriositySemanticEventType('achievement')).toBe(false);
    expect(isCuriositySemanticEventType('transformation')).toBe(false);
    expect(isCuriositySemanticEventType('life_lesson')).toBe(false);
  });
});
