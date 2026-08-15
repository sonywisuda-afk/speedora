import type { QualityDimensionScore } from '@speedora/contracts';

export interface DeriveAudioQualityInput {
  // EditorialDecision.categories.speakerClarity (render mode) - null for monologue clips
  // (speakerCount <= 1, a real "not applicable" result, not a low score) or when EditorialDecision
  // was never computed. Measures conversational turn-taking overlap, not perceptual audio quality
  // (noise floor/clipping/loudness normalization) - see this dimension's own 'proxy' basis below.
  speakerClarity: number | null;
}

// No real audio-quality detector exists anywhere in this codebase - confirmed by the Phase C1
// audit. Per-segment rmsDb is explicitly documented elsewhere in this codebase as "not comparable
// across recordings," so it isn't used here either. This is an honest, explicitly-labeled PROXY,
// not a substitute.
export function deriveAudioQuality(input: DeriveAudioQualityInput): QualityDimensionScore {
  if (input.speakerClarity == null) {
    return {
      score: null,
      basis: 'unavailable',
      notes:
        'speakerClarity is null (a monologue clip, or render-mode EditorialDecision was never ' +
        'computed) - no other audio-quality proxy exists.',
    };
  }

  return {
    score: input.speakerClarity,
    basis: 'proxy',
    notes:
      'PROXY ONLY - derived from speakerClarity (conversational turn-taking overlap), which does ' +
      'NOT measure perceptual audio quality. No real audio-quality detector exists yet - see ' +
      'docs/ai/render-quality-judge.md.',
  };
}
