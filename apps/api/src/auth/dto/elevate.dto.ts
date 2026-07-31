import { IsObject, IsOptional, IsString } from 'class-validator';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

// Tahap 2 Step 2 Sprint 2b (Session Elevation) - exactly one of
// code/password/passkeyResponse applies to a given elevation attempt (code
// if MFA is enabled, password otherwise, or a passkey assertion - Tahap 3
// Sprint 3) - AuthController.elevate picks the right one; all are optional
// here since the caller only ever sends the one that's relevant.
export class ElevateDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  password?: string;

  // Tahap 3 Sprint 3 (Passkey Elevation) - same shallow-validation posture
  // as VerifyPasskeyRegistrationDto/VerifyPasskeyAuthenticationDto: not
  // deep-validated here, that's what verifyElevationAssertion's call into
  // verifyAuthenticationResponse itself does. Always sent together.
  @IsOptional()
  @IsObject()
  passkeyResponse?: AuthenticationResponseJSON;

  @IsOptional()
  @IsString()
  passkeyChallengeToken?: string;
}
