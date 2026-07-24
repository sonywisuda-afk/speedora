// AI Clip Library roadmap (P1) - the emotion filter reads
// Clip.facialFeatures.dominantEmotion, which is the FER+ 7-class taxonomy
// (angry/disgust/fear/happy/neutral/sad/surprise, verified against real dev
// data and apps/worker/scripts/detect_facial_emotion.py's own FACIAL_EMOTIONS
// comment) - NOT the same short-code taxonomy TranscriptReviewPanel.tsx/
// FaceReviewPanel.tsx's own (inconsistent, 4-vs-7-key) EMOTION_LABELS maps
// use for the unrelated vocal-emotion field. This is the one canonical label
// map for this taxonomy; those two panels are left untouched (a separate,
// pre-existing inconsistency, out of scope here).
export const EMOTION_LABELS: Record<string, string> = {
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
