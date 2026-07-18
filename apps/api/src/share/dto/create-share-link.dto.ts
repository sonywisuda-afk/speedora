import { ShareRole } from '@speedora/shared';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateShareLinkDto {
  @IsOptional()
  @IsEnum(ShareRole)
  role?: ShareRole;

  // Days from now until the link stops working - omitted means "never
  // expires" (still revocable at any time via DELETE /share-links/:id).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}
