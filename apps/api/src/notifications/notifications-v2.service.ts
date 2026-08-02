import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  fetchPipelineTimeline,
  NotificationCategory,
  NotificationChannel,
  type Notification,
  type NotificationCategory as PrismaNotificationCategory,
  type NotificationChannel as PrismaNotificationChannel,
  type NotificationPriority as PrismaNotificationPriority,
  type NotificationThreadStatus as PrismaNotificationThreadStatus,
  type NotificationType as PrismaNotificationType,
} from '@speedora/database';
import {
  NotificationActionType,
  NotificationCategoryV2,
  NotificationChannel as SharedNotificationChannel,
  NotificationPriorityV2,
  NotificationThreadStatusV2,
  NotificationType as SharedNotificationType,
  PreferenceCategoryGroupV2,
  type NotificationChannelPreferenceV2Dto,
  type NotificationChannelV2,
  type NotificationInAppPreferenceV2Dto,
  type NotificationPreferencesV2Dto,
  type NotificationThreadDetailDto,
  type NotificationTypeV2,
  type NotificationV2BulkActionResult,
  type NotificationV2Dto,
  type NotificationV2ListDto,
  type NotificationV2ListQuery,
  type NotificationV2StateFilter,
  type NotificationUnreadCountDto,
} from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function assertNever(value: never): never {
  throw new Error(`Unhandled enum value: ${JSON.stringify(value)}`);
}

// Prisma's NotificationCategory and packages/shared's V2 NotificationCategoryV2
// have identical members (unlike NotificationType, no V2-only extra value) -
// nominally distinct TS enum types even so. Replaces what used to be a blind
// `as never` cast (a different spelling of the same escape hatch as
// `as unknown as` - both bypass all type checking, `as never` because a
// value of type `never` is assignable to anything). Same Contract
// Synchronization pattern as dashboard.service.ts's mapActivityEventType.
export function mapNotificationCategoryToV2(
  category: PrismaNotificationCategory,
): NotificationCategoryV2 {
  switch (category) {
    case 'UPLOAD':
      return NotificationCategoryV2.UPLOAD;
    case 'AI_PROCESSING':
      return NotificationCategoryV2.AI_PROCESSING;
    case 'CLIP_GENERATION':
      return NotificationCategoryV2.CLIP_GENERATION;
    case 'RENDERING':
      return NotificationCategoryV2.RENDERING;
    case 'PUBLISHING':
      return NotificationCategoryV2.PUBLISHING;
    case 'ANALYTICS':
      return NotificationCategoryV2.ANALYTICS;
    case 'BILLING':
      return NotificationCategoryV2.BILLING;
    case 'WORKSPACE':
      return NotificationCategoryV2.WORKSPACE;
    case 'SYSTEM':
      return NotificationCategoryV2.SYSTEM;
    case 'ERRORS':
      return NotificationCategoryV2.ERRORS;
    default:
      return assertNever(category);
  }
}

// Reverse of mapNotificationCategoryToV2 - for narrowing a client-supplied
// (V2-typed) filter value back into a Prisma `where` clause.
export function mapNotificationCategoryV2ToPrisma(
  category: NotificationCategoryV2,
): PrismaNotificationCategory {
  switch (category) {
    case NotificationCategoryV2.UPLOAD:
      return 'UPLOAD';
    case NotificationCategoryV2.AI_PROCESSING:
      return 'AI_PROCESSING';
    case NotificationCategoryV2.CLIP_GENERATION:
      return 'CLIP_GENERATION';
    case NotificationCategoryV2.RENDERING:
      return 'RENDERING';
    case NotificationCategoryV2.PUBLISHING:
      return 'PUBLISHING';
    case NotificationCategoryV2.ANALYTICS:
      return 'ANALYTICS';
    case NotificationCategoryV2.BILLING:
      return 'BILLING';
    case NotificationCategoryV2.WORKSPACE:
      return 'WORKSPACE';
    case NotificationCategoryV2.SYSTEM:
      return 'SYSTEM';
    case NotificationCategoryV2.ERRORS:
      return 'ERRORS';
    default:
      return assertNever(category);
  }
}

