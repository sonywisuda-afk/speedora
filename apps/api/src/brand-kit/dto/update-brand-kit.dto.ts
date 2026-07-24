import { FONT_FAMILIES } from '@speedora/contracts';
import { IsHexColor, IsIn, IsOptional } from 'class-validator';

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
}
