import type { ActivityDeletionAction, Prisma, PrismaClient } from './generated/prisma/client';

// Activity Timeline v2 - inserts one ActivityDeletionLog row, an
// internal-only (no DTO, no controller route) traceability trail for a user
// deleting their OWN activity history. See ActivityDeletionLog's own schema
// comment for why this is a separate model from AuditLogEntry (which is
// workspaceId-required and doesn't fit a per-user action) rather than a
// soft-delete flag on ActivityEvent itself. Same thin fire-and-forget
// wrapper shape as recordActivityEvent/recordAuditLog - callers should call
// this AFTER the delete commits (same "log after, not before" rule
// WorkspaceService.remove() already documents), never await it inline with
// the delete's own error handling.
export async function recordActivityDeletionLog(
  prisma: Pick<PrismaClient, 'activityDeletionLog'>,
  params: {
    userId: string;
    action: ActivityDeletionAction;
    deletedIds?: Prisma.InputJsonValue;
    count: number;
  },
): Promise<void> {
  await prisma.activityDeletionLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      deletedIds: params.deletedIds ?? undefined,
      count: params.count,
    },
  });
}