// Same convention as mapNotificationCategoryToV2, for NotificationPriority
// (also a 1:1 member match with its V2 counterpart).
export function mapNotificationPriorityToV2(
  priority: PrismaNotificationPriority,
): NotificationPriorityV2 {
  switch (priority) {
    case 'INFO':
      return NotificationPriorityV2.INFO;
    case 'SUCCESS':
      return NotificationPriorityV2.SUCCESS;
    case 'WARNING':
      return NotificationPriorityV2.WARNING;
    case 'ERROR':
      return NotificationPriorityV2.ERROR;
    case 'CRITICAL':
      return NotificationPriorityV2.CRITICAL;
    default:
      return assertNever(priority);
  }
}

// Reverse of mapNotificationPriorityToV2.
export function mapNotificationPriorityV2ToPrisma(
  priority: NotificationPriorityV2,
): PrismaNotificationPriority {
  switch (priority) {
    case NotificationPriorityV2.INFO:
      return 'INFO';
    case NotificationPriorityV2.SUCCESS:
      return 'SUCCESS';
    case NotificationPriorityV2.WARNING:
      return 'WARNING';
    case NotificationPriorityV2.ERROR:
      return 'ERROR';
    case NotificationPriorityV2.CRITICAL:
      return 'CRITICAL';
    default:
      return assertNever(priority);
  }
}

// Same convention as mapNotificationCategoryToV2, for NotificationThreadStatus
// (also a 1:1 member match with its V2 counterpart).
export function mapNotificationThreadStatusToV2(
  status: PrismaNotificationThreadStatus,
): NotificationThreadStatusV2 {
  switch (status) {
    case 'IN_PROGRESS':
      return NotificationThreadStatusV2.IN_PROGRESS;
    case 'COMPLETED':
      return NotificationThreadStatusV2.COMPLETED;
    case 'FAILED':
      return NotificationThreadStatusV2.FAILED;
    default:
      return assertNever(status);
  }
}

// Prisma's NotificationChannel (8 members) widens into NotificationChannelV2
// (packages/shared's own 5-member NotificationChannel enum, PLUS the 3
// schema-only EMAIL/PUSH/DESKTOP string literals - see that type's own
// comment in notification.ts). No assertNever here: this mapper is
// deliberately total over all 8 Prisma members, so a literal switch instead
// of assertNever would be redundant - if schema.prisma ever adds a 9th
// channel, this switch's own missing-case compile error (not a thrown
// assertNever) is what catches it, same TS2366 guarantee described in the
// Contract Governance audit report.
export function mapNotificationChannelToV2(
  channel: PrismaNotificationChannel,
): NotificationChannelV2 {
  switch (channel) {
    case 'IN_APP':
      return SharedNotificationChannel.IN_APP;
    case 'SLACK':
      return SharedNotificationChannel.SLACK;
    case 'DISCORD':
      return SharedNotificationChannel.DISCORD;
    case 'WEBHOOK':
      return SharedNotificationChannel.WEBHOOK;
    case 'TELEGRAM':
      return SharedNotificationChannel.TELEGRAM;
    case 'EMAIL':
      return 'EMAIL';
    case 'PUSH':
      return 'PUSH';
    case 'DESKTOP':
      return 'DESKTOP';
  }
}

// Prisma's NotificationType (14 members, includes PIPELINE_PROGRESS) widens
// into NotificationTypeV2 (packages/shared's own 13-member NotificationType
// enum PLUS the 'PIPELINE_PROGRESS' string literal - see that type's own
// comment in notification.ts). Unlike V1's NotificationsService.
// mapNotificationType (which throws on PIPELINE_PROGRESS, a value V1 can
// never actually receive), V2 is the one surface PIPELINE_PROGRESS is
// supposed to reach - so it maps through here instead of being rejected.
export function mapNotificationTypeToV2(type: PrismaNotificationType): NotificationTypeV2 {
  switch (type) {
    case 'UPLOAD_COMPLETE':
      return SharedNotificationType.UPLOAD_COMPLETE;
    case 'CLIP_READY':
      return SharedNotificationType.CLIP_READY;
    case 'EXPORT_READY':
      return SharedNotificationType.EXPORT_READY;
    case 'RENDER_FAILED':
      return SharedNotificationType.RENDER_FAILED;
    case 'STORAGE_WARNING':
      return SharedNotificationType.STORAGE_WARNING;
    case 'CREDIT_WARNING':
      return SharedNotificationType.CREDIT_WARNING;
    case 'COMMENT':
      return SharedNotificationType.COMMENT;
    case 'MENTION':
      return SharedNotificationType.MENTION;
    case 'REVIEW_REQUEST':
      return SharedNotificationType.REVIEW_REQUEST;
    case 'APPROVAL':
      return SharedNotificationType.APPROVAL;
    case 'MEMBER_INVITATION_ACCEPTED':
      return SharedNotificationType.MEMBER_INVITATION_ACCEPTED;
    case 'SYNC_FAILURE_WARNING':
      return SharedNotificationType.SYNC_FAILURE_WARNING;
    case 'WORKSPACE_OWNERSHIP_TRANSFERRED':
      return SharedNotificationType.WORKSPACE_OWNERSHIP_TRANSFERRED;
    case 'GENERATE_MORE_NO_CANDIDATES':
      return SharedNotificationType.GENERATE_MORE_NO_CANDIDATES;
    case 'IMPORT_FAILURE_SPIKE':
      return SharedNotificationType.IMPORT_FAILURE_SPIKE;
    case 'PIPELINE_PROGRESS':
      return 'PIPELINE_PROGRESS';
    default:
      return assertNever(type);
  }
}

