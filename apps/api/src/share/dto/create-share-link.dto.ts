import { ShareRole } from '@speedora/shared';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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

  // Collaboration roadmap follow-up (clip-level Share scoping, 2026-08-10) -
  // omitted (the pre-existing default) grants access to the whole video;
  // set means the resulting link is restricted to exactly this one clip.
  // Ownership (does this clip belong to the video the link is being
  // created for?) is checked in ShareService.create, not here - same
  // "pure shape validation, no DB access" posture RequestApprovalDto's own
  // clipId already has.
  @IsOptional()
  @IsString()
  clipId?: string;
}
