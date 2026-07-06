import type { PublishRecord } from './social';

export enum VideoStatus {
  // Only reachable via POST /videos/import-youtube - a direct file upload
  // (POST /videos) goes straight to UPLOADED since the file is already in
  // hand. IMPORTING covers the time apps/worker's import-youtube job spends
  // downloading the source video before it has a real sourceUrl to store.
  IMPORTING = 'IMPORTING',
  UPLOADED = 'UPLOADED',
  TRANSCRIBED = 'TRANSCRIBED',
  CLIPS_DETECTED = 'CLIPS_DETECTED',
  RENDERED = 'RENDERED',
  FAILED = 'FAILED',
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  // Top-1 label from a vocal (audio-based) emotion classifier - one of
  // "neu"/"hap"/"ang"/"sad" (see CLAUDE.md's "Vocal Emotion Detection"
  // section). Undefined for segments too short to classify, or when
  // detection wasn't run/failed for this video - same optional-signal
  // treatment as speaker above.
  emotion?: string;
  // Word-level timestamps from Whisper - undefined for segments transcribed
  // before this field existed (Fase 3 pasca-MVP, not backfilled). Only the
  // karaoke caption preset needs this; render-clip falls back to plain text
  // for a segment that lacks it rather than failing.
  words?: TranscriptWord[];
  // Fase 25 (Audio Intelligence, AI Fusion roadmap Phase A) - this
  // segment's own mean RMS/peak level in dB (see
  // @speedora/audio-intelligence). Undefined for segments transcribed
  // before this field existed, or when analysis wasn't run/failed - same
  // optional-signal treatment as emotion above. Not calibrated/comparable
  // across different source recordings, only relative within one video.
  rmsDb?: number;
  peakDb?: number;
  // Words per second within this segment - pure math from start/end/word
  // count, always present once a segment has word-level data (undefined
  // only alongside a missing `words`).
  speakingRateWordsPerSecond?: number;
}

// Mirrors CaptionStyle in packages/database's Prisma schema.
export enum CaptionStyle {
  DEFAULT = 'DEFAULT',
  KARAOKE = 'KARAOKE',
  BOLD_HIGHLIGHT = 'BOLD_HIGHLIGHT',
}

export const CAPTION_STYLES: CaptionStyle[] = [
  CaptionStyle.DEFAULT,
  CaptionStyle.KARAOKE,
  CaptionStyle.BOLD_HIGHLIGHT,
];

// Mirrors TranscriptionProvider in packages/database's Prisma schema. Chosen
// once per video at upload/import time (see CLAUDE.md's Premium
// Transcription section) - GROQ (Whisper large-v3-turbo) is the free
// default; OPENAI (Whisper-1) is the paid "premium" tier, gated by a
// PremiumCredit (see payment.ts).
export enum TranscriptionProvider {
  GROQ = 'GROQ',
  OPENAI = 'OPENAI',
}

// Multi-metric breakdown behind the single viralityScore, from the same
// detect-clips LLM call (see CLAUDE.md's Fase 8 "Content Intelligence"
// section, extended Fase 32) - each 0-100. Explicitly a heuristic LLM
// estimate, not a statistically trained/calibrated prediction - there is
// no engagement dataset behind these numbers. Grouped into four domains
// (see @speedora/contracts' SCORE_DOMAINS) - Engagement: hookStrength/
// curiosity/emotion/storytelling; Knowledge: educationalValue/
// practicalValue/novelty/trustAuthority; Conversion: ctaStrength.
export interface ClipScores {
  hookStrength: number;
  educationalValue: number;
  // Fase 32 - how much a viewer could immediately apply this clip's
  // information with minimal additional knowledge (see
  // @speedora/clip-scoring's prompt for the full scoring criteria).
  practicalValue: number;
  curiosity: number;
  emotion: number;
  storytelling: number;
  novelty: number;
  trustAuthority: number;
  // Fase 32 - how persuasive the clip's call-to-action is, 0 if none.
  ctaStrength: number;
}

// Fase 27 (Facial Intelligence, AI Fusion roadmap Phase C) - one sampled
// frame's classified facial expression, clip-relative seconds. Mirrors
// @speedora/contracts' FacialEmotionSample shape rather than importing it -
// same duplication precedent as ClipScores above (packages/shared doesn't
// take a dependency on @speedora/contracts just for one small type). null
// emotion/score means no face was found in that sampled frame, not an
// error - see @speedora/facial-intelligence's own module comment.
export interface FacialEmotionSample {
  t: number;
  emotion: string | null;
  score: number | null;
}

