import {
  Prisma,
  type NotificationType,
  type PrismaClient,
  type UserRole,
} from './generated/prisma/client';
import { recordNotification, type PublishNotificationFn } from './notification';

// Sprint 4C (Alert Engine) - one evaluated alert "instance". Both fan-out
// shapes this milestone ships collapse to the same type: a system-wide
// rule (Storage Warning) returns one instance with dedupeKey
// 'storage-warning' and recipientUserIds = every resolved ops-role user;
// a per-user rule (Credit Warning) returns one instance per scanned user
// (dedupeKey `credit-warning:${userId}`, recipientUserIds = [userId]).
// Nothing downstream (runAlertRules) needs to know which shape produced it.
export interface AlertInstance {
  dedupeKey: string;
  breached: boolean;
  // Only meaningful when breached - fine to leave empty otherwise.
  recipientUserIds: string[];
  notification: {
    type: NotificationType;
    title: string;
    body: string;
    metadata?: Prisma.InputJsonValue;
  };
}

export interface AlertRule {
  // Also the dedupeKey prefix convention this rule's instances follow -
  // not enforced by the type, just the convention every rule follows.
  name: string;
  evaluate(prisma: PrismaClient): Promise<AlertInstance[]>;
}

// Runs every registered rule, persists de-dup state in AlertState, and
// calls recordNotification() exactly once per breach (not once per tick
// the breach remains true) - re-arming (deleting the AlertState row) the
// moment a condition clears, so a later re-breach notifies again. Mirrors
// AlertStateTracker's in-memory since-reset-on-absence semantics
// (apps/api/src/monitoring/alert-state.ts), made durable across apps/worker
// restarts via Postgres instead of a process-local Map.
export async function runAlertRules(
  prisma: PrismaClient,
  rules: AlertRule[],
  deps: { publish?: PublishNotificationFn } = {},
): Promise<{ evaluated: number; notified: number }> {
  let evaluated = 0;
  let notified = 0;

  for (const rule of rules) {
    let instances: AlertInstance[];
    try {
      instances = await rule.evaluate(prisma);
    } catch (error) {
      console.warn(`[runAlertRules] rule "${rule.name}" evaluation failed`, error);
      continue;
    }

    for (const instance of instances) {
      evaluated += 1;
      const existing = await prisma.alertState.findUnique({
        where: { dedupeKey: instance.dedupeKey },
      });

      if (instance.breached) {
        if (existing) continue; // already active - no re-notify

        try {
          await prisma.alertState.create({ data: { dedupeKey: instance.dedupeKey } });
        } catch (error) {
          // Concurrent-tick race - another firing already created it first.
          // Same established check as render-clip.worker.ts's P2025
          // handling, just a different code (unique-constraint violation).
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            continue;
          }
          throw error;
        }

        for (const userId of instance.recipientUserIds) {
          await recordNotification(prisma, { userId, ...instance.notification }, deps);
          notified += 1;
        }
      } else if (existing) {
        await prisma.alertState.delete({ where: { dedupeKey: instance.dedupeKey } });
      }
    }
  }

  return { evaluated, notified };
}

// Sprint 4C's one new multi-user query shape - RolesGuard
// (apps/api/src/auth/guards/roles.guard.ts) only ever checks a single
// already-authenticated request's own role, never "every user with role
// X." Generic enough to serve any future system-wide rule that needs to
// fan out to ops users (GPU-almost-full, worker-offline), not just Storage
// Warning.
export async function findUsersByRoles(
  prisma: Pick<PrismaClient, 'user'>,
  roles: UserRole[],
): Promise<{ id: string }[]> {
  return prisma.user.findMany({ where: { role: { in: roles } }, select: { id: true } });
}
