import type { ComposeFinalSpeakerIntelligenceInput } from '@speedora/contracts';
import { finalSpeakerIntelligenceSchema } from '@speedora/contracts';
import { composeFinalSpeakerIntelligence } from './compose-final-speaker-intelligence';

function baseInput(
  overrides: Partial<ComposeFinalSpeakerIntelligenceInput> = {},
): ComposeFinalSpeakerIntelligenceInput {
  return {
    clipId: 'clip-1',
    conversationDynamics: null,
    conversationType: null,
    speakerFusionFeatures: null,
    speakerFocusShiftScores: [],
    ...overrides,
  };
}

const dynamics = (
  overrides: Partial<ComposeFinalSpeakerIntelligenceInput['conversationDynamics']> = {},
) => ({
  turnDensityPerMinute: 10,
  backAndForthScore: 0.5,
  responseLatencySeconds: 1,
  overlapRatio: 0,
  ...overrides,
});

const speakerFeatures = (
  overrides: Partial<ComposeFinalSpeakerIntelligenceInput['speakerFusionFeatures']> = {},
) => ({
  dominantSpeakerConfidence: 0.7,
  dominantSpeakerEngagement: 0.6,
  dominantSpeakerImportance: 0.8,
  averageSpeakerHighlightScore: 0.5,
  ...overrides,
});

