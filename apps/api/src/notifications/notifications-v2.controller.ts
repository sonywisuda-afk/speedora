import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationChannel } from '@speedora/database';
import {
  NotificationCategoryV2,
  NotificationPriorityV2,
  PreferenceCategoryGroupV2,
  type NotificationV2BulkActionRequest,
  type NotificationV2StateFilter,
  type UpdateNotificationChannelPreferenceV2Dto,
  type UpdateNotificationInAppPreferenceV2Dto,
} from '@speedora/shared';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsV2Service } from './notifications-v2.service';

// Notification Center v2 Phase 3 (API Layer) - a SEPARATE controller at
// /notifications/v2/*, not new routes bolted onto NotificationsController.
// V1's /notifications/* controller/routes are completely untouched by this
// phase - existing frontend clients keep working exactly as they do today.
// This mounts the new Smart Timeline/dedup/filter/search/bulk-action surface
// alongside it, additive only.
@Controller('notifications/v2')
@UseGuards(JwtAuthGuard)
export class NotificationsV2Controller {
  constructor(private readonly notificationsV2Service: NotificationsV2Service) {}

  // Specific literal routes (unread-count, read-all, read, archive) are
  // declared before the dynamic :threadId route below - same
  // "specific-before-dynamic" convention NotificationsController's own
  // preferences/webhooks routes already follow relative to its :id/read.
  @Get('unread-count')
  unreadCount(@CurrentUser() user: SafeUser) {
    return this.notificationsV2Service.unreadCount(user.id);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: SafeUser) {
    return this.notificationsV2Service.markAllRead(user.id);
  }

  @Patch('read')
  markRead(@CurrentUser() user: SafeUser, @Body() dto: NotificationV2BulkActionRequest) {
    return this.notificationsV2Service.markRead(user.id, dto.ids ?? []);
  }

  @Patch('archive')
  archive(@CurrentUser() user: SafeUser, @Body() dto: NotificationV2BulkActionRequest) {
    return this.notificationsV2Service.archive(user.id, dto.ids ?? []);
  }

  @Delete()
  remove(@CurrentUser() user: SafeUser, @Body() dto: NotificationV2BulkActionRequest) {
    return this.notificationsV2Service.remove(user.id, dto.ids ?? []);
  }

  @Get('threads/:threadId')
  threadDetail(@CurrentUser() user: SafeUser, @Param('threadId') threadId: string) {
    return this.notificationsV2Service.threadDetail(user.id, threadId);
  }

  // Notification Center v2 Phase 5 (Preferences & Delivery) - the
  // simplified preferences UI's own 3 routes. Declared before the bare
  // @Get()/list() route below for the same specific-before-dynamic reason
  // as threads/:threadId, though 'preferences' as a literal first segment
  // can't actually collide with it regardless of order.
  @Get('preferences')
  getPreferences(@CurrentUser() user: SafeUser) {
    return this.notificationsV2Service.getPreferences(user.id);
  }

  @Patch('preferences/in-app/:group')
  updateInAppPreference(
    @CurrentUser() user: SafeUser,
    @Param('group') group: string,
    @Body() dto: UpdateNotificationInAppPreferenceV2Dto,
  ) {
    if (!Object.values(PreferenceCategoryGroupV2).includes(group as PreferenceCategoryGroupV2)) {
      throw new BadRequestException(`Invalid preference group: ${group}`);
    }
    return this.notificationsV2Service.updateInAppPreference(
      user.id,
      group as PreferenceCategoryGroupV2,
      dto.enabled,
    );
  }

  @Patch('preferences/channel/:channel')
  updateChannelPreference(
    @CurrentUser() user: SafeUser,
    @Param('channel') channel: string,
    @Body() dto: UpdateNotificationChannelPreferenceV2Dto,
  ) {
    if (!Object.values(NotificationChannel).includes(channel as NotificationChannel)) {
      throw new BadRequestException(`Invalid notification channel: ${channel}`);
    }
    return this.notificationsV2Service.updateChannelPreference(
      user.id,
      channel as NotificationChannel,
      dto.enabled,
    );
  }

  @Get()
  list(
    @CurrentUser() user: SafeUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('state') state?: string,
    @Query('category') category?: string,
    @Query('priority') priority?: string,
    @Query('q') q?: string,
  ) {
    return this.notificationsV2Service.list(user.id, {
      cursor,
      limit: limit !== undefined ? Number(limit) : undefined,
      state: this.resolveState(state),
      category: this.resolveCategory(category),
      priority: this.resolvePriority(priority),
      q,
    });
  }

  // Invalid/missing query params degrade to "no filter" rather than
  // throwing - same posture as NotificationsController.resolveChannel for a
  // read-only query param.
  private resolveState(raw: string | undefined): NotificationV2StateFilter | undefined {
    if (raw === 'unread' || raw === 'archived' || raw === 'all') return raw;
    return undefined;
  }

  private resolveCategory(raw: string | undefined): NotificationCategoryV2 | undefined {
    if (raw && Object.values(NotificationCategoryV2).includes(raw as NotificationCategoryV2)) {
      return raw as NotificationCategoryV2;
    }
    return undefined;
  }

  private resolvePriority(raw: string | undefined): NotificationPriorityV2 | undefined {
    if (raw && Object.values(NotificationPriorityV2).includes(raw as NotificationPriorityV2)) {
      return raw as NotificationPriorityV2;
    }
    return undefined;
  }
}
