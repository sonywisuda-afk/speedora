// AI Clip Library roadmap (P1) - the emotion filter reads
// Clip.facialFeatures.dominantEmotion, which is the FER+ 7-class taxonomy
// (angry/disgust/fear/happy/neutral/sad/surprise, verified against real dev
// data and @speedora/contracts' FACIAL_EMOTIONS) - NOT the same short-code
// taxonomy (VOCAL_EMOTIONS: neu/hap/ang/sad) TranscriptReviewPanel.tsx's own
// EMOTION_LABELS map uses for the unrelated vocal-emotion field, which is
// genuinely a different, smaller taxonomy (not a bug there). This is the one
// canonical label map for the facial-emotion taxonomy - Contract Governance
// audit (2026-08-01) found FaceReviewPanel.tsx had its own SECOND, WRONG
// copy using the short vocal-emotion codes for this long-form field (every
// lookup silently missed, always falling back to the raw English word); it
// now imports this map instead of maintaining a drifted duplicate.
//
// Mirrors @speedora/contracts' FacialEmotion (apps/web has no dependency on
// @speedora/contracts - that package is apps/api/apps/worker-only per
// CLAUDE.md's architecture, so this is a plain local type, not an import) -
// same "Mirrors X" convention used for every other cross-package enum in
// this codebase. Record<FacialEmotion, string> instead of Record<string,
// string> so the compiler itself rejects a build that adds a new emotion
// class here without a matching Indonesian label - this is what would have
// caught the FaceReviewPanel.tsx drift above at compile time instead of
// leaving it to silently degrade to raw English at runtime.
type FacialEmotion = 'angry' | 'disgust' | 'fear' | 'happy' | 'neutral' | 'sad' | 'surprise';

export const EMOTION_LABELS: Record<FacialEmotion, string> = {
  angry: 'Marah',
  disgust: 'Jijik',
  fear: 'Takut',
  happy: 'Senang',
  neutral: 'Netral',
  sad: 'Sedih',
  surprise: 'Terkejut',
};

export interface DurationBucket {
  label: string;
  minDuration?: number;
  maxDuration?: number;
}

// Bucket edges roughly follow this product's own "ideal short-clip" framing
// (15-60s) rather than arbitrary round numbers.
export const DURATION_BUCKETS: DurationBucket[] = [
  { label: '< 15s', maxDuration: 15 },
  { label: '15-60s', minDuration: 15, maxDuration: 60 },
  { label: '60-180s', minDuration: 60, maxDuration: 180 },
  { label: '> 180s', minDuration: 180 },
];
