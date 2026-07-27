import {
  Prisma,
  NotificationCategory,
  NotificationPriority,
  type NotificationThreadStatus,
  type NotificationType,
  type PrismaClient,
} from './generated/prisma/client';

// Milestone 04c - a single shared channel (userId embedded in the payload,
// filtered per-connection by whoever subscribes) rather than per-user
// channels: avoids ioredis's subscribe-mode connection restriction turning
// into per-connection subscribe/unsubscribe lifecycle management, for no
// real benefit at this app's scale. Lives here (not packages/shared) since
// packages/database is the one package already shared between apps/api and
// apps/worker for notification concerns - the browser never needs this
// constant/type, it only receives a JSON payload over SSE and treats it as
// an opaque "something changed, refetch" signal.
export const NOTIFICATION_REALTIME_CHANNEL = 'notifications:events';

export interface NotificationPublishEvent {
  userId: string;
  notificationId: string;
  type: NotificationType;
}

export type PublishNotificationFn = (event: NotificationPublishEvent) => void | Promise<void>;

// Milestone 04d - the outbound-delivery counterpart to PublishNotificationFn.
// Deliberately id-only (same "DB row is truth" convention as every other
// job payload in this codebase) rather than carrying channel/preference
// details - the notification-delivery worker resolves "which channels are
// actually enabled + configured for this user/type" itself at process time,
// keeping this function's own contract (and every existing call site) fully
// unaware of SLACK/DISCORD/WEBHOOK specifics.
export type EnqueueDeliveryFn = (event: { notificationId: string }) => void | Promise<void>;

// Notification Center v2 - the static NotificationType -> Category/Priority
// derivation table (schema.prisma's migration backfill uses the equivalent
// SQL CASE for pre-existing rows; this is the runtime source of truth for
// every write from here on). Grown incrementally, one entry per
// NotificationType, same discipline as NOTIFICATION_ICONS/
// NOTIFICATION_TYPE_LABELS in apps/web/lib/notification-definitions.ts - a
// missing entry is a compile error via the Record type, not a silent gap.
export const NOTIFICATION_TYPE_CATEGORY: Record<NotificationType, NotificationCategory> = {
  UPLOAD_COMPLETE: NotificationCategory.UPLOAD,
  CLIP_READY: NotificationCategory.CLIP_GENERATION,
  EXPORT_READY: NotificationCategory.RENDERING,
  RENDER_FAILED: NotificationCategory.ERRORS,
  STORAGE_WARNING: NotificationCategory.SYSTEM,
  CREDIT_WARNING: NotificationCategory.BILLING,
  SYNC_FAILURE_WARNING: NotificationCategory.PUBLISHING,
  COMMENT: NotificationCategory.WORKSPACE,
  MENTION: NotificationCategory.WORKSPACE,
  REVIEW_REQUEST: NotificationCategory.WORKSPACE,
  APPROVAL: NotificationCategory.WORKSPACE,
  MEMBER_INVITATION_ACCEPTED: NotificationCategory.WORKSPACE,
  // Notification Center v2 Phase 2 - a default only; every real call site
  // (see derivePipelineThreadPresentation() in video-status.ts) passes an
  // explicit `category` override reflecting the pipeline's REAL current
  // stage (UPLOAD/AI_PROCESSING/CLIP_GENERATION/RENDERING), since a single
  // thread legitimately moves through multiple categories over its
  // lifetime - a static per-type category (recordThreadNotification's
  // fallback when no override is given) can't express that.
  PIPELINE_PROGRESS: NotificationCategory.AI_PROCESSING,
};

// Default priority per type - overridable per-call (params.priority) for
// types whose real severity depends on an outcome, not just the type (e.g.
// APPROVAL: SUCCESS/WARNING/ERROR depending on the reviewer's decision).
export const NOTIFICATION_TYPE_PRIORITY: Record<NotificationType, NotificationPriority> = {
  UPLOAD_COMPLETE: NotificationPriority.INFO,
  CLIP_READY: NotificationPriority.SUCCESS,
  EXPORT_READY: NotificationPriority.SUCCESS,
  RENDER_FAILED: NotificationPriority.ERROR,
  STORAGE_WARNING: NotificationPriority.WARNING,
  CREDIT_WARNING: NotificationPriority.WARNING,
  SYNC_FAILURE_WARNING: NotificationPriority.WARNING,
  COMMENT: NotificationPriority.INFO,
  MENTION: NotificationPriority.INFO,
  REVIEW_REQUEST: NotificationPriority.INFO,
  APPROVAL: NotificationPriority.SUCCESS,
  MEMBER_INVITATION_ACCEPTED: NotificationPriority.SUCCESS,
  // Notification Center v2 Phase 2 - a non-terminal progress update is
  // always informational; the two terminal outcomes reuse CLIP_READY
  // (SUCCESS)/RENDER_FAILED (ERROR) instead of this type - see
  // derivePipelineThreadPresentation().
  PIPELINE_PROGRESS: NotificationPriority.INFO,
};

