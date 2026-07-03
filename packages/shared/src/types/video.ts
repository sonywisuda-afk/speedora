import type { PublishRecord } from './social';

export enum VideoStatus {
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
}

export interface Video {
  id: string;
  ownerId: string;
  sourceUrl: string;
  status: VideoStatus;
  // Prisma's `durationSeconds Float?` serializes as `null`, not `undefined`,
  // once it round-trips through JSON.
  durationSeconds: number | null;
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
