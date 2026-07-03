import { IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PublishClipDto {
  @IsString()
  @IsNotEmpty()
  socialAccountId!: string;

  // Omitted entirely means "publish now" (Fase 6b's original behavior).
  // Fase 6c: a future ISO 8601 timestamp schedules the publish instead -
  // ClipsService.publish() validates it's actually in the future.
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}