// Fase 30 (Gesture Intelligence, AI Fusion roadmap Checkpoint 2) - one
// sampled frame's classified hand gesture, clip-relative seconds. Mirrors
// @speedora/contracts' GestureSample shape rather than importing it - same
// duplication precedent as FacialEmotionSample above. null gesture/
// confidence means no hand was detected at all (distinct from "none", a
// hand detected but no recognized gesture) - see
// @speedora/gesture-intelligence's own module comment.
export interface GestureSample {
  t: number;
  gesture: string | null;
  confidence: number | null;
}

// Fase 28 (Mini Fusion Engine v1 prep, AI Fusion roadmap Checkpoint 1) -
// dense derived summaries the Fusion Engine consumes, one per signal
// module (see packages/contracts/src/intelligence-signal.ts's raw/features
// convention and packages/contracts/src/fusion.ts's input contract).
// Mirrors each module's own contracts/ Features shape rather than
// importing it - same duplication precedent as ClipScores/
// FacialEmotionSample above.
export interface AudioFeatures {
  averageRmsDb: number | null;
  peakDb: number | null;
  averageSpeakingRateWordsPerSecond: number | null;
  speakingRateStdDev: number | null;
}

export interface SceneFeatures {
  cutCount: number;
  cutsPerMinute: number | null;
  averageSegmentSeconds: number | null;
}

export interface FacialEmotionFeatures {
  dominantEmotion: string | null;
  emotionTransitions: number;
  peakConfidence: number | null;
  stability: number | null;
}

export interface GestureFeatures {
  dominantGesture: string | null;
  gestureTransitions: number;
  peakConfidence: number | null;
  stability: number | null;
}

// Fase 29/31 (Mini Fusion Engine v1 -> v2) - @speedora/fusion-engine's
// feature-level breakdown: one entry per extracted+normalized+weighted
// named feature (not one opaque sub-score per signal) - see
// packages/contracts/src/fusion.ts's fusionContributionSchema.
export interface FusionContribution {
  signal: string;
  feature: string;
  rawValue: number | null;
  normalizedValue: number;
  weight: number;
  weightedContribution: number;
}

export type FusionBreakdown = FusionContribution[];

export interface FusionFactor {
  signal: string;
  feature: string;
  weightedContribution: number;
  description: string;
}

export interface FusionExplainability {
  topFactors: FusionFactor[];
}

// Fase 32 (Mini Fusion Engine v2 - Prediction & Recommendation stages) -
// @speedora/fusion-engine's deterministic, non-ML-trained bucket + human-
// readable action derived purely from highlightScore/confidence/
// contributions already computed above - same "heuristic, not a trained
// model" honesty as the rest of the Fusion Engine.
export type PredictionBucket = 'likely_high_performer' | 'uncertain' | 'likely_low_performer';

export interface FusionPrediction {
  bucket: PredictionBucket;
  rationale: string;
}

export interface FusionRecommendation {
  action: string;
  message: string;
}

export interface ClipCandidate {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  viralityScore: number;
  transcript: TranscriptSegment[];
  // Suggested 3-second-opener hook line and social hashtags (without a
  // leading '#') from the same detect-clips LLM call that scores virality -
  // see CLAUDE.md's Fase 5 section. hookText is null if the LLM call
  // failed/returned nothing for this candidate - that's not an error, just
  // missing metadata the user can fill in manually.
  hookText: string | null;
  hashtags: string[];
  // Fase 8 (Content Intelligence) - see ClipScores above and
  // schema.prisma's comments on Clip.scores/.reason/etc. All null/empty
  // for the same reason hookText can be null: the LLM call's per-candidate
  // metadata is best-effort, not something that can fail the whole job.
  scores: ClipScores | null;
  reason: string | null;
  topics: string[];
  keywords: string[];
  intent: string | null;
  ctaText: string | null;
  // Fase 23 (DB+JSON-contract roadmap) - deterministic keyword-pattern
  // suggestions from @speedora/emoji-suggester, computed from this clip's
  // own transcript text. Never empty/null-vs-array ambiguity: always an
  // array (possibly empty), same convention as hashtags/topics/keywords.
  emojiSuggestions: string[];
}

export interface Video {
  id: string;
  ownerId: string;
  sourceUrl: string;
  status: VideoStatus;
  // Prisma's `durationSeconds Float?` serializes as `null`, not `undefined`,
  // once it round-trips through JSON.
  durationSeconds: number | null;
  // 0-100, real progress reported by transcribe.worker.ts (see
  // schema.prisma's comment on this column) - null before a transcribe
  // attempt has started or once status has moved past UPLOADED. Only
  // meaningful while status === UPLOADED (the Transcribe stage); the
  // frontend's per-stage progress bar ignores it otherwise.
  transcribeProgress: number | null;
  transcriptionProvider: TranscriptionProvider;
  createdAt: string;
  updatedAt: string;
}

