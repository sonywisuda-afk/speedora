import type { EditingSuggestion, OcrTextTrack, OcrTextCategory } from '@speedora/contracts';

// Which of OCR Intelligence's 6 categories read as standalone, worth-
// emphasizing content (spec Part 9's "OCR Highlight") - a documented
// HEURISTIC (ADR D4), not derived from any real data. 'price'/'name' are
// concrete facts a viewer might want called out; 'subtitle'/'caption' are
// typically redundant with the spoken audio already being captioned by
// this pipeline's own subtitle renderer, 'logo' is branding rather than
// content, and 'slide' is too ambiguous a category to default to
// highlighting without more signal than category alone provides.
//
// Exported (not module-private) since Phase C5 (docs/ai/
// visual-emphasis-engine.md) reuses this SAME filter to decide which
// OcrTextTrack entries get an actual burned-in highlight box, not just a
// suggestion-timeline entry - one filter definition, not two independently
// drifting copies.
export const OCR_HIGHLIGHT_CATEGORIES: readonly OcrTextCategory[] = ['price', 'name'];

// Below this, classify-ocr-text.ts's own rule-fusion score is itself too
// uncertain to act on - same "don't trust a low-confidence heuristic
// classification" caution this pipeline applies elsewhere.
export const MIN_CATEGORY_CONFIDENCE = 0.5;

export function isOcrHighlightWorthy(track: OcrTextTrack): boolean {
  return (
    OCR_HIGHLIGHT_CATEGORIES.includes(track.category) &&
    track.categoryConfidence >= MIN_CATEGORY_CONFIDENCE
  );
}

export function fromOcrTracks(ocrTracks: OcrTextTrack[] | null): EditingSuggestion[] {
  if (!ocrTracks) return [];
  return ocrTracks.filter(isOcrHighlightWorthy).map((track) => ({
    technique: 'ocr_highlight',
    start: track.startTime,
    end: track.endTime,
    score: track.categoryConfidence,
    reason: `On-screen ${track.category} text detected: "${track.text}"`,
  }));
}
