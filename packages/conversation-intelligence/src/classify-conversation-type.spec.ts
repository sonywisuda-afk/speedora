import { conversationTypeResultSchema } from '@speedora/contracts';
import { classifyConversationType } from './classify-conversation-type';

describe('classifyConversationType', () => {
  it('returns null type/confidence when there is no diarization data at all', () => {
    expect(
      classifyConversationType({
        speakerCount: 0,
        turnCount: 0,
        switchCount: 0,
        averageTurnDurationSeconds: null,
      }),
    ).toEqual({ type: null, confidence: null });
  });

  it('classifies a single speaker as monologue regardless of turn count', () => {
    expect(
      classifyConversationType({
        speakerCount: 1,
        turnCount: 12,
        switchCount: 0,
        averageTurnDurationSeconds: 5,
      }),
    ).toEqual({ type: 'monologue', confidence: 0.9 });
  });

  it('classifies two speakers with long, infrequent turns as podcast', () => {
    expect(
      classifyConversationType({
        speakerCount: 2,
        turnCount: 6,
        switchCount: 5,
        averageTurnDurationSeconds: 45,
      }).type,
    ).toBe('podcast');
  });

  it('classifies two speakers with short, rapidly-alternating turns as interview', () => {
    expect(
      classifyConversationType({
        speakerCount: 2,
        turnCount: 10,
        switchCount: 9, // every turn alternates - ratio 1.0
        averageTurnDurationSeconds: 3,
      }).type,
    ).toBe('interview');
  });

  it('classifies two speakers that fit neither extreme as discussion', () => {
    expect(
      classifyConversationType({
        speakerCount: 2,
        turnCount: 10,
        switchCount: 3, // low alternation, not long-form either
        averageTurnDurationSeconds: 12,
      }).type,
    ).toBe('discussion');
  });

  it('classifies 3+ speakers with high alternation as debate', () => {
    expect(
      classifyConversationType({
        speakerCount: 4,
        turnCount: 20,
        switchCount: 18, // ratio ~0.947
        averageTurnDurationSeconds: 4,
      }).type,
    ).toBe('debate');
  });

  it('classifies 3+ speakers with low alternation (panel-style) as discussion', () => {
    expect(
      classifyConversationType({
        speakerCount: 5,
        turnCount: 15,
        switchCount: 4,
        averageTurnDurationSeconds: 20,
      }).type,
    ).toBe('discussion');
  });

  it('never produces "presentation" (an honest, documented gap - not enough signal to distinguish from monologue)', () => {
    const result = classifyConversationType({
      speakerCount: 1,
      turnCount: 1,
      switchCount: 0,
      averageTurnDurationSeconds: 300,
    });
    expect(result.type).not.toBe('presentation');
  });

  it('treats a single turn (turnCount < 2) as having no alternation signal, not a crash', () => {
    expect(() =>
      classifyConversationType({
        speakerCount: 2,
        turnCount: 1,
        switchCount: 0,
        averageTurnDurationSeconds: 10,
      }),
    ).not.toThrow();
  });

  // Phase C validation gate - exact boundary tests. LONG_TURN_SECONDS (20),
  // SHORT_TURN_SECONDS (8), and HIGH_ALTERNATION_RATIO (0.6) are module-
  // private named constants (see classify-conversation-type.ts) - not
  // imported here, mirrored as literals, same as every other test in this
  // file already does for its own input values.
  describe('classification boundaries', () => {
    it('treats averageTurnDurationSeconds exactly at the long-turn threshold (20) as podcast (>=, inclusive)', () => {
      expect(
        classifyConversationType({
          speakerCount: 2,
          turnCount: 6,
          switchCount: 5,
          averageTurnDurationSeconds: 20,
        }).type,
      ).toBe('podcast');
    });

    it('does NOT classify as podcast just below the long-turn threshold (19.99)', () => {
      expect(
        classifyConversationType({
          speakerCount: 2,
          turnCount: 6,
          switchCount: 5,
          averageTurnDurationSeconds: 19.99,
        }).type,
      ).not.toBe('podcast');
    });

    it('treats averageTurnDurationSeconds exactly at the short-turn threshold (8) as interview-eligible (<=, inclusive)', () => {
      expect(
        classifyConversationType({
          speakerCount: 2,
          turnCount: 10,
          switchCount: 9, // alternation 1.0, above HIGH_ALTERNATION_RATIO
          averageTurnDurationSeconds: 8,
        }).type,
      ).toBe('interview');
    });

    it('does NOT classify as interview just above the short-turn threshold (8.01), even with high alternation', () => {
      expect(
        classifyConversationType({
          speakerCount: 2,
          turnCount: 10,
          switchCount: 9,
          averageTurnDurationSeconds: 8.01,
        }).type,
      ).not.toBe('interview');
    });

    it('treats alternation exactly at the high-alternation threshold (0.6) as debate for 3+ speakers (>=, inclusive)', () => {
      // switchCount 6 / (turnCount 11 - 1) = 0.6 exactly
      expect(
        classifyConversationType({
          speakerCount: 3,
          turnCount: 11,
          switchCount: 6,
          averageTurnDurationSeconds: 5,
        }).type,
      ).toBe('debate');
    });

    it('falls back to discussion just below the high-alternation threshold for 3+ speakers', () => {
      // switchCount 59 / (turnCount 101 - 1) = 0.59, just under 0.6
      expect(
        classifyConversationType({
          speakerCount: 3,
          turnCount: 101,
          switchCount: 59,
          averageTurnDurationSeconds: 5,
        }).type,
      ).toBe('discussion');
    });
  });

  // averageTurnDurationSeconds is nullable on the contract (mean() of an
  // empty duration list) - the classifier must degrade gracefully, not
  // crash or silently misclassify as podcast/interview (both longTurns and
  // shortTurns are explicitly false when null).
  describe('null averageTurnDurationSeconds (duration signal unavailable)', () => {
    it('falls back to discussion for 2 speakers when averageTurnDurationSeconds is null', () => {
      expect(
        classifyConversationType({
          speakerCount: 2,
          turnCount: 5,
          switchCount: 2,
          averageTurnDurationSeconds: null,
        }).type,
      ).toBe('discussion');
    });

    it('falls back to discussion for 3+ speakers when averageTurnDurationSeconds is null, even with high alternation', () => {
      // High alternation alone is enough for debate - null duration doesn't
      // block that path (longTurns/shortTurns are irrelevant to the
      // speakerCount >= 3 branch).
      expect(
        classifyConversationType({
          speakerCount: 4,
          turnCount: 10,
          switchCount: 9,
          averageTurnDurationSeconds: null,
        }).type,
      ).toBe('debate');
    });
  });

  it('is deterministic - the same input produces byte-identical output across repeated calls', () => {
    const input = {
      speakerCount: 3,
      turnCount: 11,
      switchCount: 6,
      averageTurnDurationSeconds: 5,
    };

    const first = classifyConversationType(input);
    const second = classifyConversationType({ ...input });

    expect(second).toEqual(first);
  });

  it('never mutates its input', () => {
    const input = {
      speakerCount: 2,
      turnCount: 10,
      switchCount: 9,
      averageTurnDurationSeconds: 3,
    };
    const snapshot = { ...input };

    classifyConversationType(input);

    expect(input).toEqual(snapshot);
  });

  it('every case in this file conforms to the schema-declared type/confidence ranges', () => {
    const cases = [
      { speakerCount: 0, turnCount: 0, switchCount: 0, averageTurnDurationSeconds: null },
      { speakerCount: 1, turnCount: 5, switchCount: 0, averageTurnDurationSeconds: 12 },
      { speakerCount: 2, turnCount: 6, switchCount: 5, averageTurnDurationSeconds: 20 },
      { speakerCount: 2, turnCount: 10, switchCount: 9, averageTurnDurationSeconds: 8 },
      { speakerCount: 2, turnCount: 10, switchCount: 3, averageTurnDurationSeconds: 12 },
      { speakerCount: 4, turnCount: 20, switchCount: 18, averageTurnDurationSeconds: 4 },
      { speakerCount: 5, turnCount: 15, switchCount: 4, averageTurnDurationSeconds: 20 },
    ];

    for (const input of cases) {
      const result = classifyConversationType(input);
      expect(() => conversationTypeResultSchema.parse(result)).not.toThrow();
    }
  });
});
