import type { ConversationDynamics, ConversationTypeResult } from '@speedora/contracts';
import { deriveSpeakerClarityScore } from './derive-speaker-clarity';

const DYNAMICS: ConversationDynamics = {
  speakerCount: 2,
  turnCount: 10,
  switchCount: 8,
  turnDensityPerMinute: 20,
  averageTurnDurationSeconds: 3,
  medianTurnDurationSeconds: 3,
  backAndForthScore: 0.8,
  responseLatencySeconds: 0.5,
  overlapRatio: 0.1,
  interactionIntensity: 0.7,
};

describe('deriveSpeakerClarityScore', () => {
  it('returns null when either input is null', () => {
    expect(deriveSpeakerClarityScore(null, null)).toBeNull();
    expect(deriveSpeakerClarityScore(DYNAMICS, null)).toBeNull();
  });

  it('returns null for monologue - not a low score', () => {
    const classification: ConversationTypeResult = { type: 'monologue', confidence: 0.9 };
    expect(deriveSpeakerClarityScore(DYNAMICS, classification)).toBeNull();
  });

  it('returns null when type could not be classified at all', () => {
    const classification: ConversationTypeResult = { type: null, confidence: null };
    expect(deriveSpeakerClarityScore(DYNAMICS, classification)).toBeNull();
  });

  it('scores lower overlap as clearer for a real multi-speaker type', () => {
    const classification: ConversationTypeResult = { type: 'interview', confidence: 0.8 };
    const clear = deriveSpeakerClarityScore({ ...DYNAMICS, overlapRatio: 0 }, classification);
    const muddy = deriveSpeakerClarityScore({ ...DYNAMICS, overlapRatio: 0.6 }, classification);
    expect(clear).toBe(100);
    expect(muddy).toBeLessThan(clear!);
  });
});
