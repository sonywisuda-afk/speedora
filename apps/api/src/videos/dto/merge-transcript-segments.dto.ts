import { IsString } from 'class-validator';

// Subtitle Studio roadmap (P2b) - firstSegmentId/secondSegmentId must be
// time-adjacent (VideosService.mergeTranscriptSegments enforces this) -
// order matters, the merged row keeps firstSegmentId's id.
export class MergeTranscriptSegmentsDto {
  @IsString()
  firstSegmentId!: string;

  @IsString()
  secondSegmentId!: string;
}
