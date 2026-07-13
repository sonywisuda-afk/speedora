import type { OcrTextTrack } from '@speedora/contracts';

// Same weight table as @speedora/fusion-engine's OCR_CATEGORY_WEIGHT,
// duplicated (not imported - no cross-signal-package dependency in this
// pipeline), rescaled from fusion-engine's 0-100 category weight to [0,1]
// since every score-*.ts function in this package already returns 0-1.
const OCR_CATEGORY_WEIGHT: Record<string, number> = {
  price: 0.9,
  name: 0.7,
  subtitle: 0.6,
  slide: 0.55,
  caption: 0.5,
  logo: 0.3,
};
const DEFAULT_OCR_CATEGORY_WEIGHT = 0.5;

// Unlike every other score-*.ts function, OCR tracks are TIME RANGES
// ([startTime, endTime]), not discrete per-instant samples - there's no
// "track's own t value" to contribute to the candidate-timestamp union, so
// this function takes the already-generated candidate list and evaluates
// which tracks are active at each one, instead of producing its own map
// keys independently.
export function scoreOcrImportance(
  tracks: OcrTextTrack[] | null,
  candidateTimestamps: number[],
): Map<number, number> {
  const scores = new Map<number, number>();
  for (const t of candidateTimestamps) {
    let best = 0;
    for (const track of tracks ?? []) {
      if (t < track.startTime || t > track.endTime) continue;
      const weight = OCR_CATEGORY_WEIGHT[track.category] ?? DEFAULT_OCR_CATEGORY_WEIGHT;
      const value = track.categoryConfidence * weight;
      if (value > best) best = value;
    }
    if (best > 0) scores.set(t, best);
  }
  return scores;
}
