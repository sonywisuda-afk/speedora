import type { NotificationType, Prisma, PrismaClient } from './generated/prisma/client';

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

  await prisma.notification.create({
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
}
