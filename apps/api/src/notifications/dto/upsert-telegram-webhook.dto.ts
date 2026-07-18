import { IsNotEmpty, IsString, Matches } from 'class-validator';

// Milestone 04e - a cheap format pre-check before the external Telegram
// getMe validation call (NotificationsService.upsertTelegramWebhook) - same
// "reject clearly-malformed input early" spirit as
// UpsertNotificationWebhookDto's @IsUrl protocol check. A real bot token
// always looks like "<numeric bot id>:<35-ish char secret>".
export class UpsertTelegramWebhookDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+:[A-Za-z0-9_-]{30,}$/, { message: 'botToken must look like a Telegram bot token' })
  botToken!: string;
}
