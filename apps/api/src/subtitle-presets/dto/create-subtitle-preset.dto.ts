import { CaptionStyle } from '@speedora/database';
import { FONT_FAMILIES } from '@speedora/contracts';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSubtitlePresetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsEnum(CaptionStyle)
  captionStyle!: CaptionStyle;

  @IsBoolean()
  speakerColorCaptions!: boolean;

  // Same curated list build-ass.ts/BrandKit's own fontFamily fields validate
  // against - null/omitted means "no font override", falls back to the
  // Brand Kit's own font at render time.
  @IsOptional()
  @IsIn(FONT_FAMILIES)
  fontFamily?: string;
}
