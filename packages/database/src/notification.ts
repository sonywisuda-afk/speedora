import type { NotificationType, Prisma, PrismaClient } from './generated/prisma/client';

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
export async function recordNotification(
  prisma: Pick<PrismaClient, 'notification' | 'notificationPreference'>,
  params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    videoId?: string;
    clipId?: string;
    metadata?: Prisma.InputJsonValue;
  },
  deps: { publish?: PublishNotificationFn } = {},
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

  const created = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
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
}
