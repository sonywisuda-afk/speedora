import { CaptionStyle } from '@speedora/database';
import { FONT_FAMILIES } from '@speedora/contracts';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

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

  // AI Intelligence v4 Track B, Phase A2 (docs/ai/subtitle-intelligence.md)
  // - opts this clip's captions into subtitleIntelligence's structural
  // re-chunking, orthogonal to captionStyle, same shape as
  // speakerColorCaptions above.
  @IsOptional()
  @IsBoolean()
  smartSegmentation?: boolean;

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

  // Subtitle Presets roadmap (P3b) - per-clip override of the resolved
  // caption font (e.g. from picking a preset), same "explicit null clears
  // it" shape as captionLanguage above. Wins over applyBrandKit/Brand Kit's
  // own font at render time regardless of value - see
  // ClipsService.resolveFontFamily.
  @IsOptional()
  @IsIn(FONT_FAMILIES)
  fontFamily?: string | null;

  // Watermark roadmap (P3c) - per-clip on/off gate for the owner's Brand
  // Kit watermark, same shape as applyBrandKit above (composable with it).
  @IsOptional()
  @IsBoolean()
  watermarkEnabled?: boolean;

  // Intro roadmap (P3d) - per-clip on/off gate, same shape as
  // watermarkEnabled above.
  @IsOptional()
  @IsBoolean()
  introEnabled?: boolean;

  // Outro roadmap (P3e) - per-clip on/off gate, same shape as
  // watermarkEnabled above.
  @IsOptional()
  @IsBoolean()
  outroEnabled?: boolean;

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
