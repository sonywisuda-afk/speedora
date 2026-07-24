import { IsNotEmpty, IsString } from 'class-validator';

// Subtitle Studio roadmap (P2a) - manual caption text edit. text is required
// (an empty caption doesn't make sense as an edit - use merge/delete
// semantics instead, not blank text) unlike UpdateClipDto's optional fields.
export class UpdateTranscriptSegmentDto {
  @IsString()
  @IsNotEmpty()
  text!: string;
}