// Notification Center v2 Phase 5 (Preferences & Delivery) - the simplified
// preferences UI's per-category IN_APP toggle (NotificationCategoryPreference,
// schema-only since Phase 1, wired for the first time here). Deliberately a
// SEPARATE, ADDITIVE check from the existing per-type NotificationPreference
// gate below, not a replacement - a notification is suppressed if EITHER
// says disabled. WORKSPACE and ERRORS are "essential" by product decision
// (see NotificationsV2Service's own comment) and never get a preference row
// written for them by the simplified UI, so this naturally never suppresses
// them - not a special case here, just an emergent property of what the UI
// lets a user write.
//
// Fails OPEN (never suppresses) on any lookup error, INCLUDING a caller
// whose `prisma` doesn't have this table at all - every pre-Phase-5 call
// site/test keeps behaving exactly as before without needing to know this
// check exists. Only a caller that explicitly wires notificationCategoryPreference
// AND has a real disabled row there ever sees suppression - production
// behavior is real either way (the real PrismaClient always has this table).
async function isCategorySuppressed(
  prisma: Pick<PrismaClient, 'notificationCategoryPreference'>,
  userId: string,
  category: NotificationCategory,
): Promise<boolean> {
  try {
    const preference = await prisma.notificationCategoryPreference.findUnique({
      where: { userId_category_channel: { userId, category, channel: 'IN_APP' } },
    });
    return preference != null && !preference.enabled;
  } catch {
    return false;
  }
}

// Inserts one Notification row - see schema.prisma's own comment on why this
// is a separate model from ActivityEvent. Same shape/posture as
// recordActivityEvent: takes any Prisma client-shaped object (a real
// PrismaClient, or a `tx`), never catches/logs on its own - that's the
// caller's job (wrap in .catch(logger.warn) or console.warn), same "never
// let a secondary/notification write break the primary action" discipline
// as every recordActivityEvent call site.
//
// Sprint 4B - gated by NotificationPreference's IN_APP row before writing.
// Absence of a preference row = enabled (default-on), same convention the
// rest of this feature uses. Disabling IN_APP naturally also suppresses any
// toast for this type (see schema.prisma's NotificationPreference comment) -
// nothing is ever created for NotificationBell's poll to notice.
//
// Milestone 04c - `deps.publish` is an OPTIONAL injected capability, same
// "stateless module takes an injected external dependency" shape as
// packages/reframe's DetectFacesDeps (this package stays Redis-agnostic;
// apps/api/apps/worker each supply their own real Redis-backed publisher).
// Optional (not required) so every existing call site keeps working
// unchanged until deliberately updated to pass one. A publish failure is
// caught HERE, not left to the caller's own .catch() - a DB write failure
// is a real problem (the notification wasn't recorded); a publish failure
// just means the realtime nudge didn't go out, which is exactly what the
// polling fallback exists to cover. These must never be conflated into the
// same log line/severity.
//
// Notification Center v2 Phase 5 - also gated by isCategorySuppressed()
// above (see its own comment).
export async function recordNotification(
  prisma: Pick<
    PrismaClient,
    'notification' | 'notificationPreference' | 'notificationCategoryPreference'
  >,
  params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    videoId?: string;
    clipId?: string;
    metadata?: Prisma.InputJsonValue;
    // Notification Center v2 - overrides NOTIFICATION_TYPE_PRIORITY's default
    // for this one call. Used today only by APPROVAL, whose real severity
    // depends on the reviewer's decision, not the type alone.
    priority?: NotificationPriority;
  },
  deps: { publish?: PublishNotificationFn; enqueueDelivery?: EnqueueDeliveryFn } = {},
): Promise<void> {
  const preference = await prisma.notificationPreference.findUnique({
    where: {
      userId_type_channel: {
        userId: params.userId,
        type: params.type,
        channel: 'IN_APP',
      },
    },
  });
  if (preference && !preference.enabled) return;
  if (await isCategorySuppressed(prisma, params.userId, NOTIFICATION_TYPE_CATEGORY[params.type])) {
    return;
  }

  const created = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      category: NOTIFICATION_TYPE_CATEGORY[params.type],
      priority: params.priority ?? NOTIFICATION_TYPE_PRIORITY[params.type],
      title: params.title,
      body: params.body,
      videoId: params.videoId ?? null,
      clipId: params.clipId ?? null,
      metadata: params.metadata ?? undefined,
    },
  });

  if (deps.publish) {
    try {
      await deps.publish({ userId: params.userId, notificationId: created.id, type: params.type });
    } catch (error) {
      console.warn('[recordNotification] publish failed', error);
    }
  }

  // Milestone 04d - kept as a SEPARATE try/catch from deps.publish above, not
  // merged, so an SSE publish failure can never skip enqueueing outbound
  // delivery (or vice versa). Deliberately does not look up SLACK/DISCORD/
  // WEBHOOK preference rows itself - unconditionally enqueues whenever wired,
  // same "let the consumer resolve applicability" posture as deps.publish
  // (which always fires regardless of who's actually subscribed over SSE).
  if (deps.enqueueDelivery) {
    try {
      await deps.enqueueDelivery({ notificationId: created.id });
    } catch (error) {
      console.warn('[recordNotification] enqueueDelivery failed', error);
    }
  }
}

