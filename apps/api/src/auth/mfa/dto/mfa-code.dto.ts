import { IsString, MinLength } from 'class-validator';

// Shared by enroll/confirm, disable, and recovery-codes/regenerate - `code`
// may be either a live TOTP code or an unused recovery code, so no format
// constraint beyond non-empty is enforced here (MfaService tries TOTP
// first, falls back to a recovery code lookup).
export class MfaCodeDto {
  @IsString()
  @MinLength(6)
  code: string;
}