// Notification Center v2 Phase 5 - the simplified preferences UI's group ->
// real-category mapping (see PreferenceCategoryGroupV2's own comment in
// packages/shared for why RENDERING is deliberately a 2-category merge and
// why WORKSPACE/ERRORS have no group at all). The one place this mapping
// lives - both getPreferences (read) and updateInAppPreference (write) use
// it, so the grouping can never drift between the two directions.
const GROUP_CATEGORIES: Record<PreferenceCategoryGroupV2, NotificationCategory[]> = {
  [PreferenceCategoryGroupV2.UPLOAD]: [NotificationCategory.UPLOAD],
  [PreferenceCategoryGroupV2.PROCESSING]: [NotificationCategory.AI_PROCESSING],
  [PreferenceCategoryGroupV2.RENDERING]: [
    NotificationCategory.RENDERING,
    NotificationCategory.CLIP_GENERATION,
  ],
  [PreferenceCategoryGroupV2.PUBLISHING]: [NotificationCategory.PUBLISHING],
  [PreferenceCategoryGroupV2.ANALYTICS]: [NotificationCategory.ANALYTICS],
  [PreferenceCategoryGroupV2.BILLING]: [NotificationCategory.BILLING],
  [PreferenceCategoryGroupV2.SYSTEM]: [NotificationCategory.SYSTEM],
};

// The 4 channels with a real NotificationWebhook-backed delivery
// implementation (Phase 2/Milestone 04d/04e) - togglable via
// updateChannelPreference. EMAIL/PUSH/DESKTOP are schema-only (Phase 1) with
// no delivery implementation - always "coming soon," never togglable.
const WEBHOOK_CHANNELS: NotificationChannel[] = [
  NotificationChannel.SLACK,
  NotificationChannel.DISCORD,
  NotificationChannel.TELEGRAM,
  NotificationChannel.WEBHOOK,
];
const COMING_SOON_CHANNELS: NotificationChannel[] = [
  NotificationChannel.EMAIL,
  NotificationChannel.PUSH,
  NotificationChannel.DESKTOP,
];

// Server-supplied so this exact wording lives in exactly one place, not
// duplicated between backend and frontend - the user-facing explanation for
// why WORKSPACE/ERRORS never appear as a toggle in `inApp`.
const ESSENTIAL_NOTE =
  'Notifikasi penting (misalnya error proses dan permintaan kolaborasi) selalu dikirim dan tidak dapat dinonaktifkan agar Anda tidak melewatkan informasi penting.';

// Notification Center v2 Phase 3 (API Layer) - a SEPARATE service from
// NotificationsService (V1), not an extension of it. V1's file is untouched
// by this phase - every method here is additive, new surface backing
// GET/PATCH/DELETE /notifications/v2/* only. Shares the same PrismaService/
// Notification model (no schema duplication), just a different read/write
// shape and a richer query surface (cursor pagination, filter, search, bulk
// actions, thread detail) than V1 ever needed.
@Injectable()
export class NotificationsV2Service {
  constructor(private readonly prisma: PrismaService) {}

