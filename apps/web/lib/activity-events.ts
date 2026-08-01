import { Download, Film, Trash2, UploadCloud, UserPlus, type LucideIcon } from 'lucide-react';
import { ActivityEventType, type ActivityEventDto } from '@speedora/shared';

// Dashboard Redesign Sprint 1-2 - the client-side half of the
// ActivityEventType registry (icon needs lucide-react, so it can't live in
// packages/shared) - same split as lib/notification-definitions.ts's
// NOTIFICATION_ICONS. Record<ActivityEventType, ...> means the compiler
// itself rejects a build that adds a new ActivityEventType without an entry
// here - see describeActivityEvent's assertNever below for the matching
// guarantee on the dynamic-text side, which a plain Record can't express.
export const ACTIVITY_ICONS: Record<ActivityEventType, LucideIcon> = {
  [ActivityEventType.VIDEO_UPLOADED]: UploadCloud,
  [ActivityEventType.CLIP_GENERATED]: Film,
  [ActivityEventType.CLIP_EXPORTED]: Download,
  [ActivityEventType.MEMBER_INVITED]: UserPlus,
  [ActivityEventType.WORKSPACE_DELETED]: Trash2,
};

function assertNever(value: never): never {
  throw new Error(`Unhandled ActivityEventType: ${JSON.stringify(value)}`);
}

// One free-form sentence per event, built from metadata - unlike
// NotificationDto (server-generated title/body), ActivityEventDto only
// carries structured metadata, so the sentence is assembled client-side. The
// switch below has no `default` case - a new ActivityEventType member that
// falls through to the bottom without a `case` fails to compile at the
// assertNever call (its argument stops being `never`), instead of silently
// returning undefined at runtime the way a bare switch without
// noImplicitReturns would.
export function describeActivityEvent(event: ActivityEventDto): string {
  const title =
    typeof event.metadata?.title === 'string' ? event.metadata.title : 'video tanpa judul';
  switch (event.type) {
    case ActivityEventType.VIDEO_UPLOADED:
      return `Video diunggah: ${title}`;
    case ActivityEventType.CLIP_GENERATED:
      return 'Klip baru berhasil dibuat';
    case ActivityEventType.CLIP_EXPORTED:
      return 'Klip diunduh';
    case ActivityEventType.MEMBER_INVITED: {
      const email = typeof event.metadata?.email === 'string' ? event.metadata.email : '';
      return `Mengundang ${email}`;
    }
    case ActivityEventType.WORKSPACE_DELETED: {
      const name = typeof event.metadata?.name === 'string' ? event.metadata.name : 'workspace';
      return `Menghapus workspace: ${name}`;
    }
    default:
      return assertNever(event.type);
  }
}

// Runtime-only safety net for a live frontend/backend version skew (e.g. the
// API starts recording a new ActivityEventType mid-deploy, before this
// bundle is rebuilt) - lets ActivityTimeline degrade to a generic row
// instead of crashing on an event.type it doesn't recognize yet. NOT a
// substitute for the compile-time checks above: ACTIVITY_ICONS/
// describeActivityEvent still fail to build the moment a real new type
// ships without an entry - this only covers the narrow window where an
// already-built frontend is still serving traffic against a newer backend.
export function isKnownActivityEventType(type: string): type is ActivityEventType {
  return (Object.values(ActivityEventType) as string[]).includes(type);
}