describe('composeFinalSpeakerIntelligence', () => {
  describe('null semantics', () => {
    it('reports conversation: null when conversationDynamics is null, even if conversationType is present', () => {
      const result = composeFinalSpeakerIntelligence(
        baseInput({ conversationDynamics: null, conversationType: { type: 'discussion' } }),
      );
      expect(result.conversation).toBeNull();
    });

    it('reports conversation: null when conversationType is null, even if conversationDynamics is present', () => {
      const result = composeFinalSpeakerIntelligence(
        baseInput({ conversationDynamics: dynamics(), conversationType: null }),
      );
      expect(result.conversation).toBeNull();
    });

    it('reports a real conversation object when both inputs are present, preserving per-field nulls', () => {
      const result = composeFinalSpeakerIntelligence(
        baseInput({
          conversationDynamics: dynamics({ backAndForthScore: null, responseLatencySeconds: null }),
          conversationType: { type: null },
        }),
      );
      expect(result.conversation).toEqual({
        type: null,
        turnDensity: 10,
        backAndForthScore: null,
        responseLatency: null,
        overlapRatio: 0,
      });
    });

    it('reports speaker: null when speakerFusionFeatures is null', () => {
      const result = composeFinalSpeakerIntelligence(baseInput({ speakerFusionFeatures: null }));
      expect(result.speaker).toBeNull();
    });

    it('reports a real speaker object when speakerFusionFeatures is present, preserving per-field nulls', () => {
      const result = composeFinalSpeakerIntelligence(
        baseInput({
          speakerFusionFeatures: speakerFeatures({ dominantSpeakerConfidence: null }),
        }),
      );
      expect(result.speaker).toEqual({
        confidence: null,
        engagement: 0.6,
        importance: 0.8,
        highlight: 0.5,
      });
    });

    it('never reports visual: null - always a real object, even with zero suggestions', () => {
      const result = composeFinalSpeakerIntelligence(baseInput({ speakerFocusShiftScores: [] }));
      expect(result.visual).toEqual({ speakerFocusShift: { count: 0, averageConfidence: null } });
    });

    it('averages speakerFocusShiftScores when present', () => {
      const result = composeFinalSpeakerIntelligence(
        baseInput({ speakerFocusShiftScores: [0.6, 0.8, 1.0] }),
      );
      expect(result.visual.speakerFocusShift.count).toBe(3);
      expect(result.visual.speakerFocusShift.averageConfidence).toBeCloseTo(0.8);
    });
  });

  // No top-level composite score, and no cross-branch contamination - the
  // core anti-double-counting guarantee this function provides BY
  // CONSTRUCTION (conversation/speaker are computed with zero reference to
  // speakerFocusShiftScores, not merely filtered to exclude it).
  describe('structural independence (no double-counting by construction)', () => {
    it('conversation and speaker are byte-identical regardless of how many speakerFocusShiftScores are present', () => {
      const withNoVisual = composeFinalSpeakerIntelligence(
        baseInput({
          conversationDynamics: dynamics(),
          conversationType: { type: 'interview' },
          speakerFusionFeatures: speakerFeatures(),
          speakerFocusShiftScores: [],
        }),
      );
      const withHeavyVisual = composeFinalSpeakerIntelligence(
        baseInput({
          conversationDynamics: dynamics(),
          conversationType: { type: 'interview' },
          speakerFusionFeatures: speakerFeatures(),
          speakerFocusShiftScores: [0.9, 0.95, 1.0, 0.85, 0.9],
        }),
      );

      expect(withHeavyVisual.conversation).toEqual(withNoVisual.conversation);
      expect(withHeavyVisual.speaker).toEqual(withNoVisual.speaker);
      // Only the visual branch differs.
      expect(withHeavyVisual.visual).not.toEqual(withNoVisual.visual);
    });

    it('the output has no top-level composite score field at all', () => {
      const result = composeFinalSpeakerIntelligence(
        baseInput({
          conversationDynamics: dynamics(),
          conversationType: { type: 'debate' },
          speakerFusionFeatures: speakerFeatures(),
          speakerFocusShiftScores: [0.9],
        }),
      );
      expect(Object.keys(result).sort()).toEqual(['clipId', 'conversation', 'speaker', 'visual']);
    });
  });

  // The 7 adversarial scenarios named in the Phase F brief - the goal is
  // proving this composition does NOT overreact, not merely that it runs.
  // Each fixture is constructed to match what the real upstream
  // Phase C/E gates would actually produce for that real-world situation
  // (per those phases' own already-verified test suites), not invented ad
  // hoc.
  describe('adversarial scenarios', () => {
    it('single-speaker monologue: conversation reflects the type honestly, visual stays at zero (Phase E already excludes monologues, not re-suppressed here)', () => {
      const result = composeFinalSpeakerIntelligence(
        baseInput({
          conversationDynamics: dynamics({ backAndForthScore: null, responseLatencySeconds: null }),
          conversationType: { type: 'monologue' },
          speakerFusionFeatures: speakerFeatures(),
          speakerFocusShiftScores: [], // Phase E's own gate already excludes monologues
        }),
      );
      expect(result.conversation?.type).toBe('monologue');
      expect(result.conversation?.backAndForthScore).toBeNull();
      expect(result.visual.speakerFocusShift).toEqual({ count: 0, averageConfidence: null });
      // Speaker quality signals are unaffected by conversation type - a
      // monologue is never penalized here either, same non-penalization
      // principle Phase D already established one level down.
      expect(result.speaker).not.toBeNull();
    });

    it('rapid back-and-forth: conversation honestly reports high activity, but visual stays at zero because Phase E already rejected every transition on confidence grounds', () => {
      const result = composeFinalSpeakerIntelligence(
        baseInput({
          conversationDynamics: dynamics({ turnDensityPerMinute: 48, backAndForthScore: 1 }),
          conversationType: { type: 'interview' },
          speakerFusionFeatures: speakerFeatures(),
          // Phase E's own adaptive confidence damper rejects every
          // transition in a genuinely rapid-exchange clip - see
          // from-speaker-transitions.spec.ts's own verified fixture.
          speakerFocusShiftScores: [],
        }),
      );
      // conversation must NOT be suppressed just because it's "busy" - the
      // real, high activity is honestly reported.
      expect(result.conversation?.turnDensity).toBe(48);
      expect(result.conversation?.backAndForthScore).toBe(1);
      // visual must NOT be inflated just because conversation looks
      // active - it reflects only what Phase E actually accepted.
      expect(result.visual.speakerFocusShift.count).toBe(0);
    });

    it('long interview answer: few transitions, low turn density, but a real accepted visual response for the one genuine transition', () => {
      const result = composeFinalSpeakerIntelligence(
        baseInput({
          conversationDynamics: dynamics({
            turnDensityPerMinute: 1.5,
            backAndForthScore: 0.5,
            responseLatencySeconds: 0.5,
          }),
          conversationType: { type: 'interview' },
          speakerFusionFeatures: speakerFeatures(),
          speakerFocusShiftScores: [0.85],
        }),
      );
      expect(result.conversation?.turnDensity).toBe(1.5);
      expect(result.visual.speakerFocusShift).toEqual({ count: 1, averageConfidence: 0.85 });
    });

    it('two speakers + strong visual event: a high-confidence visual response does not inflate conversation or speaker', () => {
      const withoutEvent = composeFinalSpeakerIntelligence(
        baseInput({
          conversationDynamics: dynamics(),
          conversationType: { type: 'discussion' },
          speakerFusionFeatures: speakerFeatures(),
          speakerFocusShiftScores: [],
        }),
      );
      const withStrongEvent = composeFinalSpeakerIntelligence(
        baseInput({
          conversationDynamics: dynamics(),
          conversationType: { type: 'discussion' },
          speakerFusionFeatures: speakerFeatures(),
          speakerFocusShiftScores: [1.0],
        }),
      );
      expect(withStrongEvent.conversation).toEqual(withoutEvent.conversation);
      expect(withStrongEvent.speaker).toEqual(withoutEvent.speaker);
      expect(withStrongEvent.visual.speakerFocusShift).toEqual({
        count: 1,
        averageConfidence: 1.0,
      });
    });

    it('speaker transition + silence (a long response latency): the real latency is reported honestly, not zeroed or nulled', () => {
      const result = composeFinalSpeakerIntelligence(
        baseInput({
          conversationDynamics: dynamics({ responseLatencySeconds: 6.2 }),
          conversationType: { type: 'discussion' },
          speakerFusionFeatures: speakerFeatures(),
          speakerFocusShiftScores: [0.6],
        }),
      );
      expect(result.conversation?.responseLatency).toBe(6.2);
    });

    // Scenarios 6 ("speaker transition + face change") and 7 ("speaker
    // transition + existing focus shift") are about the RENDER-GRAPH
    // NODE's own filtering (only technique === 'speaker_focus_shift'
    // scores reach this function's speakerFocusShiftScores input, never
    // plain 'focus_shift' ones) - verified at the render-clip.worker.spec.ts
    // integration level (see "Speaker Intelligence Phase F" describe
    // block there), not here, since this function's own input contract
    // already assumes pre-filtered scores (see the contract's own
    // comment). This package-level test instead confirms the function
    // itself has no way to conflate them even if asked to: it only ever
    // reads `speakerFocusShiftScores` as a flat number array with no
    // technique discriminator at all.
    it('has no technique-discrimination logic of its own - the input contract itself has no way to represent a non-speaker-sourced score', () => {
      const result = composeFinalSpeakerIntelligence(
        baseInput({ speakerFocusShiftScores: [0.5, 0.5, 0.5] }),
      );
      expect(result.visual.speakerFocusShift.count).toBe(3);
    });
  });

  it('is deterministic - the same input produces byte-identical output across repeated calls', () => {
    const input = baseInput({
      conversationDynamics: dynamics(),
      conversationType: { type: 'podcast' },
      speakerFusionFeatures: speakerFeatures(),
      speakerFocusShiftScores: [0.7, 0.8],
    });
    const first = composeFinalSpeakerIntelligence(input);
    const second = composeFinalSpeakerIntelligence(structuredClone(input));
    expect(second).toEqual(first);
  });

  it('never mutates the source input', () => {
    const input = baseInput({
      conversationDynamics: dynamics(),
      conversationType: { type: 'podcast' },
      speakerFusionFeatures: speakerFeatures(),
      speakerFocusShiftScores: [0.7, 0.8],
    });
    const snapshot = structuredClone(input);

    composeFinalSpeakerIntelligence(input);

    expect(input).toEqual(snapshot);
  });

  it('conforms to the schema-declared shape', () => {
    const result = composeFinalSpeakerIntelligence(
      baseInput({
        conversationDynamics: dynamics(),
        conversationType: { type: 'debate' },
        speakerFusionFeatures: speakerFeatures(),
        speakerFocusShiftScores: [0.7],
      }),
    );
    expect(() => finalSpeakerIntelligenceSchema.parse(result)).not.toThrow();

    const emptyResult = composeFinalSpeakerIntelligence(baseInput());
    expect(() => finalSpeakerIntelligenceSchema.parse(emptyResult)).not.toThrow();
  });
});