// Notification Center v2 (Phase 1) - shared anti-spam delivery gate for both
// recordThreadNotification and recordGroupedNotification below.
// deps.publish (SSE/in-app) fires on every call - that's what makes live
// progress work. deps.enqueueDelivery (Slack/Discord/Telegram/Webhook) only
// fires when this call created the representative row, or priority is
// ERROR/CRITICAL, or the caller passes terminal:true - a progress bump
// never pings an external channel; only the first occurrence and the
// terminal outcome do.
async function publishAndMaybeDeliver(args: {
  deps: { publish?: PublishNotificationFn; enqueueDelivery?: EnqueueDeliveryFn };
  userId: string;
  notification: { id: string };
  type: NotificationType;
  priority: NotificationPriority;
  created: boolean;
  terminal?: boolean;
  callerLabel: string;
}): Promise<void> {
  const { deps, userId, notification, type, priority, created, terminal, callerLabel } = args;

  if (deps.publish) {
    try {
      await deps.publish({ userId, notificationId: notification.id, type });
    } catch (error) {
      console.warn(`[${callerLabel}] publish failed`, error);
    }
  }

  const shouldDeliver =
    created ||
    priority === NotificationPriority.ERROR ||
    priority === NotificationPriority.CRITICAL ||
    terminal === true;
  if (deps.enqueueDelivery && shouldDeliver) {
    try {
      await deps.enqueueDelivery({ notificationId: notification.id });
    } catch (error) {
      console.warn(`[${callerLabel}] enqueueDelivery failed`, error);
    }
  }
}

// Notification Center v2 (Phase 1) - upserts the ONE representative
// Notification row for a thread or group (never both - `fk` is exactly one
// of threadId/groupId). Reuses alert-engine.ts's own "attempt create, catch
// the unique violation, update instead" idiom, relying on
// Notification's @@unique([threadId])/@@unique([groupId]) constraints (see
// schema.prisma) for the same database-level guarantee
// recordOrUpdateGroupedNotification's single-table groupKey design used to
// rely on.
async function upsertRepresentativeNotification(
  prisma: Pick<PrismaClient, 'notification'>,
  args: {
    userId: string;
    type: NotificationType;
    category: NotificationCategory;
    priority: NotificationPriority;
    title: string;
    body: string;
    videoId: string | null;
    clipId: string | null;
    metadata?: Prisma.InputJsonValue;
    resurface: boolean;
    fk: { threadId: string } | { groupId: string };
  },
): Promise<{ notification: { id: string }; created: boolean }> {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId: args.userId,
        type: args.type,
        category: args.category,
        priority: args.priority,
        title: args.title,
        body: args.body,
        videoId: args.videoId,
        clipId: args.clipId,
        metadata: args.metadata ?? undefined,
        ...args.fk,
      },
    });
    return { notification, created: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    const notification = await prisma.notification.update({
      where: args.fk,
      data: {
        title: args.title,
        body: args.body,
        priority: args.priority,
        metadata: args.metadata ?? undefined,
        ...(args.resurface ? { readAt: null, archivedAt: null } : {}),
      },
    });
    return { notification, created: false };
  }
}

