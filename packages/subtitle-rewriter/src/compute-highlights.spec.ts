import type {
  EmotionalArcSample,
  MomentumSample,
  SemanticEvent,
  SubtitleLine,
} from '@speedora/contracts';
import { computeHighlightTimeline } from './compute-highlights';

function line(start: number, end: number, overrides: Partial<SubtitleLine> = {}): SubtitleLine {
  return {
    start,
    end,
    text: 'test line',
    words: [],
    emphasisWordIndices: [],
    ...overrides,
  };
}

function emotion(t: number, intensity: number): EmotionalArcSample {
  return { t, emotion: 'hap', intensity };
}

function momentum(t: number, momentumScore: number): MomentumSample {
  return { t, momentumScore };
}

function semanticEvent(type: SemanticEvent['type'], t: number, importance: number): SemanticEvent {
  return { type, t, confidence: 0.9, importance, evidence: [], reason: 'test' };
}

describe('computeHighlightTimeline', () => {
  it('returns an empty array when there are no lines', () => {
    expect(computeHighlightTimeline([], [], [], null)).toEqual([]);
  });

  it('skips a line with no available component at all', () => {
    const lines = [line(0, 1)];
    expect(computeHighlightTimeline(lines, [], [], null)).toEqual([]);
  });

  it('includes a line whose nearest emotional intensity alone clears the threshold', () => {
    const lines = [line(0, 1)];
    const result = computeHighlightTimeline(lines, [emotion(0, 0.8)], [], null);
    expect(result).toEqual([{ start: 0, end: 1, score: 0.8 }]);
  });

  it('excludes a line whose only component is below the punch threshold (0.6)', () => {
    const lines = [line(0, 1)];
    const result = computeHighlightTimeline(lines, [emotion(0, 0.3)], [], null);
    expect(result).toEqual([]);
  });

  it('includes a punch-flavored semantic event landing inside the line window', () => {
    const lines = [line(0, 2)];
    const events = [semanticEvent('breaking_news', 1, 0.9)];
    const result = computeHighlightTimeline(lines, [], [], events);
    expect(result).toEqual([{ start: 0, end: 2, score: 0.9 }]);
  });

  it('ignores a semantic event outside the line window', () => {
    const lines = [line(0, 2)];
    const events = [semanticEvent('breaking_news', 5, 0.9)];
    const result = computeHighlightTimeline(lines, [], [], events);
    expect(result).toEqual([]);
  });

  it('ignores a non-punch-flavored semantic event even inside the window', () => {
    const lines = [line(0, 2)];
    const events = [semanticEvent('tutorial', 1, 0.9)];
    const result = computeHighlightTimeline(lines, [], [], events);
    expect(result).toEqual([]);
  });

  it('averages every available component', () => {
    const lines = [line(0, 1)];
    // average(0.8 emotion, 1.0 punch importance, 0.6 momentum) = 0.8
    const result = computeHighlightTimeline(
      lines,
      [emotion(0, 0.8)],
      [momentum(0, 0.6)],
      [semanticEvent('urgency', 0, 1.0)],
    );
    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(1);
    expect(result[0].score).toBeCloseTo(0.8);
  });

  it('uses the MAX punch importance among multiple qualifying events in the same window', () => {
    const lines = [line(0, 2)];
    const events = [semanticEvent('warning', 0.5, 0.4), semanticEvent('conflict', 1, 0.9)];
    const result = computeHighlightTimeline(lines, [], [], events);
    expect(result).toEqual([{ start: 0, end: 2, score: 0.9 }]);
  });
});
