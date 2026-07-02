import type { TranscriptSegment } from '../types/video';

// Overlap (not strict containment) - clip start/end round-trip through
// Postgres float storage, so exact boundary comparisons are fragile to
// precision drift. buildSrt() in apps/worker clamps/trims each segment to
// the clip window anyway. Used wherever a clip's transcript needs
// recomputing from a video's full segment list: detect-clips (initial
// candidates), VideosService.retry (re-enqueueing a failed render-clip),
// and ClipsService.render (re-rendering after a manual timeline edit).
export function filterSegmentsForClip(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
): TranscriptSegment[] {
  return segments.filter((segment) => segment.end > clipStart && segment.start < clipEnd);
}
