import { KEYWORD_PATTERN, type TranscriptWordInput } from '@speedora/contracts';

// Reuses the exact same heuristic @speedora/subtitles' highlightKeywords()
// already burns in live at render time (numbers/percentages, ALL-CAPS-as-
// transcribed words, quoted phrases) - now computed once here, at rewrite
// time, instead of per-render. Returns INDICES into `words`, not the words
// themselves, so a consumer (Phase A2's buildAss() extension) can restyle
// without re-deriving which words are "special".
//
// Deliberately does NOT decide casing (uppercase-transform) here - that is
// a rendering-time concern, and uppercase has no meaning for non-Latin
// scripts (ADR DB9, docs/ai/subtitle-intelligence.md) - this function only
// flags which already-transcribed words are emphasis-worthy, script-
// agnostically; a future A2 must apply its own scriptSupportsUppercase()
// gate before actually transforming casing.
export function selectEmphasisWordIndices(words: TranscriptWordInput[]): number[] {
  const indices: number[] = [];
  words.forEach((word, index) => {
    const stripped = word.word.replace(/^[.,!?;:"'“”]+|[.,!?;:"'“”]+$/g, '');
    if (KEYWORD_PATTERN.test(stripped)) indices.push(index);
  });
  return indices;
}
