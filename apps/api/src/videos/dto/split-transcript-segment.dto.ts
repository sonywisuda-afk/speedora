import { IsInt, Min } from 'class-validator';

// Subtitle Studio roadmap (P2b) - split point is a word index (split before
// this word - word 0 stays in segment 1, word atWordIndex starts segment 2),
// not a raw timestamp - keeps the split aligned to Whisper's own word
// boundaries when they exist. For a pre-Fase-3 segment with no word-level
// timestamps, VideosService.splitTranscriptSegment reinterprets the same
// index against text.split(/\s+/) and derives an approximate time split by
// character-length ratio (response flags approximate: true). Must be >= 1
// (index 0 would produce an empty first segment).
export class SplitTranscriptSegmentDto {
  @IsInt()
  @Min(1)
  atWordIndex!: number;
}
