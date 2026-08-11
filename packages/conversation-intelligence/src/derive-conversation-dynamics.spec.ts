import type { DiarizationFeatures } from '@speedora/contracts';
import { deriveConversationDynamics } from './derive-conversation-dynamics';

function features(overrides: Partial<DiarizationFeatures> = {}): DiarizationFeatures {
  return {
    speakerCount: 0,
    segments: [],
    speakerDurationsSeconds: {},
    turnCount: 0,
    switchCount: 0,
    overlappingSpeech: [],
    silences: [],
    ...overrides,
  };
}

describe('deriveConversationDynamics', () => {
  it('returns real zeros (not fabricated) when there are no turns at all', () => {
    const result = deriveConversationDynamics(features(), 30);

    expect(result).toEqual({
      speakerCount: 0,
      turnCount: 0,
      switchCount: 0,
      turnDensityPerMinute: 0,
      averageTurnDurationSeconds: null,
      medianTurnDurationSeconds: null,
      backAndForthScore: null,
      responseLatencySeconds: null,
      overlapRatio: 0,
      interactionIntensity: 0,
    });
  });

  it('handles a single-turn long monologue: no alternation/response-latency signal, but real turn stats', () => {
    const result = deriveConversationDynamics(
      features({
        speakerCount: 1,
        segments: [{ speaker: 'Speaker A', start: 0, end: 60, durationSeconds: 60 }],
        turnCount: 1,
        switchCount: 0,
      }),
      60,
    );

    expect(result.turnCount).toBe(1);
    expect(result.averageTurnDurationSeconds).toBe(60);
    expect(result.medianTurnDurationSeconds).toBe(60);
    // Undefined (0/0), not zero - there's no "alternation" to measure with one turn.
    expect(result.backAndForthScore).toBeNull();
    expect(result.responseLatencySeconds).toBeNull();
    expect(result.overlapRatio).toBe(0);
  });

  it('computes a high backAndForthScore and low responseLatency for rapid 2-speaker alternation', () => {
    // 4 turns, perfectly alternating, back-to-back (no gap).
    const segments = [
      { speaker: 'Speaker A', start: 0, end: 2, durationSeconds: 2 },
      { speaker: 'Speaker B', start: 2, end: 4, durationSeconds: 2 },
      { speaker: 'Speaker A', start: 4, end: 6, durationSeconds: 2 },
      { speaker: 'Speaker B', start: 6, end: 8, durationSeconds: 2 },
    ];
    const result = deriveConversationDynamics(
      features({ speakerCount: 2, segments, turnCount: 4, switchCount: 3 }),
      8,
    );

    expect(result.backAndForthScore).toBe(1); // switchCount 3 / (turnCount 4 - 1) = 1
    expect(result.responseLatencySeconds).toBe(0); // back-to-back, zero gap
    expect(result.turnDensityPerMinute).toBe(30); // 4 turns / (8s / 60)
  });

  it('computes a low backAndForthScore when one speaker dominates across many same-speaker turns', () => {
    const segments = [
      { speaker: 'Speaker A', start: 0, end: 2, durationSeconds: 2 },
      { speaker: 'Speaker A', start: 2, end: 4, durationSeconds: 2 },
      { speaker: 'Speaker A', start: 4, end: 6, durationSeconds: 2 },
      { speaker: 'Speaker B', start: 6, end: 8, durationSeconds: 2 },
    ];
    const result = deriveConversationDynamics(
      features({ speakerCount: 2, segments, turnCount: 4, switchCount: 1 }),
      8,
    );

    expect(result.backAndForthScore).toBeCloseTo(1 / 3);
  });

  it('averages only the gaps that follow a real speaker CHANGE, ignoring same-speaker turn splits', () => {
    const segments = [
      { speaker: 'Speaker A', start: 0, end: 2, durationSeconds: 2 },
      { speaker: 'Speaker A', start: 2.5, end: 4, durationSeconds: 1.5 }, // same speaker, 0.5s gap - not counted
      { speaker: 'Speaker B', start: 6, end: 8, durationSeconds: 2 }, // different speaker, 2s gap - counted
    ];
    const result = deriveConversationDynamics(
      features({ speakerCount: 2, segments, turnCount: 3, switchCount: 1 }),
      8,
    );

    expect(result.responseLatencySeconds).toBe(2);
  });

  it('clamps a negative gap (overlapping turns) to zero latency rather than a negative number', () => {
    const segments = [
      { speaker: 'Speaker A', start: 0, end: 5, durationSeconds: 5 },
      { speaker: 'Speaker B', start: 4, end: 8, durationSeconds: 4 }, // starts before A ends
    ];
    const result = deriveConversationDynamics(
      features({ speakerCount: 2, segments, turnCount: 2, switchCount: 1 }),
      8,
    );

    expect(result.responseLatencySeconds).toBe(0);
  });

  it('computes overlapRatio from merged overlap intervals, not double-counted for 3-way overlap', () => {
    // Two OverlappingSpeechInterval entries covering the SAME [4,6) window
    // (as pairwise overlap detection would report for a 3-way overlap) -
    // must merge to 2s of overlap, not sum to 4s.
    const result = deriveConversationDynamics(
      features({
        speakerCount: 3,
        segments: [
          { speaker: 'A', start: 0, end: 6, durationSeconds: 6 },
          { speaker: 'B', start: 4, end: 8, durationSeconds: 4 },
          { speaker: 'C', start: 4, end: 6, durationSeconds: 2 },
        ],
        turnCount: 3,
        switchCount: 2,
        overlappingSpeech: [
          { start: 4, end: 6, speakers: ['A', 'B'] },
          { start: 4, end: 6, speakers: ['A', 'C'] },
        ],
      }),
      10,
    );

    expect(result.overlapRatio).toBeCloseTo(0.2); // 2s / 10s, not 4s / 10s
  });

  it('produces a real interactionIntensity between 0 and 1, driven up by density/alternation/overlap', () => {
    const highInteraction = deriveConversationDynamics(
      features({
        speakerCount: 2,
        segments: Array.from({ length: 20 }, (_, i) => ({
          speaker: i % 2 === 0 ? 'A' : 'B',
          start: i * 2,
          end: i * 2 + 2,
          durationSeconds: 2,
        })),
        turnCount: 20,
        switchCount: 19,
        overlappingSpeech: [{ start: 0, end: 2, speakers: ['A', 'B'] }],
      }),
      40,
    );
    const lowInteraction = deriveConversationDynamics(
      features({
        speakerCount: 1,
        segments: [{ speaker: 'A', start: 0, end: 40, durationSeconds: 40 }],
        turnCount: 1,
        switchCount: 0,
      }),
      40,
    );

    expect(highInteraction.interactionIntensity).toBeGreaterThan(
      lowInteraction.interactionIntensity,
    );
    expect(highInteraction.interactionIntensity).toBeLessThanOrEqual(1);
    // A single continuous turn still has SOME turn density (1 turn over
    // 40s is a real, nonzero rate) - not literally 0, but much closer to 0
    // than a rapidly-alternating multi-speaker clip's score.
    expect(lowInteraction.interactionIntensity).toBeLessThan(0.1);
  });

  it('computes median duration correctly for both even and odd turn counts', () => {
    const odd = deriveConversationDynamics(
      features({
        segments: [
          { speaker: 'A', start: 0, end: 1, durationSeconds: 1 },
          { speaker: 'B', start: 1, end: 6, durationSeconds: 5 },
          { speaker: 'A', start: 6, end: 9, durationSeconds: 3 },
        ],
        turnCount: 3,
        switchCount: 2,
      }),
      9,
    );
    expect(odd.medianTurnDurationSeconds).toBe(3);

    const even = deriveConversationDynamics(
      features({
        segments: [
          { speaker: 'A', start: 0, end: 1, durationSeconds: 1 },
          { speaker: 'B', start: 1, end: 6, durationSeconds: 5 },
          { speaker: 'A', start: 6, end: 9, durationSeconds: 3 },
          { speaker: 'B', start: 9, end: 10, durationSeconds: 1 },
        ],
        turnCount: 4,
        switchCount: 3,
      }),
      10,
    );
    expect(even.medianTurnDurationSeconds).toBe(2); // median of [1,1,3,5] = (1+3)/2
  });
});
