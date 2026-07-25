import { FONT_FAMILIES } from '@speedora/contracts';
import { MAX_INTRO_DURATION_SECONDS, WATERMARK_POSITIONS } from '@speedora/shared';
import { IsHexColor, IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateBrandKitDto {
  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  // Brand Kit roadmap (P3a) - IsIn against the same curated list
  // build-ass.ts's fontFamilySchema enforces, not a free-text field (avoids
  // a render-time font that was never bundled into the worker's Docker
  // image - see that Dockerfile's own comment).
  @IsOptional()
  @IsIn(FONT_FAMILIES)
  fontFamily?: string;

  // Watermark roadmap (P3c) - opacity/scale/margin are 0-1 fractions;
  // scale/margin are fractions of the OUTPUT video's width, resolution-
  // independent by construction (see ffmpeg.ts's buildWatermarkOverlay).
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  watermarkOpacity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  watermarkScale?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  watermarkMargin?: number;

  @IsOptional()
  @IsIn(WATERMARK_POSITIONS)
  watermarkPosition?: string;

  // Intro roadmap (P3d) - only meaningful when the current intro is an
  // image (a still has no inherent duration); stored regardless of the
  // current brandIntroType, same "just a field, resolved contextually at
  // render time" posture as every other conditional Brand Kit field.
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(MAX_INTRO_DURATION_SECONDS)
  introImageDurationSeconds?: number;

  // Outro roadmap (P3e) - same shape/reasoning as introImageDurationSeconds
  // above.
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(MAX_INTRO_DURATION_SECONDS)
  outroImageDurationSeconds?: number;
}
