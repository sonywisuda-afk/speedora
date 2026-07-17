import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationSubscriberService } from '../redis-pubsub/notification-subscriber.service';
import { matchesUser, toMessageEvent } from '../redis-pubsub/notification-realtime.util';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { NotificationsService } from './notifications.service';

const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const HEARTBEAT_MS = 20000;

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
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly subscriber: NotificationSubscriberService,
  ) {}

  // Milestone 04c - additive realtime push, existing polling endpoints below
  // are untouched. Heartbeat keeps the connection alive through any future
  // proxy/load-balancer idle timeout (none exists in this stack today,
  // cheap insurance regardless). Cleanup on client disconnect is handled by
  // Nest's own @Sse() implementation, which unsubscribes the returned
  // Observable when the HTTP response closes - this only tears down this
  // one connection's filter/map, never the shared Redis subscription
  // (NotificationSubscriberService.stream$ stays alive for every other
  // connected client).
  @Sse('stream')
  stream(@CurrentUser() user: SafeUser): Observable<MessageEvent> {
    const heartbeat$ = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ data: { type: 'heartbeat' } })),
    );
    const events$ = this.subscriber.stream$.pipe(
      filter((event) => matchesUser(event, user.id)),
      map(toMessageEvent),
    );
    return merge(events$, heartbeat$);
  }

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
