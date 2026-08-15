import type { QualityDimensionScore } from '@speedora/contracts';

// No caption-quality detector (readability/line-length/sync accuracy) exists anywhere in this
// codebase, compounded by a confirmed total absence of any transcript-to-audio alignment mechanism
// - no ASR confidence field anywhere, and Lip Sync Verification checks mouth-movement-vs-audio-
// energy TIMING, not text accuracy (confirmed by the Phase C1 audit). Takes no input - there is
// nothing to compose from. An honest, permanent gap for this phase, not a fabricated score.
export function deriveCaptionQuality(): QualityDimensionScore {
  return {
    score: null,
    basis: 'unavailable',
    notes:
      'No caption-quality detector exists anywhere in this codebase, and no transcript-to-audio ' +
      'alignment mechanism exists to even partially seed one - a confirmed, honest gap. See ' +
      'docs/ai/render-quality-judge.md.',
  };
}
