import { IsOptional, IsString } from 'class-validator';

// Tahap 2 Step 2 Sprint 2b (Session Elevation) - exactly one of code/password
// applies to a given account (code if MFA is enabled, password otherwise) -
// AuthService.verifyElevationCredential picks the right one; both are
// optional here since the caller only ever sends the one that's relevant.
export class ElevateDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  password?: string;
}