// Notification Center v2 (Phase 1) - the per-video pipeline thread write
// path (Smart Timeline header). One NotificationThread row per
// (userId, threadKey) - deterministically `PIPELINE:<videoId>` for every
// caller today - fronting exactly one representative Notification row via
// the unique threadId FK. The detailed per-stage list itself is never
// stored here - see notification-timeline.ts's computePipelineTimeline,
// which derives it at read time from VideoStatusEvent. `status` is the
// thread's own coarse aggregate (IN_PROGRESS/COMPLETED/FAILED), supplied by
// the caller from data that already exists (e.g. the video's current
// VideoStatus), never invented here.
export async function recordThreadNotification(
  prisma: Pick<
    PrismaClient,
    | 'notification'
    | 'notificationThread'
    | 'notificationPreference'
    | 'notificationCategoryPreference'
  >,
  params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    threadKey: string;
    status: NotificationThreadStatus;
    videoId?: string;
    clipId?: string;
    priority?: NotificationPriority;
    // Notification Center v2 Phase 2 - overrides NOTIFICATION_TYPE_CATEGORY's
    // default for this one call. A single thread legitimately moves through
    // several real categories over its lifetime (UPLOAD -> AI_PROCESSING ->
    // CLIP_GENERATION -> RENDERING) - see
    // derivePipelineThreadPresentation() in video-status.ts, which always
    // supplies this explicitly.
    category?: NotificationCategory;
    metadata?: Prisma.InputJsonValue;
    // Resurfaces the thread (clears archivedAt on the thread, readAt/
    // archivedAt on the representative notification) on update - default
    // true, same "an updated thread comes back to the top, unread" behavior
    // a Slack/GitHub thread has. Set false for a purely cosmetic bump that
    // shouldn't reopen something the user already archived.
    resurface?: boolean;
    // Forces outbound delivery even though this call updated (not created)
    // the representative row - the terminal event of a thread (success or
    // failure) should still notify Slack/Discord/Telegram/Webhook even
    // though the row already existed from an earlier progress bump.
    terminal?: boolean;
  },
  deps: { publish?: PublishNotificationFn; enqueueDelivery?: EnqueueDeliveryFn } = {},
): Promise<{ notification: { id: string }; thread: { id: string }; created: boolean }> {
  const preference = await prisma.notificationPreference.findUnique({
    where: {
      userId_type_channel: { userId: params.userId, type: params.type, channel: 'IN_APP' },
    },
  });
  if (preference && !preference.enabled) {
    return { notification: { id: '' }, thread: { id: '' }, created: false };
  }

  const category = params.category ?? NOTIFICATION_TYPE_CATEGORY[params.type];
  if (await isCategorySuppressed(prisma, params.userId, category)) {
    return { notification: { id: '' }, thread: { id: '' }, created: false };
  }

  const priority = params.priority ?? NOTIFICATION_TYPE_PRIORITY[params.type];
  const resurface = params.resurface ?? true;

  let thread: { id: string };
  try {
    thread = await prisma.notificationThread.create({
      data: {
        userId: params.userId,
        key: params.threadKey,
        videoId: params.videoId ?? null,
        title: params.title,
        status: params.status,
        lastActivityAt: new Date(),
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    thread = await prisma.notificationThread.update({
      where: { userId_key: { userId: params.userId, key: params.threadKey } },
      data: {
        title: params.title,
        status: params.status,
        lastActivityAt: new Date(),
        ...(resurface ? { archivedAt: null } : {}),
      },
    });
  }

  const { notification, created } = await upsertRepresentativeNotification(prisma, {
    userId: params.userId,
    type: params.type,
    category,
    priority,
    title: params.title,
    body: params.body,
    videoId: params.videoId ?? null,
    clipId: params.clipId ?? null,
    metadata: params.metadata,
    resurface,
    fk: { threadId: thread.id },
  });

  await publishAndMaybeDeliver({
    deps,
    userId: params.userId,
    notification,
    type: params.type,
    priority,
    created,
    terminal: params.terminal,
    callerLabel: 'recordThreadNotification',
  });

  return { notification, thread, created };
}

// Notification Center v2 (Phase 1) - the flat dedup write path for repeated
// identical events that are NOT a per-video pipeline (e.g. repeated
// STORAGE_WARNING, repeated SYNC_FAILURE_WARNING). One NotificationGroup row
// per (userId, groupKey), fronting exactly one representative Notification
// row via the unique groupId FK - same mechanics as
// recordThreadNotification above, minus the sub-timeline concept.
export async function recordGroupedNotification(
  prisma: Pick<
    PrismaClient,
    | 'notification'
    | 'notificationGroup'
    | 'notificationPreference'
    | 'notificationCategoryPreference'
  >,
  params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    groupKey: string;
    videoId?: string;
    clipId?: string;
    priority?: NotificationPriority;
    metadata?: Prisma.InputJsonValue;
    resurface?: boolean;
    terminal?: boolean;
  },
  deps: { publish?: PublishNotificationFn; enqueueDelivery?: EnqueueDeliveryFn } = {},
): Promise<{ notification: { id: string }; group: { id: string }; created: boolean }> {
  const preference = await prisma.notificationPreference.findUnique({
    where: {
      userId_type_channel: { userId: params.userId, type: params.type, channel: 'IN_APP' },
    },
  });
  if (preference && !preference.enabled) {
    return { notification: { id: '' }, group: { id: '' }, created: false };
  }

  const category = NOTIFICATION_TYPE_CATEGORY[params.type];
  if (await isCategorySuppressed(prisma, params.userId, category)) {
    return { notification: { id: '' }, group: { id: '' }, created: false };
  }

  const priority = params.priority ?? NOTIFICATION_TYPE_PRIORITY[params.type];
  const resurface = params.resurface ?? true;

  let group: { id: string };
  try {
    group = await prisma.notificationGroup.create({
      data: {
        userId: params.userId,
        key: params.groupKey,
        occurrenceCount: 1,
        firstOccurredAt: new Date(),
        lastOccurredAt: new Date(),
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    group = await prisma.notificationGroup.update({
      where: { userId_key: { userId: params.userId, key: params.groupKey } },
      data: {
        occurrenceCount: { increment: 1 },
        lastOccurredAt: new Date(),
        ...(resurface ? { archivedAt: null } : {}),
      },
    });
  }

  const { notification, created } = await upsertRepresentativeNotification(prisma, {
    userId: params.userId,
    type: params.type,
    category,
    priority,
    title: params.title,
    body: params.body,
    videoId: params.videoId ?? null,
    clipId: params.clipId ?? null,
    metadata: params.metadata,
    resurface,
    fk: { groupId: group.id },
  });

  await publishAndMaybeDeliver({
    deps,
    userId: params.userId,
    notification,
    type: params.type,
    priority,
    created,
    terminal: params.terminal,
    callerLabel: 'recordGroupedNotification',
  });

  return { notification, group, created };
}

// Notification Center v2 (Phase 1) - a real per-(notification, user) read
// audit trail (see NotificationReadReceipt's own comment in schema.prisma
// for why this is additive to, not a replacement for, Notification.readAt).
// Upsert, not create-then-catch - re-marking an already-read notification
// just refreshes readAt, same idempotent posture as
// NotificationsService.markRead's updateMany.
export async function recordReadReceipt(
  prisma: Pick<PrismaClient, 'notificationReadReceipt'>,
  params: { notificationId: string; userId: string },
): Promise<void> {
  await prisma.notificationReadReceipt.upsert({
    where: {
      notificationId_userId: { notificationId: params.notificationId, userId: params.userId },
    },
    create: { notificationId: params.notificationId, userId: params.userId },
    update: { readAt: new Date() },
  });
}

// Notification Center v2 - lifecycle/retention. Auto-archives read,
// non-archived notifications past the given age (default read via
// NOTIFICATION_AUTO_ARCHIVE_DAYS in the worker that calls this), and
// separately purges already-archived notifications past a longer retention
// window - the practical answer to unbounded table growth, not exotic
// indexing. See notification-expiry.worker.ts, the sole caller of both.
export async function autoArchiveStaleNotifications(
  prisma: Pick<PrismaClient, 'notification'>,
  olderThanDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await prisma.notification.updateMany({
    where: { archivedAt: null, readAt: { not: null, lt: cutoff } },
    data: { archivedAt: new Date() },
  });
  return result.count;
}

export async function purgeExpiredNotifications(
  prisma: Pick<PrismaClient, 'notification'>,
  retentionDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.notification.deleteMany({
    where: { archivedAt: { not: null, lt: cutoff } },
  });
  return result.count;
}
