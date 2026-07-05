import { CaptionStyle } from '@speedora/database';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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
