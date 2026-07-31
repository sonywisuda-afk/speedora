import { IsObject, IsString, MaxLength, MinLength } from 'class-validator';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

// Tahap 3 Sprint 1 (Passkey Foundation) - `response` is the browser's
// RegistrationResponseJSON from @simplewebauthn/browser's startRegistration();
// not deep-validated by class-validator (its shape is exactly what
// verifyRegistrationResponse() itself validates/rejects) - IsObject here is
// just "did the client send something at all," same shallow posture
// MfaCodeDto/ElevateDto take toward their own single string fields.
export class VerifyPasskeyRegistrationDto {
  @IsObject()
  response!: RegistrationResponseJSON;

  @IsString()
  challengeToken!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
