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
// section) - each 0-100. Explicitly a heuristic LLM estimate, not a
// statistically trained/calibrated prediction - there is no engagement
// dataset behind these numbers.
export interface ClipScores {
  hookStrength: number;
  educationalValue: number;
  curiosity: number;
  emotion: number;
  storytelling: number;
  novelty: number;
  trustAuthority: number;
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
