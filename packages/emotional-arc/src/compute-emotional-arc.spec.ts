import type {
  ComputeEmotionalArcInput,
  EmotionalArcSegment,
  SemanticEvent,
} from '@speedora/contracts';
import { computeEmotionalArc } from './compute-emotional-arc';

function baseInput(overrides: Partial<ComputeEmotionalArcInput> = {}): ComputeEmotionalArcInput {
  return {
    clipDurationSeconds: 5,
    segments: [],
    semanticEvents: null,
    ...overrides,
  };
}

function segment(start: number, end: number, emotion: string | null): EmotionalArcSegment {
  return { start, end, emotion };
}

function event(type: SemanticEvent['type'], t: number): SemanticEvent {
  return { type, t, confidence: 0.9, importance: 0.9, evidence: [], reason: 'test' };
}

describe('computeEmotionalArc', () => {
  it('returns an empty arc when there are no segments', () => {
    expect(computeEmotionalArc(baseInput())).toEqual([]);
  });

  it('assigns the correct base intensity for each of the 4 VOCAL_EMOTIONS labels', () => {
    const input = baseInput({
      segments: [
        segment(0, 1, 'neu'),
        segment(1, 2, 'sad'),
        segment(2, 3, 'hap'),
        segment(3, 4, 'ang'),
      ],
    });

    const result = computeEmotionalArc(input);

    expect(result).toEqual([
      { t: 0, emotion: 'neu', intensity: 0.1 },
      { t: 1, emotion: 'sad', intensity: 0.55 },
      { t: 2, emotion: 'hap', intensity: 0.65 },
      { t: 3, emotion: 'ang', intensity: 0.85 },
    ]);
  });

  it('treats a null emotion (unclassified segment) as intensity 0, emotion null', () => {
    const input = baseInput({ segments: [segment(0, 1, null)] });
    expect(computeEmotionalArc(input)).toEqual([{ t: 0, emotion: null, intensity: 0 }]);
  });

  it('defensively falls back to null for an unrecognized emotion string, not a throw', () => {
    const input = baseInput({ segments: [segment(0, 1, 'furious')] });
    expect(() => computeEmotionalArc(input)).not.toThrow();
    expect(computeEmotionalArc(input)).toEqual([{ t: 0, emotion: null, intensity: 0 }]);
  });

  it('boosts intensity when a semantic event falls inside the segment window (high tier)', () => {
    const input = baseInput({
      segments: [segment(0, 2, 'neu')],
      semanticEvents: [event('confession', 1)],
    });
    const [result] = computeEmotionalArc(input);
    expect(result.t).toBe(0);
    expect(result.emotion).toBe('neu');
    expect(result.intensity).toBeCloseTo(0.3, 5);
  });

  it('boosts intensity for a medium-tier semantic event', () => {
    const input = baseInput({
      segments: [segment(0, 2, 'neu')],
      semanticEvents: [event('mistake', 1)],
    });
    expect(computeEmotionalArc(input)).toEqual([{ t: 0, emotion: 'neu', intensity: 0.2 }]);
  });

  it('applies no boost for a purely informational semantic event', () => {
    const input = baseInput({
      segments: [segment(0, 2, 'neu')],
      semanticEvents: [event('tutorial', 1)],
    });
    expect(computeEmotionalArc(input)).toEqual([{ t: 0, emotion: 'neu', intensity: 0.1 }]);
  });

  it('takes the max boost among multiple events in one segment, not the sum', () => {
    const input = baseInput({
      segments: [segment(0, 2, 'neu')],
      semanticEvents: [event('tutorial', 0.5), event('confession', 1)],
    });
    // 0.1 base + max(0, 0.2) = 0.3, NOT 0.1 + 0 + 0.2 summed differently or
    // clamped past 0.3.
    const [result] = computeEmotionalArc(input);
    expect(result.t).toBe(0);
    expect(result.emotion).toBe('neu');
    expect(result.intensity).toBeCloseTo(0.3, 5);
  });

  it('ignores a semantic event outside the segment window', () => {
    const input = baseInput({
      segments: [segment(0, 1, 'neu')],
      semanticEvents: [event('confession', 5)],
    });
    expect(computeEmotionalArc(input)).toEqual([{ t: 0, emotion: 'neu', intensity: 0.1 }]);
  });

  it('clamps intensity at 1 even when base + boost would exceed it', () => {
    const input = baseInput({
      segments: [segment(0, 1, 'ang')],
      semanticEvents: [event('confession', 0.5)],
    });
    // 0.85 base + 0.2 boost = 1.05, clamped to 1.
    expect(computeEmotionalArc(input)[0].intensity).toBe(1);
  });

  it('does not throw when semanticEvents is null or empty', () => {
    const withNull = baseInput({ segments: [segment(0, 1, 'hap')], semanticEvents: null });
    const withEmpty = baseInput({ segments: [segment(0, 1, 'hap')], semanticEvents: [] });
    expect(() => computeEmotionalArc(withNull)).not.toThrow();
    expect(() => computeEmotionalArc(withEmpty)).not.toThrow();
    expect(computeEmotionalArc(withNull)).toEqual(computeEmotionalArc(withEmpty));
  });
});
