// Notification Center Sprint 4A (Product Experience track). Mirrors
// NotificationType in packages/database's Prisma schema - same "Prisma and
// shared enums are nominally distinct but share runtime string values"
// convention as ActivityEventType. Only 4 values for now, one per shipped
// trigger - see schema.prisma's own comment on why Storage/Credit Warning
// aren't here (deferred to a future Alert Engine sprint, not just missing).
export enum NotificationType {
  UPLOAD_COMPLETE = 'UPLOAD_COMPLETE',
  CLIP_READY = 'CLIP_READY',
  EXPORT_READY = 'EXPORT_READY',
  RENDER_FAILED = 'RENDER_FAILED',
}

// Registry keyed by NotificationType - a single source of truth for
// severity, so consumers (apps/web's toast tone today; a future email
// template's styling, or Sprint 4C's Alert Engine entries) read from one
// place instead of each growing their own switch/Record as types are added.
// Deliberately just severity, not a full "title/icon/defaultPreference"
// definition yet - title/body are per-instance server-generated text (see
// NotificationDto below), not a static-per-type template, and a
// defaultPreference field would be speculative until Sprint 4B actually
// wires NotificationPreference reads. Icon assignment stays in apps/web
// (lucide-react has no place in a backend-shared package) - see
// apps/web/lib/notification-definitions.ts, which reads this registry.
export type NotificationSeverity = 'success' | 'warning' | 'error';

export const NOTIFICATION_SEVERITY: Record<NotificationType, NotificationSeverity> = {
  [NotificationType.UPLOAD_COMPLETE]: 'success',
  [NotificationType.CLIP_READY]: 'success',
  [NotificationType.EXPORT_READY]: 'success',
  [NotificationType.RENDER_FAILED]: 'error',
};

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  videoId: string | null;
  clipId: string | null;
  // Free-form display context (e.g. { errorMessage } for RENDER_FAILED) -
  // see Notification.metadata's own comment in schema.prisma.
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

// Wrapped (not a bare array), same list-response convention as every other
// list endpoint in this codebase ({ jobs: ExportJobDto[] }, { events:
// ActivityEventDto[] }, etc.).
export interface NotificationListDto {
  notifications: NotificationDto[];
}

export interface NotificationUnreadCountDto {
  count: number;
}

// Sprint 4B (Notification Preferences). `toast` reuses
// NotificationPreference.config's existing JSON column ({ toast?: boolean })
// rather than a second NotificationChannel value - see schema.prisma's own
// comment on NotificationPreference for why (toast is a client-only
// presentation of an IN_APP row, not a distinct delivery mechanism).
export interface NotificationPreferenceDto {
  type: NotificationType;
  enabled: boolean;
  toast: boolean;
}

// Wrapped, same convention as NotificationListDto - always exactly one
// entry per NotificationType, defaults already resolved server-side (the
// client never merges/defaults itself).
export interface NotificationPreferenceListDto {
  preferences: NotificationPreferenceDto[];
}

// Both optional - a single toggle click sends only the field that changed;
// the server reads current row state for the other.
export interface UpdateNotificationPreferenceDto {
  enabled?: boolean;
  toast?: boolean;
}
