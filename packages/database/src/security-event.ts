import type { Prisma, PrismaClient, SecurityEventType } from './generated/prisma/client';

// Authentication Foundation Sprint 4 (Attack Protection) - inserts one
// SecurityEvent row. Same "take any Prisma client-shaped object (a real
// PrismaClient, or a `tx`)" contract as recordAuditLog/recordActivityEvent.
// Unlike recordAuditLog, failures here are swallowed (never rethrown) -
// same "never block or fail the primary action" posture as
// recordNotification's own publish/enqueueDelivery failures (see
// notification.ts) - a security event failing to log must never turn a
// successful login/logout/etc into a failed response.
export async function recordSecurityEvent(
  prisma: Pick<PrismaClient, 'securityEvent'>,
  params: {
    userId?: string | null;
    email?: string | null;
    eventType: SecurityEventType;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        userId: params.userId ?? null,
        email: params.email ?? null,
        eventType: params.eventType,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        metadata: params.metadata ?? undefined,
      },
    });
  } catch (error) {
    console.warn(`[recordSecurityEvent] failed to log ${params.eventType}`, error);
  }
}