// Client-facing shape for a Clip - deliberately not the same as
// packages/database's Prisma `Clip` model (that's the DB row, including
// `outputUrl`, the raw object storage key; this is the API/UI-facing DTO,
// with a relative `downloadUrl` instead - see VideosService.mapVideoWithClips
// and ClipsService's own toDto()).
export interface Clip {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  viralityScore: number;
  downloadUrl: string | null;
  captionStyle: CaptionStyle;
  hookText: string | null;
  hashtags: string[];
  // Fase 8 (Content Intelligence) - see ClipCandidate/ClipScores above.
  scores: ClipScores | null;
  reason: string | null;
  topics: string[];
  keywords: string[];
  intent: string | null;
  ctaText: string | null;
  // Fase 23 (DB+JSON-contract roadmap) - see ClipCandidate above.
  emojiSuggestions: string[];
  // Fase 27 (Facial Intelligence, AI Fusion roadmap Phase C) - null when the
  // analysis wasn't run or failed entirely for this clip (distinct from an
  // empty array, which would mean "ran successfully and found nothing") -
  // same nullability convention as `scores` above. Computed at render-clip
  // time (not detect-clips time, unlike scores/topics/etc.), so it isn't on
  // ClipCandidate.
  facialEmotions: FacialEmotionSample[] | null;
  // Fase 30 (Gesture Intelligence, AI Fusion roadmap Checkpoint 2) - same
  // null-vs-empty-array convention as facialEmotions above.
  gestures: GestureSample[] | null;
  // Fase 28/30 (Mini Fusion Engine v1 prep, AI Fusion roadmap Checkpoint
  // 1/2) - dense derived summaries computed from sceneCuts/facialEmotions/
  // gestures/this clip's own transcript segments (see AudioFeatures/
  // SceneFeatures/FacialEmotionFeatures/GestureFeatures above) - what the
  // Fusion Engine actually consumes, not the raw timelines. sceneCuts/
  // audioFeatures/sceneFeatures are always computed (their raw inputs are
  // always arrays, even if empty); facialFeatures/gestureFeatures are null
  // exactly when facialEmotions/gestures are null.
  audioFeatures: AudioFeatures | null;
  sceneFeatures: SceneFeatures | null;
  facialFeatures: FacialEmotionFeatures | null;
  gestureFeatures: GestureFeatures | null;
  // Fase 32 - the same Fase 8 ClipScores this clip's `scores` field already
  // carries, echoed back here as what the Fusion Engine's `llm` signal
  // actually consumed at render time (threaded through the render-clip job
  // payload - see RenderClipJobData.scores) - null for a clip whose
  // detect-clips LLM call never ran/produced no scores.
  llmFeatures: ClipScores | null;
  // Fase 29/31 (Mini Fusion Engine v1 -> v2) - @speedora/fusion-engine's
  // computeHighlightScore() output, combining whichever of
  // audioFeatures/sceneFeatures/facialFeatures/gestureFeatures were
  // available (weighted per-signal, see @speedora/fusion-engine's
  // weights.ts - gesture currently has weight 0, so its data can be
  // present here without moving highlightScore). highlightScore null means
  // the sum of weighted contributions was zero (not a fabricated 0/50);
  // highlightBreakdown/highlightExplainability/highlightReason are always
  // populated once computeHighlightScore runs, even when highlightScore
  // itself ends up null. highlightConfidence is a heuristic coverage+
  // quality estimate, NOT a calibrated probability.
  highlightScore: number | null;
  highlightBreakdown: FusionBreakdown;
  highlightExplainability: FusionExplainability;
  highlightConfidence: number | null;
  highlightReason: string | null;
  // Fase 32 (Mini Fusion Engine v2 - Prediction & Recommendation stages) -
  // always populated once computeHighlightScore runs (same as
  // highlightBreakdown/highlightExplainability above), even when
  // highlightScore itself ends up null.
  highlightPrediction: FusionPrediction | null;
  highlightRecommendation: FusionRecommendation | null;
  // Rank among sibling clips of the same video by highlightScore - null
  // until every clip in the video has finished rendering (see
  // render-clip.worker.ts's rankClips() call).
  highlightRank: number | null;
  // Publish attempts to connected social accounts (Fase 6b) - empty until
  // the user hits "Publish now" at least once. Small array in practice (at
  // most one per connected platform account), so returned inline rather
  // than via a separate endpoint.
  publishRecords: PublishRecord[];
  updatedAt: string;
}

export interface VideoWithClips extends Video {
  clips: Clip[];
}

// PATCH /clips/:id payload - manual trim from the timeline editor. Partial:
// either field can be adjusted independently.
export interface UpdateClipInput {
  startTime?: number;
  endTime?: number;
  captionStyle?: CaptionStyle;
  hookText?: string;
  hashtags?: string[];
}
