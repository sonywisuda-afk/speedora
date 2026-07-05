import type {
  CaptionStyle as PrismaCaptionStyle,
  TranscriptionProvider as PrismaTranscriptionProvider,
  TranscriptSegment as TranscriptSegmentRow,
} from '@speedora/database';
import type {
  CaptionStyle,
  ClipScores,
  TranscriptionProvider,
  TranscriptSegment,
  TranscriptWord,
} from '@speedora/shared';

// Prisma types a Json column as the opaque JsonValue union - this narrows it
// back to the shape transcribe.worker.ts actually writes there. Used
// wherever a TranscriptSegment row read from Postgres needs to become the
// packages/shared-typed shape a job payload expects (VideosService.retry,
// ClipsService.render).
export function toSharedTranscriptSegment(segment: TranscriptSegmentRow): TranscriptSegment {
  return {
    start: segment.start,
    end: segment.end,
    text: segment.text,
    speaker: segment.speaker ?? undefined,
    emotion: segment.emotion ?? undefined,
    words: Array.isArray(segment.words)
      ? (segment.words as unknown as TranscriptWord[])
      : undefined,
  };
}

// Prisma's generated CaptionStyle enum and packages/shared's are two
// separately-declared TS enums with identical string members (see
// CLAUDE.md's "Mirrors X" convention, also used for VideoStatus) - which
// makes them structurally identical at runtime but nominally distinct
// types, so passing one where the other is expected needs this explicit
// (safe) cast rather than a silent compile error.
export function toSharedCaptionStyle(style: PrismaCaptionStyle): CaptionStyle {
  return style as unknown as CaptionStyle;
}

// Same enum-mirroring situation as toSharedCaptionStyle above, for
// Video.transcriptionProvider - used by VideosService.retry() to forward a
// video's stored provider choice back into a re-enqueued transcribe/
// import-youtube job.
export function toSharedTranscriptionProvider(
  provider: PrismaTranscriptionProvider,
): TranscriptionProvider {
  return provider as unknown as TranscriptionProvider;
}

// Same "Json column is opaque" situation as toSharedTranscriptSegment above,
// for Clip.scores (Fase 8's Content Intelligence breakdown) - used wherever
// a Clip row read from Postgres needs to become the packages/shared-typed
// DTO (ClipsService.toDto, VideosService.mapVideoWithClips).
export function toSharedClipScores(scores: unknown): ClipScores | null {
  return (scores as ClipScores | null) ?? null;
}
