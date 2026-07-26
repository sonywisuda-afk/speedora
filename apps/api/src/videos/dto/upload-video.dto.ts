import { TranscriptionProvider } from '@speedora/shared';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ProcessingOptionsDto } from '../../processing-presets/dto/processing-options.dto';

// Only the non-file fields of the multipart upload form - multer parses
// these alongside the 'file' field into req.body, and Nest's @Body() picks
// them up the same way it would for a plain JSON request. transcriptionProvider
// is chosen fresh per upload (not an account-level setting) - omitted
// defaults to the free GROQ tier in VideosController. workspaceId (Sprint
// 5A, Collaboration Foundation) - omitted defaults to the uploader's own
// personal workspace, preserving every pre-5A caller's behavior exactly.
export class UploadVideoDto {
  @IsOptional()
  @IsEnum(TranscriptionProvider)
  transcriptionProvider?: TranscriptionProvider;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  // Pre-Processing Settings roadmap (Phase 0/1) - a multipart form field
  // can only ever be a string, so this arrives JSON-encoded (same reasoning
  // ImportYoutubeDto's own field doesn't need, since that request is plain
  // JSON) and is parsed before the nested validator below runs. An invalid
  // JSON string is left as-is rather than thrown from inside the
  // transform - @ValidateNested then rejects the non-object result with a
  // normal 400, instead of a raw JSON.parse exception surfacing as a 500.
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  })
  @ValidateNested()
  @Type(() => ProcessingOptionsDto)
  processingOptions?: ProcessingOptionsDto;
}
