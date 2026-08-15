import type { NarrativeGraph, NarrativeSegment } from '@speedora/contracts';
import { nudgeCandidateBoundary } from './nudge-boundaries';

function segment(overrides: Partial<NarrativeSegment>): NarrativeSegment {
  return {
    id: 0,
    type: 'setup',
    startTime: 0,
    endTime: 1,
    confidence: 0.9,
    reason: 'test fixture',
    ...overrides,
  };
}

function graph(segments: NarrativeSegment[]): NarrativeGraph {
  return { segments, relations: [], unsegmented: false };
}

describe('nudgeCandidateBoundary', () => {
  it('returns null when neither lexical nor structural signal fires', () => {
    const result = nudgeCandidateBoundary(
      graph([
        segment({ type: 'setup' }),
        segment({ id: 1, type: 'resolution', startTime: 20, endTime: 30 }),
      ]),
      'Here is a complete opening sentence.',
      'And that is how it all ended.',
      100,
      130,
    );
    expect(result).toBeNull();
  });

  it('suggests expanding the start when the opening looks mid-sentence and lacks a setup segment', () => {
    const result = nudgeCandidateBoundary(
      graph([segment({ type: 'conflict' })]),
      'and that is when everything changed for us',
      'so we finally figured it out.',
      100,
      130,
    );
    expect(result).not.toBeNull();
    expect(result?.applied).toBe(true);
    expect(result?.suggestedStartTime).toBeLessThan(100);
    expect(result?.suggestedEndTime).toBe(130);
  });

  it('suggests expanding the end when the closing looks mid-sentence and lacks a payoff segment', () => {
    const result = nudgeCandidateBoundary(
      graph([segment({ type: 'setup' })]),
      'Here is a complete opening sentence.',
      'and then everything just kept going without',
      100,
      130,
    );
    expect(result).not.toBeNull();
    expect(result?.applied).toBe(true);
    expect(result?.suggestedEndTime).toBeGreaterThan(130);
    expect(result?.suggestedStartTime).toBe(100);
  });

  it('does not apply when the nudge would exceed the max expansion bound', () => {
    const result = nudgeCandidateBoundary(
      graph([segment({ type: 'conflict' })]),
      'and that is when everything changed for us',
      'so we finally figured it out.',
      100,
      130,
      1, // smaller than the 3s heuristic nudge
    );
    expect(result).not.toBeNull();
    expect(result?.applied).toBe(false);
    expect(result?.suggestedStartTime).toBe(100);
  });

  it('never shrinks a candidate', () => {
    const result = nudgeCandidateBoundary(
      graph([segment({ type: 'setup' })]),
      'Here is a complete opening sentence.',
      'and it kept going',
      100,
      130,
    );
    expect(result?.suggestedStartTime).toBeGreaterThanOrEqual(100);
    expect(result?.suggestedEndTime).toBeGreaterThanOrEqual(130);
  });
});
