import { TranscriptionProvider } from '@speedora/shared';
import { IsEnum, IsOptional } from 'class-validator';

// Only the non-file field of the multipart upload form - multer parses this
// alongside the 'file' field into req.body, and Nest's @Body() picks it up
// the same way it would for a plain JSON request. Chosen fresh per upload
// (not an account-level setting) - omitted defaults to the free GROQ tier
// in VideosController.
export class UploadVideoDto {
  @IsOptional()
  @IsEnum(TranscriptionProvider)
  transcriptionProvider?: TranscriptionProvider;
}
