import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { encryptWebhookUrl, getTelegramBotInfo, type Notification } from '@speedora/database';
import {
  NotificationChannel,
  NotificationType,
  type NotificationDto,
  type NotificationListDto,
  type NotificationPreferenceDto,
  type NotificationPreferenceListDto,
  type NotificationUnreadCountDto,
  type NotificationWebhookDto,
  type NotificationWebhookListDto,
} from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';

// Milestone 04d/04e - the 4 outbound channels a NotificationWebhook
// destination can exist for. IN_APP is rejected wherever a channel comes
// from client input (upsertWebhook/deleteWebhook) - it has no external
// destination to configure.
const WEBHOOK_CHANNELS = [
  NotificationChannel.SLACK,
  NotificationChannel.DISCORD,
  NotificationChannel.WEBHOOK,
  NotificationChannel.TELEGRAM,
];

// Notification Center Sprint 4A - shaped like ExportService: ownership via a
// plain userId filter for lists (a video/notification list that isn't the
// requester's just yields empty, no separate ownership lookup), updateMany +
// count-check for owned single-row mutations (same pattern as
// ClipsService.cancelScheduledPublish/reschedulePublish).
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, limit: number): Promise<NotificationListDto> {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { notifications: notifications.map((n) => this.toDto(n)) };
  }

  async unreadCount(userId: string): Promise<NotificationUnreadCountDto> {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { count };
  }

  // Compound (id, userId) where, no separate ownership lookup. Not scoped by
  // readAt: null - re-marking an already-read notification just refreshes
  // readAt (idempotent, no false 404 on a double-click).
  async markRead(id: string, userId: string): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count };
  }

  // Sprint 4B (IN_APP only) / Milestone 04d (channel becomes a param).
  // `channel` defaults to IN_APP - every existing caller (NotificationBell's
  // preference-gated toast diffing) keeps working unchanged. Always returns
  // exactly one entry per NotificationType, defaults already resolved
  // (absence of a row = enabled: true, toast: true) - the client never
  // merges/defaults itself. `toast` stays meaningful only for IN_APP -
  // returned as true (never read/written to `config`) for the other 3
  // channels, which don't use `config` at all.
  async getPreferences(
    userId: string,
    channel: NotificationChannel = NotificationChannel.IN_APP,
  ): Promise<NotificationPreferenceListDto> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId, channel },
    });
    const byType = new Map(rows.map((row) => [row.type, row]));

    const preferences: NotificationPreferenceDto[] = Object.values(NotificationType).map((type) => {
      const row = byType.get(type);
      const config = (row?.config as { toast?: boolean } | null) ?? null;
      return {
        type,
        enabled: row?.enabled ?? true,
        toast: channel === NotificationChannel.IN_APP ? (config?.toast ?? true) : true,
      };
    });

    return { preferences };
  }

  // Create-on-first-write (upsert), not update-only + 404 like markRead -
  // there's no "existing preference" to require, absence is a valid,
  // fully-enabled state. `channel` defaults to IN_APP, same as
  // getPreferences above.
  async updatePreference(
    userId: string,
    type: string,
    dto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreferenceDto> {
    if (!Object.values(NotificationType).includes(type as NotificationType)) {
      throw new BadRequestException(`Unknown notification type: ${type}`);
    }
    const notificationType = type as NotificationType;
    const channel = dto.channel ?? NotificationChannel.IN_APP;

    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId_type_channel: { userId, type: notificationType, channel } },
    });
    const existingConfig = (existing?.config as { toast?: boolean } | null) ?? {};
    const enabled = dto.enabled ?? existing?.enabled ?? true;
    // config (toast) is IN_APP-only - never read/written for the other 3
    // channels, which have no client-facing presentation to toggle.
    const config =
      channel === NotificationChannel.IN_APP
        ? { toast: dto.toast ?? existingConfig.toast ?? true }
        : undefined;

    const row = await this.prisma.notificationPreference.upsert({
      where: { userId_type_channel: { userId, type: notificationType, channel } },
      create: { userId, type: notificationType, channel, enabled, config },
      update: { enabled, config },
    });

    return {
      type: row.type as unknown as NotificationType,
      enabled: row.enabled,
      toast: channel === NotificationChannel.IN_APP ? (config?.toast ?? true) : true,
    };
  }

  // Milestone 04d/04e - one entry per SLACK/DISCORD/WEBHOOK/TELEGRAM. Never
  // returns the decrypted url/token - write-only field, same posture as a
  // password input. For TELEGRAM specifically, `configured` means "chatId
  // is known" (a message can actually be sent), not merely "a bot token was
  // saved" - `pending: true` is the distinct in-between state a saved-but-
  // not-yet-discovered row is in, so the UI can render a t.me/<username>
  // deep link + "waiting" status instead of collapsing that into either
  // "not configured" or "configured".
  async getWebhooks(userId: string): Promise<NotificationWebhookListDto> {
    const rows = await this.prisma.notificationWebhook.findMany({
      where: { userId, channel: { in: WEBHOOK_CHANNELS } },
      select: { channel: true, chatId: true, telegramBotUsername: true },
    });
    const rowByChannel = new Map(rows.map((row) => [row.channel, row]));

    const webhooks: NotificationWebhookDto[] = WEBHOOK_CHANNELS.map((channel) => {
      const row = rowByChannel.get(channel);
      if (channel === NotificationChannel.TELEGRAM) {
        return {
          channel,
          configured: row?.chatId != null,
          pending: row != null && row.chatId == null,
          telegramBotUsername: row?.telegramBotUsername ?? undefined,
        };
      }
      return { channel, configured: row != null };
    });

    return { webhooks };
  }

  // Rejects IN_APP and TELEGRAM at the service level (not just the
  // DTO/route) - same service-level-enum-validation convention as
  // updatePreference's NotificationType check above. TELEGRAM is rejected
  // here because its save path needs external validation (getTelegramBotInfo)
  // and a distinct response shape (telegramBotUsername) this generic
  // URL-only path has neither the DTO nor the behavior for - see
  // upsertTelegramWebhook below. Create-on-first-write (upsert), same
  // posture as updatePreference - a user re-saving the same channel just
  // replaces the stored ciphertext.
  async upsertWebhook(
    userId: string,
    channel: NotificationChannel,
    url: string,
  ): Promise<NotificationWebhookDto> {
    if (channel === NotificationChannel.IN_APP || channel === NotificationChannel.TELEGRAM) {
      throw new BadRequestException(`${channel} cannot be configured through this endpoint`);
    }

    await this.prisma.notificationWebhook.upsert({
      where: { userId_channel: { userId, channel } },
      create: { userId, channel, url: encryptWebhookUrl(url) },
      update: { url: encryptWebhookUrl(url) },
    });

    return { channel, configured: true };
  }

  // Milestone 04e - validates the token against the real Telegram API
  // before persisting anything (getTelegramBotInfo throws on an invalid
  // token, which becomes a clean BadRequestException here - nothing is ever
  // saved for a token that doesn't work). chatId/telegramUpdateOffset are
  // explicitly nulled on every save, including a resave of an
  // already-connected row - a rotated token may belong to a different bot,
  // so a stale chat_id must never carry over; the user goes through /start
  // again, which is the safe behavior.
  async upsertTelegramWebhook(userId: string, botToken: string): Promise<NotificationWebhookDto> {
    let username: string;
    try {
      ({ username } = await getTelegramBotInfo(botToken));
    } catch {
      throw new BadRequestException('Invalid Telegram bot token');
    }

    await this.prisma.notificationWebhook.upsert({
      where: { userId_channel: { userId, channel: NotificationChannel.TELEGRAM } },
      create: {
        userId,
        channel: NotificationChannel.TELEGRAM,
        url: encryptWebhookUrl(botToken),
        telegramBotUsername: username,
      },
      update: {
        url: encryptWebhookUrl(botToken),
        telegramBotUsername: username,
        chatId: null,
        telegramUpdateOffset: null,
      },
    });

    return {
      channel: NotificationChannel.TELEGRAM,
      configured: false,
      pending: true,
      telegramBotUsername: username,
    };
  }

  async deleteWebhook(userId: string, channel: NotificationChannel): Promise<void> {
    if (channel === NotificationChannel.IN_APP) {
      throw new BadRequestException('IN_APP has no external destination to configure');
    }

    // Same "absence is a fine, ordinary end state" posture as every other
    // delete in this codebase - not an error if there was nothing to
    // delete (deleteMany, not delete, so a missing row never 404s). TELEGRAM
    // goes through this same generic path unchanged - clears the whole row,
    // including chatId/telegramBotUsername/telegramUpdateOffset.
    await this.prisma.notificationWebhook.deleteMany({ where: { userId, channel } });
  }

  toDto(notification: Notification): NotificationDto {
    return {
      id: notification.id,
      type: notification.type as unknown as NotificationDto['type'],
      title: notification.title,
      body: notification.body,
      videoId: notification.videoId,
      clipId: notification.clipId,
      metadata: (notification.metadata as unknown as Record<string, unknown> | null) ?? null,
      readAt: notification.readAt ? notification.readAt.toISOString() : null,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
