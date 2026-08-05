import { Download, Film, Trash2, UploadCloud, UserPlus, type LucideIcon } from 'lucide-react';
import {
  ActivityEventType,
  describeActivityEvent as sharedDescribeActivityEvent,
  type ActivityEventDto,
} from '@speedora/shared';

// Dashboard Redesign Sprint 1-2 - the client-side half of the
// ActivityEventType registry (icon needs lucide-react, so it can't live in
// packages/shared) - same split as lib/notification-definitions.ts's
// NOTIFICATION_ICONS. Record<ActivityEventType, ...> means the compiler
// itself rejects a build that adds a new ActivityEventType without an entry
// here - see describeActivityEvent's assertNever (now in packages/shared)
// for the matching guarantee on the dynamic-text side, which a plain
// Record can't express.
export const ACTIVITY_ICONS: Record<ActivityEventType, LucideIcon> = {
  [ActivityEventType.VIDEO_UPLOADED]: UploadCloud,
  [ActivityEventType.CLIP_GENERATED]: Film,
  [ActivityEventType.CLIP_EXPORTED]: Download,
  [ActivityEventType.MEMBER_INVITED]: UserPlus,
  [ActivityEventType.WORKSPACE_DELETED]: Trash2,
};

// Activity Timeline v2 - default/SSR page size, shared between
// DashboardSummary.tsx's server-side seed fetch and useActivityTimeline's
// client-side PAGE_LIMIT so the two stay in lockstep (matches today's
// DEFAULT_ACTIVITY_LIMIT on the backend).
export const ACTIVITY_PAGE_LIMIT = 20;

// Activity Timeline v2 - title/description are now denormalized on
// ActivityEventDto itself (computed server-side at write time - see
// ActivityEvent.title's own schema comment), so this just reads them
// straight off the DTO instead of recomputing from `type`+`metadata`. Falls
// back to the shared describeActivityEvent (the same function the backend
// used to compute them) only for pre-migration rows that haven't been
// backfilled yet (title/description both null) - keeps old rows rendering
// something sensible instead of a blank row.
export function describeActivityEventDto(event: ActivityEventDto): {
  title: string;
  description: string | null;
} {
  if (event.title !== null) return { title: event.title, description: event.description };
  return sharedDescribeActivityEvent(event.type, event.metadata);
}

// Single-string convenience wrapper (legacy shape, still used by a couple
// of call sites/tests that want one sentence rather than a title/
// description pair) - reproduces the exact same text the pre-v2 UI showed,
// including MEMBER_INVITED's plain-space join (no colon) vs. every other
// type's ": " join.
export function describeActivityEvent(event: ActivityEventDto): string {
  const { title, description } = describeActivityEventDto(event);
  if (description === null) return title;
  const separator = event.type === ActivityEventType.MEMBER_INVITED ? ' ' : ': ';
  return `${title}${separator}${description}`;
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
