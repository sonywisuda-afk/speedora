import type { SpeakerTurn } from '@speedora/contracts';
import { editingSuggestionSchema } from '@speedora/contracts';
import { fromSpeakerTransitions } from './from-speaker-transitions';

describe('fromSpeakerTransitions', () => {
  it('returns an empty array for no turns at all', () => {
    expect(fromSpeakerTransitions([], 30)).toEqual([]);
  });

  it('returns an empty array for a single speaker only (no transition possible)', () => {
    const turns: SpeakerTurn[] = [
      { speaker: 'A', start: 0, end: 3 },
      { speaker: 'A', start: 3, end: 6 },
      { speaker: 'A', start: 6, end: 9 },
    ];
    expect(fromSpeakerTransitions(turns, 9)).toEqual([]);
  });

  it('fires speaker_focus_shift for a well-held two-speaker transition', () => {
    const turns: SpeakerTurn[] = [
      { speaker: 'A', start: 0, end: 3 },
      { speaker: 'B', start: 3, end: 6 },
    ];
    const result = fromSpeakerTransitions(turns, 6);

    expect(result).toHaveLength(1);
    expect(result[0].technique).toBe('speaker_focus_shift');
    expect(result[0].start).toBeCloseTo(2.85);
    expect(result[0].end).toBeCloseTo(3.15);
  });

  // The exact "false positive" scenario the user's own brief called out:
  // rapid speaker alternation, every turn barely under the hold floor -
  // must produce ZERO suggestions, not one per switch.
  it('produces no suggestions for a rapid-fire exchange where every turn is too short to be deliberate', () => {
    // 10 turns, alternating every 0.4s - well under MIN_SPEAKER_HOLD_SECONDS (1.0).
    const turns: SpeakerTurn[] = Array.from({ length: 10 }, (_, i) => ({
      speaker: i % 2 === 0 ? 'A' : 'B',
      start: i * 0.4,
      end: i * 0.4 + 0.4,
    }));
    expect(fromSpeakerTransitions(turns, 4)).toEqual([]);
  });

  describe('MIN_SPEAKER_HOLD_SECONDS gate', () => {
    it('rejects a transition when the OUTGOING turn is too short, even if the incoming one is long', () => {
      const turns: SpeakerTurn[] = [
        { speaker: 'A', start: 0, end: 0.5 }, // outgoing hold 0.5s - below floor
        { speaker: 'B', start: 0.5, end: 5 },
      ];
      expect(fromSpeakerTransitions(turns, 5)).toEqual([]);
    });

    it('rejects a transition when the INCOMING turn is too short, even if the outgoing one is long', () => {
      const turns: SpeakerTurn[] = [
        { speaker: 'A', start: 0, end: 4 },
        { speaker: 'B', start: 4, end: 4.5 }, // incoming hold 0.5s - below floor
      ];
      expect(fromSpeakerTransitions(turns, 5)).toEqual([]);
    });

    // A hold exactly at the floor (1.0s/1.0s) clears the HOLD gate but
    // still fails the separate CONFIDENCE gate (min(1,1)/3.0 = 0.333,
    // below MIN_TRANSITION_CONFIDENCE's 0.5 floor even at zero
    // interactionIntensity) - the two gates are independent, and hitting
    // one alone is never sufficient. See the "accepts a transition once
    // both the hold floor AND confidence gate clear" test below for the
    // hold value that genuinely clears both.
    it('still rejects a transition exactly at the hold floor (1.0s) - hold alone is not sufficient, confidence gate also applies', () => {
      const turns: SpeakerTurn[] = [
        { speaker: 'A', start: 0, end: 1.0 },
        { speaker: 'B', start: 1.0, end: 2.0 },
      ];
      expect(fromSpeakerTransitions(turns, 2)).toEqual([]);
    });

    it('accepts a transition once both the hold floor and confidence gate clear (2.5s hold on both sides, in a calm clip)', () => {
      const turns: SpeakerTurn[] = [
        { speaker: 'A', start: 0, end: 2.5 },
        { speaker: 'B', start: 2.5, end: 5.0 },
      ];
      // A long clipDurationSeconds keeps turnDensityPerMinute's own
      // contribution to interactionIntensity low, isolating this test from
      // the adaptive-damper describe block below.
      expect(fromSpeakerTransitions(turns, 120)).toHaveLength(1);
    });

    it('rejects a transition just below the hold floor (0.99s)', () => {
      const turns: SpeakerTurn[] = [
        { speaker: 'A', start: 0, end: 0.99 },
        { speaker: 'B', start: 0.99, end: 2.0 },
      ];
      expect(fromSpeakerTransitions(turns, 2)).toEqual([]);
    });
  });

  describe('same-speaker turn splits (not a real transition)', () => {
    it('never fires across two consecutive same-speaker segments, regardless of hold duration', () => {
      const turns: SpeakerTurn[] = [
        { speaker: 'A', start: 0, end: 3 },
        { speaker: 'A', start: 3, end: 6 }, // same speaker - a turn split, not a switch
      ];
      expect(fromSpeakerTransitions(turns, 6)).toEqual([]);
    });
  });

  describe('adaptive confidence damper (interactionIntensity)', () => {
    // The exact same locally-confident transition (outgoing hold 1.8s,
    // incoming hold 1.8s -> confidence = min(1.8, 1.8) / 3.0 = 0.6) is
    // accepted at the end of a CALM clip (a few long same-speaker holds,
    // one real switch - low backAndForthScore/turnDensity keeps
    // interactionIntensity low, so the effective threshold stays close to
    // the 0.5 base) but rejected at the end of a DENSE clip (many short,
    // fully-alternating turns - high backAndForthScore AND turnDensity
    // push interactionIntensity toward 0.8, raising the effective
    // threshold to ~0.74, above this transition's own 0.6). This is the
    // user's own explicit concern - a podcast/interview's rapid
    // back-and-forth must not trigger the SAME per-transition confidence
    // that would trigger cleanly in a calmer clip.
    it('accepts a 0.6-confidence transition in a calm clip but rejects the identical local hold shape in a rapid-exchange clip', () => {
      const calmTurns: SpeakerTurn[] = [
        { speaker: 'A', start: 0, end: 30 },
        { speaker: 'A', start: 30, end: 60 },
        { speaker: 'A', start: 60, end: 90 },
        { speaker: 'A', start: 90, end: 120 }, // outgoing hold for the transition below: 30s
        { speaker: 'B', start: 120, end: 121.8 }, // incoming hold: 1.8s -> confidence 0.6
      ];
      expect(fromSpeakerTransitions(calmTurns, 121.8)).toHaveLength(1);

      const denseTurns: SpeakerTurn[] = [];
      let t = 0;
      for (let i = 0; i < 39; i++) {
        denseTurns.push({ speaker: i % 2 === 0 ? 'A' : 'B', start: t, end: t + 1.2 });
        t += 1.2;
      }
      // The final 2 turns match the calm fixture's own target transition
      // shape exactly (1.8s/1.8s, confidence 0.6) - only the surrounding
      // clip-level context (39 rapid, fully-alternating 1.2s turns before
      // it) differs.
      const lastSpeaker = denseTurns[denseTurns.length - 1].speaker;
      denseTurns.push({ speaker: lastSpeaker === 'A' ? 'B' : 'A', start: t, end: t + 1.8 });
      t += 1.8;
      const secondLastSpeaker = denseTurns[denseTurns.length - 1].speaker;
      denseTurns.push({ speaker: secondLastSpeaker === 'A' ? 'B' : 'A', start: t, end: t + 1.8 });
      t += 1.8;

      expect(fromSpeakerTransitions(denseTurns, t)).toEqual([]);
    });
  });

  describe('MIN_SUGGESTION_GAP_SECONDS cooldown (anti-clustering)', () => {
    it('suppresses a second otherwise-qualifying transition too close to the first accepted one', () => {
      const turns: SpeakerTurn[] = [
        { speaker: 'A', start: 0, end: 3 },
        { speaker: 'B', start: 3, end: 6 }, // transition #1 at t=3, accepted
        { speaker: 'A', start: 6, end: 8 }, // transition #2 at t=6 - only 3s after #1's end (< 4s cooldown)
      ];
      const result = fromSpeakerTransitions(turns, 8);
      expect(result).toHaveLength(1);
    });

    it('allows a second transition once the cooldown window has elapsed', () => {
      const turns: SpeakerTurn[] = [
        { speaker: 'A', start: 0, end: 3 },
        { speaker: 'B', start: 3, end: 6 }, // transition #1 at t=3
        { speaker: 'A', start: 6, end: 12 }, // long gap
        { speaker: 'B', start: 12, end: 15 }, // transition #2 at t=12, well past cooldown
      ];
      const result = fromSpeakerTransitions(turns, 15);
      expect(result).toHaveLength(2);
    });
  });

  it('is deterministic - the same input produces byte-identical output across repeated calls', () => {
    const turns: SpeakerTurn[] = [
      { speaker: 'A', start: 0, end: 3 },
      { speaker: 'B', start: 3, end: 6 },
      { speaker: 'A', start: 10, end: 13 },
    ];
    const first = fromSpeakerTransitions(turns, 15);
    const second = fromSpeakerTransitions(structuredClone(turns), 15);
    expect(second).toEqual(first);
  });

  it('never mutates the source SpeakerTurn[]', () => {
    const turns: SpeakerTurn[] = [
      { speaker: 'A', start: 0, end: 3 },
      { speaker: 'B', start: 3, end: 6 },
    ];
    const snapshot = structuredClone(turns);

    fromSpeakerTransitions(turns, 6);

    expect(turns).toEqual(snapshot);
  });

  it('every produced suggestion conforms to the schema-declared EditingSuggestion shape', () => {
    const turns: SpeakerTurn[] = [
      { speaker: 'A', start: 0, end: 3 },
      { speaker: 'B', start: 3, end: 6 },
      { speaker: 'A', start: 10, end: 13 },
    ];
    const result = fromSpeakerTransitions(turns, 15);
    expect(result.length).toBeGreaterThan(0);
    for (const suggestion of result) {
      expect(() => editingSuggestionSchema.parse(suggestion)).not.toThrow();
      expect(suggestion.technique).toBe('speaker_focus_shift');
    }
  });

  it('clamps confidence/score to [0, 1] even for an extremely long, well-held transition', () => {
    const turns: SpeakerTurn[] = [
      { speaker: 'A', start: 0, end: 100 },
      { speaker: 'B', start: 100, end: 200 },
    ];
    const result = fromSpeakerTransitions(turns, 200);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBeLessThanOrEqual(1);
    expect(result[0].score).toBeGreaterThanOrEqual(0);
  });
});
