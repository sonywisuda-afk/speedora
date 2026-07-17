import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { NotificationsService } from './notifications.service';

const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

// Same "invalid/missing query param falls back to a default rather than
// throwing" posture as DashboardController's own parseLimit.
function parseLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(parsed)));
}

// Notification Center Sprint 4A. /notifications/unread-count and
// /notifications/read-all never collide with /notifications/:id/read -
// different segment counts, so registration order doesn't matter here
// (unlike ExportController's bare-/export vs /export/:id case).
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: SafeUser, @Query('limit') limit?: string) {
    return this.notificationsService.list(user.id, parseLimit(limit, DEFAULT_LIMIT));
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: SafeUser) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: SafeUser) {
    return this.notificationsService.markAllRead(user.id);
  }

  // Sprint 4B. Declared before the dynamic @Patch(':id/read') below - same
  // "specific literal routes before dynamic-param routes" convention
  // ExportController.list() follows relative to its own @Get(':id').
  @Get('preferences')
  getPreferences(@CurrentUser() user: SafeUser) {
    return this.notificationsService.getPreferences(user.id);
  }

  @Patch('preferences/:type')
  updatePreference(
    @CurrentUser() user: SafeUser,
    @Param('type') type: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.notificationsService.updatePreference(user.id, type, dto);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.notificationsService.markRead(id, user.id);
  }
}
