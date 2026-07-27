import { IsString, MinLength } from 'class-validator';

// Tahap 2 Step 2 Sprint 2b (Session Elevation) - currentPassword dropped;
// this route is now gated by RecentMfaGuard (POST /auth/elevate already
// re-proved identity - a code or the current password, whichever applies
// to the account).
export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  newPassword: string;
}
