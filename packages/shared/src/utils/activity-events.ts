import { ActivityEventType } from '../types/dashboard';

function assertNever(value: never): never {
  throw new Error(`Unhandled ActivityEventType: ${JSON.stringify(value)}`);
}

export interface ActivityEventDescription {
  // Fixed Indonesian action phrase for this event type ("Video diunggah",
  // "Klip baru berhasil dibuat", ...) - never varies per row.
  title: string;
  // The variable part (a video title, an invitee email, a workspace name) -
  // null when the event type carries none (CLIP_GENERATED/CLIP_EXPORTED).
  description: string | null;
}

// Activity Timeline v2 - moved here (from apps/web/lib/activity-events.ts)
// so packages/database's recordActivityEvent can denormalize title/
// description onto ActivityEvent at write time (the prerequisite for real
// server-side search - see ActivityEvent.title's own schema comment), while
// apps/web keeps rendering the exact same text via one shared source of
// truth instead of two copies drifting apart. Pure and framework-free, same
// "small reusable utility, no enclosing framework" shape as this file's
// siblings (alert-conditions.ts, duration.ts). Deliberately takes the raw
// metadata shape (not a typed per-event-type union - ActivityEvent.metadata
// is stored as loose Json) and defensively narrows each field itself, same
// posture apps/web/lib/activity-events.ts's original version already had.
export function describeActivityEvent(
  type: ActivityEventType,
  metadata: Record<string, unknown> | null | undefined,
): ActivityEventDescription {
  switch (type) {
    case ActivityEventType.VIDEO_UPLOADED: {
      const title = typeof metadata?.title === 'string' ? metadata.title : 'video tanpa judul';
      return { title: 'Video diunggah', description: title };
    }
    case ActivityEventType.CLIP_GENERATED:
      return { title: 'Klip baru berhasil dibuat', description: null };
    case ActivityEventType.CLIP_EXPORTED:
      return { title: 'Klip diunduh', description: null };
    case ActivityEventType.MEMBER_INVITED: {
      const email = typeof metadata?.email === 'string' ? metadata.email : '';
      return { title: 'Mengundang', description: email || null };
    }
    case ActivityEventType.WORKSPACE_DELETED: {
      const name = typeof metadata?.name === 'string' ? metadata.name : 'workspace';
      return { title: 'Menghapus workspace', description: name };
    }
    default:
      return assertNever(type);
  }
}
