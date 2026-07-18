import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  Query,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { NotificationChannel } from '@speedora/shared';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationSubscriberService } from '../redis-pubsub/notification-subscriber.service';
import { matchesUser, toMessageEvent } from '../redis-pubsub/notification-realtime.util';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { UpsertNotificationWebhookDto } from './dto/upsert-notification-webhook.dto';
import { UpsertTelegramWebhookDto } from './dto/upsert-telegram-webhook.dto';
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
  // Milestone 04d - optional ?channel= query param, defaults to IN_APP
  // (existing callers keep working unchanged). Invalid values fall back to
  // IN_APP too, same "manually-parsed query param degrades to a default
  // rather than throwing" posture as parseLimit above, since this is a read.
  @Get('preferences')
  getPreferences(@CurrentUser() user: SafeUser, @Query('channel') channel?: string) {
    const resolvedChannel = this.resolveChannel(channel) ?? NotificationChannel.IN_APP;
    return this.notificationsService.getPreferences(user.id, resolvedChannel);
  }

  @Patch('preferences/:type')
  updatePreference(
    @CurrentUser() user: SafeUser,
    @Param('type') type: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.notificationsService.updatePreference(user.id, type, dto);
  }

  // Milestone 04d - Slack/Discord/generic-webhook destinations. Declared
  // before @Patch(':id/read') for the same specific-before-dynamic reason
  // as preferences above.
  @Get('webhooks')
  getWebhooks(@CurrentUser() user: SafeUser) {
    return this.notificationsService.getWebhooks(user.id);
  }

  @Put('webhooks/:channel')
  upsertWebhook(
    @CurrentUser() user: SafeUser,
    @Param('channel') channel: string,
    @Body() dto: UpsertNotificationWebhookDto,
  ) {
    return this.notificationsService.upsertWebhook(user.id, this.requireChannel(channel), dto.url);
  }

  @Delete('webhooks/:channel')
  deleteWebhook(@CurrentUser() user: SafeUser, @Param('channel') channel: string) {
    return this.notificationsService.deleteWebhook(user.id, this.requireChannel(channel));
  }

  // Milestone 04e - a dedicated route rather than reusing PUT
  // /webhooks/:channel: a bot token isn't a URL (different DTO/validation),
  // and saving one has a real external side effect (Telegram's getMe call)
  // plus a response that must carry telegramBotUsername for the "message
  // your bot" onboarding UI - forcing this through the generic path would
  // need a discriminated-union DTO and touch 3 unaffected channels for no
  // reason. Declared before @Patch(':id/read') for the same
  // specific-before-dynamic reason as every other named route above.
  @Put('telegram')
  upsertTelegram(@CurrentUser() user: SafeUser, @Body() dto: UpsertTelegramWebhookDto) {
    return this.notificationsService.upsertTelegramWebhook(user.id, dto.botToken);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.notificationsService.markRead(id, user.id);
  }

  private resolveChannel(raw: string | undefined): NotificationChannel | undefined {
    if (raw && Object.values(NotificationChannel).includes(raw as NotificationChannel)) {
      return raw as NotificationChannel;
    }
    return undefined;
  }

  // Unlike resolveChannel (a read, degrades to a default), a webhook
  // channel path param feeds a write (PUT/DELETE) - an unrecognized value
  // here must throw a clean 400 rather than reach Prisma's enum column as
  // an opaque 500 (same service-level-enum-validation convention this
  // codebase uses elsewhere, just enforced at the controller since this is
  // a path param, not a body field a DTO's @IsEnum could validate).
  // NotificationsService.upsertWebhook/deleteWebhook separately reject
  // IN_APP specifically once a syntactically valid channel reaches them.
  private requireChannel(raw: string): NotificationChannel {
    if (!Object.values(NotificationChannel).includes(raw as NotificationChannel)) {
      throw new BadRequestException(`Invalid notification channel: ${raw}`);
    }
    return raw as NotificationChannel;
  }
}
