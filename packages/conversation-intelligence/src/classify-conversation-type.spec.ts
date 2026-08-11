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
});
