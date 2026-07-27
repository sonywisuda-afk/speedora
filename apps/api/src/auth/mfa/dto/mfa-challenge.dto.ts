import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

// Tahap 2 Step 2 Sprint 2a (MFA Enforcement) - body of POST
// /auth/mfa/challenge. mfaToken is the short-lived token issued by
// AuthController.login()/OAuthController.callback() when MFA is required;
// code may be a live TOTP code or a recovery code, same as MfaCodeDto.
export class MfaChallengeDto {
  @IsString()
  mfaToken: string;

  @IsString()
  @MinLength(6)
  code: string;

  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;
}
