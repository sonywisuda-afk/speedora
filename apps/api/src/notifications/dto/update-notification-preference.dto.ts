import { IsBoolean, IsOptional } from 'class-validator';

// Sprint 4B - both optional so a single toggle click only sends the field
// that changed; NotificationsService.updatePreference reads current row
// state for the other.
export class UpdateNotificationPreferenceDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  toast?: boolean;
}
