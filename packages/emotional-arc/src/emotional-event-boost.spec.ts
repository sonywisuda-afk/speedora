import { SEMANTIC_EVENT_TYPES } from '@speedora/contracts';
import { emotionalBoostForSemanticEventType } from './emotional-event-boost';

describe('emotionalBoostForSemanticEventType', () => {
  // The exhaustiveness guard itself - every SEMANTIC_EVENT_TYPES value must
  // return a real, finite, non-negative boost. If Phase 2's taxonomy ever
  // grows a 23rd type, this fails at the TYPE level (the switch itself
  // won't compile) well before this loop would.
  it.each(SEMANTIC_EVENT_TYPES)('returns a finite non-negative boost for "%s"', (type) => {
    const boost = emotionalBoostForSemanticEventType(type);
    expect(Number.isFinite(boost)).toBe(true);
    expect(boost).toBeGreaterThanOrEqual(0);
  });

  it('gives the highest boost to high-charge types', () => {
    expect(emotionalBoostForSemanticEventType('confession')).toBe(0.2);
    expect(emotionalBoostForSemanticEventType('secret')).toBe(0.2);
    expect(emotionalBoostForSemanticEventType('failure')).toBe(0.2);
    expect(emotionalBoostForSemanticEventType('conflict')).toBe(0.2);
    expect(emotionalBoostForSemanticEventType('fear')).toBe(0.2);
    expect(emotionalBoostForSemanticEventType('controversy')).toBe(0.2);
    expect(emotionalBoostForSemanticEventType('transformation')).toBe(0.2);
  });

  it('gives a smaller boost to medium-charge types', () => {
    expect(emotionalBoostForSemanticEventType('mistake')).toBe(0.1);
    expect(emotionalBoostForSemanticEventType('success')).toBe(0.1);
    expect(emotionalBoostForSemanticEventType('warning')).toBe(0.1);
    expect(emotionalBoostForSemanticEventType('breaking_news')).toBe(0.1);
    expect(emotionalBoostForSemanticEventType('lawsuit')).toBe(0.1);
    expect(emotionalBoostForSemanticEventType('health')).toBe(0.1);
    expect(emotionalBoostForSemanticEventType('urgency')).toBe(0.1);
    expect(emotionalBoostForSemanticEventType('achievement')).toBe(0.1);
    expect(emotionalBoostForSemanticEventType('life_lesson')).toBe(0.1);
  });

  it('gives no boost to purely informational types', () => {
    expect(emotionalBoostForSemanticEventType('prediction')).toBe(0);
    expect(emotionalBoostForSemanticEventType('tutorial')).toBe(0);
    expect(emotionalBoostForSemanticEventType('money')).toBe(0);
    expect(emotionalBoostForSemanticEventType('ai')).toBe(0);
    expect(emotionalBoostForSemanticEventType('business')).toBe(0);
    expect(emotionalBoostForSemanticEventType('career')).toBe(0);
  });
});
