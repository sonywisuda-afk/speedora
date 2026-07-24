import { CaptionStyle } from '@speedora/database';
import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateClipDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  startTime?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  endTime?: number;

  @IsOptional()
  @IsEnum(CaptionStyle)
  captionStyle?: CaptionStyle;

  // Subtitle Studio roadmap (P2c) - orthogonal to captionStyle, composes
  // with any preset.
  @IsOptional()
  @IsBoolean()
  speakerColorCaptions?: boolean;

  // Subtitle Studio roadmap (P2f) - which TranscriptSegment.translations key
  // to burn in; null clears it back to the original (untranslated) text.
  @IsOptional()
  @IsString()
  captionLanguage?: string | null;

  // Brand Kit roadmap (P3a) - per-clip opt-out of the owner's Brand Kit
  // (font now; logo/watermark/intro/outro in later P3 sub-phases), same
  // shape as speakerColorCaptions above.
  @IsOptional()
  @IsBoolean()
  applyBrandKit?: boolean;

  // Suggested opener line/hashtags from the detect-clips LLM call - purely
  // metadata (not baked into the rendered video), user-editable same as
  // everything else on this DTO.
  @IsOptional()
  @IsString()
  hookText?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[];
}