  parseLimit(raw: string | undefined): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.round(parsed)));
  }

  // Cursor-based, same convention as VideosService.findAll/GET /videos -
  // `limit + 1` fetched so the extra row (never returned) answers "is there
  // a next page" without a second count query; orderBy carries an `id`
  // tie-breaker so two rows with the identical updatedAt millisecond still
  // sort deterministically across pages. Ordered by updatedAt (not
  // createdAt like V1) - see Notification.updatedAt's own schema comment
  // for why V2 needs that: an updated thread must resurface to the top.
  async list(userId: string, query: NotificationV2ListQuery): Promise<NotificationV2ListDto> {
    const limit = this.parseLimit(query.limit !== undefined ? String(query.limit) : undefined);
    const state: NotificationV2StateFilter = query.state ?? 'all';
    const trimmedQuery = query.q?.trim();

    const notifications = await this.prisma.notification.findMany({
      where: {
        userId,
        ...(state === 'archived' ? { archivedAt: { not: null } } : { archivedAt: null }),
        ...(state === 'unread' ? { readAt: null } : {}),
        ...(query.category ? { category: mapNotificationCategoryV2ToPrisma(query.category) } : {}),
        ...(query.priority ? { priority: mapNotificationPriorityV2ToPrisma(query.priority) } : {}),
        ...(trimmedQuery
          ? {
              OR: [
                { title: { contains: trimmedQuery, mode: 'insensitive' as const } },
                { body: { contains: trimmedQuery, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        thread: { select: { id: true, status: true, lastActivityAt: true } },
        group: { select: { id: true, occurrenceCount: true, lastOccurredAt: true } },
      },
    });

    const hasMore = notifications.length > limit;
    const page = hasMore ? notifications.slice(0, limit) : notifications;

    return {
      notifications: page.map((notification) => this.toV2Dto(notification)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // V2's own unread count, deliberately scoped WIDER than V1's
  // (NotificationsService.unreadCount) - V1 excludes thread/group rows so
  // its already-shipped badge never changes meaning (see that method's own
  // Phase 2 comment); V2's badge is the real, full picture, since V2 is what
  // actually renders threads/groups.
  async unreadCount(userId: string): Promise<NotificationUnreadCountDto> {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null, archivedAt: null },
    });
    return { count };
  }

  // Notification Center v2 Phase 3 - finally wires notification-timeline.ts's
  // fetchPipelineTimeline() (built in Phase 1, dormant since - no API route
  // ever called it) into a real endpoint. Ownership is checked against the
  // THREAD row (not a separate lookup) - a thread belonging to a different
  // user 404s exactly like an unowned video/clip does elsewhere in this
  // codebase, never leaking existence.
  async threadDetail(userId: string, threadId: string): Promise<NotificationThreadDetailDto> {
    const thread = await this.prisma.notificationThread.findUnique({
      where: { id: threadId },
      include: { notifications: true },
    });
    if (!thread || thread.userId !== userId) {
      throw new NotFoundException(`Notification thread ${threadId} not found`);
    }

    const representative = thread.notifications[0] ?? null;
    const timeline = thread.videoId
      ? await fetchPipelineTimeline(this.prisma, thread.videoId)
      : null;

    return {
      thread: {
        id: thread.id,
        videoId: thread.videoId,
        title: thread.title,
        status: mapNotificationThreadStatusToV2(thread.status),
        lastActivityAt: thread.lastActivityAt.toISOString(),
        archivedAt: thread.archivedAt ? thread.archivedAt.toISOString() : null,
        createdAt: thread.createdAt.toISOString(),
      },
      notification: representative ? this.toV2Dto(representative) : null,
      timeline,
    };
  }

  // Every bulk action below is idempotent by construction (updateMany/
  // deleteMany over `id: { in: ids }` - re-submitting the same ids, ids
  // already in the target state, or ids that don't exist at all never
  // errors) and userId-scoped (never touches another user's rows even if a
  // malicious/stale id list is passed) - same posture as V1's markRead/
  // markAllRead.
  async markRead(userId: string, ids: string[]): Promise<NotificationV2BulkActionResult> {
    if (ids.length === 0) return { count: 0 };
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
    return { count };
  }

  async markAllRead(userId: string): Promise<NotificationV2BulkActionResult> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, archivedAt: null },
      data: { readAt: new Date() },
    });
    return { count };
  }

  async archive(userId: string, ids: string[]): Promise<NotificationV2BulkActionResult> {
    if (ids.length === 0) return { count: 0 };
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, id: { in: ids }, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return { count };
  }

  async remove(userId: string, ids: string[]): Promise<NotificationV2BulkActionResult> {
    if (ids.length === 0) return { count: 0 };
    const { count } = await this.prisma.notification.deleteMany({
      where: { userId, id: { in: ids } },
    });
    return { count };
  }

  // Notification Center v2 Phase 5 - the simplified preferences read. Every
  // group defaults to enabled: true when NO row exists for any of its
  // underlying categories yet (same "absence = enabled" convention V1's own
  // NotificationPreference already uses) - a group reads enabled only when
  // EVERY one of its underlying categories is enabled (relevant only for
  // RENDERING's 2-category merge; the other 6 groups have exactly one
  // category, so this is just that category's own value).
  async getPreferences(userId: string): Promise<NotificationPreferencesV2Dto> {
    const [categoryPreferences, webhooks] = await Promise.all([
      this.prisma.notificationCategoryPreference.findMany({
        where: { userId, channel: 'IN_APP' },
      }),
      this.prisma.notificationWebhook.findMany({
        where: { userId, channel: { in: WEBHOOK_CHANNELS } },
        select: { channel: true, enabled: true, chatId: true },
      }),
    ]);
    const categoryEnabled = new Map(categoryPreferences.map((p) => [p.category, p.enabled]));

    const inApp: NotificationInAppPreferenceV2Dto[] = Object.values(PreferenceCategoryGroupV2).map(
      (group) => ({
        group,
        enabled: GROUP_CATEGORIES[group].every((category) => categoryEnabled.get(category) ?? true),
      }),
    );

    const webhookByChannel = new Map(webhooks.map((webhook) => [webhook.channel, webhook]));
    const channels: NotificationChannelPreferenceV2Dto[] = [
      ...WEBHOOK_CHANNELS.map((channel) => {
        const row = webhookByChannel.get(channel);
        // TELEGRAM "configured" specifically means chatId is known (a
        // message can actually be sent) - same convention as V1's
        // NotificationsService.getWebhooks.
        const configured =
          channel === NotificationChannel.TELEGRAM ? (row?.chatId ?? null) != null : row != null;
        return {
          channel: mapNotificationChannelToV2(channel),
          enabled: row?.enabled ?? false,
          configured,
          comingSoon: false,
        };
      }),
      ...COMING_SOON_CHANNELS.map((channel) => ({
        channel: mapNotificationChannelToV2(channel),
        enabled: false,
        configured: false,
        comingSoon: true,
      })),
    ];

    return { inApp, channels, essentialNote: ESSENTIAL_NOTE };
  }

  async updateInAppPreference(
    userId: string,
    group: PreferenceCategoryGroupV2,
    enabled: boolean,
  ): Promise<NotificationInAppPreferenceV2Dto> {
    const categories = GROUP_CATEGORIES[group];
    if (!categories) {
      throw new BadRequestException(`Unknown preference group: ${group}`);
    }
    await Promise.all(
      categories.map((category) =>
        this.prisma.notificationCategoryPreference.upsert({
          where: { userId_category_channel: { userId, category, channel: 'IN_APP' } },
          create: { userId, category, channel: 'IN_APP', enabled },
          update: { enabled },
        }),
      ),
    );
    return { group, enabled };
  }

  // Rejects IN_APP (wrong endpoint - use updateInAppPreference) and
  // EMAIL/PUSH/DESKTOP (coming soon, nothing to toggle yet) with a clean
  // 400, same "service-level enum validation" convention V1's
  // upsertWebhook/deleteWebhook already use. Also rejects a channel that
  // isn't configured yet - toggling "Enabled" only makes sense once a real
  // destination (Slack/Discord/Telegram/Webhook URL or token) has been
  // saved through the existing (untouched) V1 webhook-connection flow; this
  // endpoint only flips the switch on an already-configured destination.
  async updateChannelPreference(
    userId: string,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<NotificationChannelPreferenceV2Dto> {
    if (!WEBHOOK_CHANNELS.includes(channel)) {
      throw new BadRequestException(
        channel === NotificationChannel.IN_APP
          ? 'Use PATCH /notifications/v2/preferences/in-app/:group for IN_APP preferences'
          : `${channel} is not available yet (coming soon)`,
      );
    }

    const existing = await this.prisma.notificationWebhook.findUnique({
      where: { userId_channel: { userId, channel } },
    });
    if (!existing) {
      throw new BadRequestException(
        `${channel} is not configured yet - connect it before enabling it`,
      );
    }

    const updated = await this.prisma.notificationWebhook.update({
      where: { userId_channel: { userId, channel } },
      data: { enabled },
    });
    const configured = channel === NotificationChannel.TELEGRAM ? updated.chatId != null : true;
    return {
      channel: mapNotificationChannelToV2(channel),
      enabled: updated.enabled,
      configured,
      comingSoon: false,
    };
  }

  // Server-computed navigation target - null when there's genuinely nowhere
  // useful to go (no videoId at all). Every route named here is a real,
  // already-shipped apps/web route (see apps/web build output's own route
  // list) - never a speculative/future path.
  private deriveDeepLink(videoId: string | null): string | null {
    return videoId ? `/videos/${videoId}/edit` : null;
  }

  // Server-derived so a new action never needs a frontend release ahead of
  // the backend capability it depends on. Every action corresponds to a
  // route/endpoint that already exists in this codebase today (Retry ->
  // POST /videos/:id/retry, Publish -> POST /clips/:id/publish, View
  // Analytics -> GET /videos/:id/performance, View Logs -> the notification's
  // own `metadata` field, already returned alongside `actions`) - the
  // frontend resolves an action type to its call using the videoId/clipId
  // already present on this same DTO, no extra lookup needed.
  private deriveActions(
    type: string,
    { videoId, clipId }: { videoId: string | null; clipId: string | null },
  ): NotificationActionType[] {
    switch (type) {
      case 'RENDER_FAILED':
        return [
          ...(videoId ? [NotificationActionType.RETRY] : []),
          NotificationActionType.VIEW_LOGS,
          NotificationActionType.DISMISS,
        ];
      case 'CLIP_READY':
        return [
          ...(clipId ? [NotificationActionType.OPEN_CLIP] : []),
          ...(!clipId && videoId ? [NotificationActionType.OPEN_VIDEO] : []),
          ...(clipId ? [NotificationActionType.PUBLISH] : []),
          ...(videoId ? [NotificationActionType.VIEW_ANALYTICS] : []),
          NotificationActionType.DISMISS,
        ];
      case 'PIPELINE_PROGRESS':
        return [
          ...(videoId ? [NotificationActionType.OPEN_VIDEO] : []),
          NotificationActionType.DISMISS,
        ];
      case 'COMMENT':
      case 'MENTION':
      case 'REVIEW_REQUEST':
      case 'APPROVAL':
        return [
          ...(videoId ? [NotificationActionType.OPEN_VIDEO] : []),
          NotificationActionType.DISMISS,
        ];
      default:
        return [NotificationActionType.DISMISS];
    }
  }

  private toV2Dto(
    notification: Notification & {
      thread?: { id: string; status: PrismaNotificationThreadStatus; lastActivityAt: Date } | null;
      group?: { id: string; occurrenceCount: number; lastOccurredAt: Date } | null;
    },
  ): NotificationV2Dto {
    return {
      id: notification.id,
      type: mapNotificationTypeToV2(notification.type),
      category: mapNotificationCategoryToV2(notification.category),
      priority: mapNotificationPriorityToV2(notification.priority),
      title: notification.title,
      body: notification.body,
      videoId: notification.videoId,
      clipId: notification.clipId,
      metadata: (notification.metadata as unknown as Record<string, unknown> | null) ?? null,
      readAt: notification.readAt ? notification.readAt.toISOString() : null,
      archivedAt: notification.archivedAt ? notification.archivedAt.toISOString() : null,
      createdAt: notification.createdAt.toISOString(),
      updatedAt: notification.updatedAt.toISOString(),
      thread: notification.thread
        ? {
            id: notification.thread.id,
            status: mapNotificationThreadStatusToV2(notification.thread.status),
            lastActivityAt: notification.thread.lastActivityAt.toISOString(),
          }
        : null,
      group: notification.group
        ? {
            id: notification.group.id,
            occurrenceCount: notification.group.occurrenceCount,
            lastOccurredAt: notification.group.lastOccurredAt.toISOString(),
          }
        : null,
      deepLink: this.deriveDeepLink(notification.videoId),
      actions: this.deriveActions(notification.type, {
        videoId: notification.videoId,
        clipId: notification.clipId,
      }),
    };
  }
}
