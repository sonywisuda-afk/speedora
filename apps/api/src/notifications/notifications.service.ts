import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Notification } from '@speedora/database';
import {
  NotificationType,
  type NotificationDto,
  type NotificationListDto,
  type NotificationPreferenceDto,
  type NotificationPreferenceListDto,
  type NotificationUnreadCountDto,
} from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';

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

  // Sprint 4B. `channel` is always IN_APP - never client-chosen, same
  // restraint as 4A only ever populating a fixed set of shipped types.
  // Always returns exactly one entry per NotificationType, defaults already
  // resolved (absence of a row = enabled: true, toast: true) - the client
  // never merges/defaults itself.
  async getPreferences(userId: string): Promise<NotificationPreferenceListDto> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId, channel: 'IN_APP' },
    });
    const byType = new Map(rows.map((row) => [row.type, row]));

    const preferences: NotificationPreferenceDto[] = Object.values(NotificationType).map((type) => {
      const row = byType.get(type);
      const config = (row?.config as { toast?: boolean } | null) ?? null;
      return {
        type,
        enabled: row?.enabled ?? true,
        toast: config?.toast ?? true,
      };
    });

    return { preferences };
  }

  // Create-on-first-write (upsert), not update-only + 404 like markRead -
  // there's no "existing preference" to require, absence is a valid,
  // fully-enabled state.
  async updatePreference(
    userId: string,
    type: string,
    dto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreferenceDto> {
    if (!Object.values(NotificationType).includes(type as NotificationType)) {
      throw new BadRequestException(`Unknown notification type: ${type}`);
    }
    const notificationType = type as NotificationType;

    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId_type_channel: { userId, type: notificationType, channel: 'IN_APP' } },
    });
    const existingConfig = (existing?.config as { toast?: boolean } | null) ?? {};
    const enabled = dto.enabled ?? existing?.enabled ?? true;
    const toast = dto.toast ?? existingConfig.toast ?? true;

    const row = await this.prisma.notificationPreference.upsert({
      where: { userId_type_channel: { userId, type: notificationType, channel: 'IN_APP' } },
      create: { userId, type: notificationType, channel: 'IN_APP', enabled, config: { toast } },
      update: { enabled, config: { toast } },
    });

    return {
      type: row.type as unknown as NotificationType,
      enabled: row.enabled,
      toast,
    };
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
