import { IsObject, IsString } from 'class-validator';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

// Tahap 3 Sprint 2 (Passkey Login) - `response` is the browser's
// AuthenticationResponseJSON from @simplewebauthn/browser's
// startAuthentication(); same shallow-validation posture as
// VerifyPasskeyRegistrationDto - not deep-validated by class-validator,
// that's exactly what verifyAuthenticationResponse() itself does.
export class VerifyPasskeyAuthenticationDto {
  @IsObject()
  response!: AuthenticationResponseJSON;

  @IsString()
  challengeToken!: string;
}
