import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

// Generate More Clips roadmap (Phase C) - the request body for
// POST /videos/:id/generate-more. requestedCount is capped at 10 (well
// above what a "few more clips" request should ever need) rather than
// UNLIMITED_CLIP_COUNT_CAP's 50 - that cap exists for the original
// clipGeneration.clipCount: 'unlimited' setting, a different, much broader
// use case than a single manual top-up request. min/maxClipDurationSeconds
// and minConfidence reuse @speedora/clip-scoring's own existing bounds
// (MIN_CLIP_SECONDS=20/MAX_CLIP_SECONDS=600 as prompt guidance, 0-100 for
// score) rather than inventing new ones.
export class GenerateMoreDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  requestedCount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5)
  @Max(600)
  minClipDurationSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5)
  @Max(600)
  maxClipDurationSeconds?: number;

  // "Prioritas kualitas" dialog field - reuses ClipScoringInput's existing
  // minConfidence (0-100 viralityScore floor), not a new scoring concept.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minConfidence?: number;

  @IsBoolean()
  avoidOverlap!: boolean;
}
