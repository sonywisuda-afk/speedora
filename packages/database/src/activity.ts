import {
  ActivityEventType as SharedActivityEventType,
  describeActivityEvent,
} from '@speedora/shared';
import type { ActivityEventType, Prisma, PrismaClient } from './generated/prisma/client';

function assertNever(value: never): never {
  throw new Error(`Unhandled ActivityEventType: ${JSON.stringify(value)}`);
}

// Prisma's ActivityEventType (generated from schema.prisma, a plain
// string-literal union) and packages/shared's ActivityEventType (a real
// enum) are nominally distinct types with identical runtime string values -
// this is the one place that bridges them, moved in from
// apps/api/src/dashboard/dashboard.service.ts (Activity Timeline v2) so
// BOTH the read path (dashboard.service.ts, still imports this) and this
// write path share one mapper instead of two copies. The switch has no
// `default` case: adding a new member to schema.prisma's enum widens the
// parameter type here, and the assertNever call fails to compile until a
// matching case (and, by necessity, a matching packages/shared
// ActivityEventType member) is added.
export function mapActivityEventType(type: ActivityEventType): SharedActivityEventType {
  switch (type) {
    case 'VIDEO_UPLOADED':
      return SharedActivityEventType.VIDEO_UPLOADED;
    case 'CLIP_GENERATED':
      return SharedActivityEventType.CLIP_GENERATED;
    case 'CLIP_EXPORTED':
      return SharedActivityEventType.CLIP_EXPORTED;
    case 'MEMBER_INVITED':
      return SharedActivityEventType.MEMBER_INVITED;
    case 'WORKSPACE_DELETED':
      return SharedActivityEventType.WORKSPACE_DELETED;
    default:
      return assertNever(type);
  }
}

// Inserts one ActivityEvent row - the Dashboard's user-facing activity feed
// (Sprint 1-2, Dashboard Redesign). Distinct from video-status.ts's
// VideoStatusEvent, which is an internal pipeline audit trail keyed on
// Video.status transitions alone - this is a coarser feed of things the
// Dashboard shows ("Video uploaded", "Clip generated", ...), written from a
// handful of call sites (VideosService, render-clip.worker.ts,
// ClipsController's download route, WorkspaceService's invite/delete
// routes). Takes any Prisma client-shaped object (a real PrismaClient, or a
// `tx`) so callers can compose this into their own transaction the same way
// recordVideoStatusEvent does.
//
// Activity Timeline v2 - title/description are computed HERE (via
// mapActivityEventType + packages/shared's describeActivityEvent) rather
// than at each of the 7 call sites, so a future 8th call site can't forget
// the step and every row gets real, searchable text (see ActivityEvent.
// title's own schema comment for why denormalizing this at write time is
// the whole point).
export async function recordActivityEvent(
  prisma: Pick<PrismaClient, 'activityEvent'>,
  params: {
    userId: string;
    type: ActivityEventType;
    videoId?: string;
    clipId?: string;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  const { title, description } = describeActivityEvent(
    mapActivityEventType(params.type),
    (params.metadata as Record<string, unknown> | null | undefined) ?? null,
  );

  await prisma.activityEvent.create({
    data: {
      userId: params.userId,
      type: params.type,
      videoId: params.videoId ?? null,
      clipId: params.clipId ?? null,
      metadata: params.metadata ?? undefined,
      title,
      description,
    },
  });
}
