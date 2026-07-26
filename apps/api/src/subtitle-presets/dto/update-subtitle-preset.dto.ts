import { CaptionStyle } from '@speedora/database';
import { FONT_FAMILIES } from '@speedora/contracts';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateSubtitlePresetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsEnum(CaptionStyle)
  captionStyle?: CaptionStyle;

  @IsOptional()
  @IsBoolean()
  speakerColorCaptions?: boolean;

  // Explicit null clears the font override back to "no font" - same
  // omitted-vs-null distinction Clip.captionLanguage/fontFamily use.
  @IsOptional()
  @IsIn(FONT_FAMILIES)
  fontFamily?: string | null;
}
