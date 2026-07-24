// Notification Center Sprint 4A (Product Experience track). Mirrors
// NotificationType in packages/database's Prisma schema - same "Prisma and
// shared enums are nominally distinct but share runtime string values"
// convention as ActivityEventType. Grown incrementally per shipped
// trigger/rule, same discipline as ExportType.
export enum NotificationType {
  UPLOAD_COMPLETE = 'UPLOAD_COMPLETE',
  CLIP_READY = 'CLIP_READY',
  EXPORT_READY = 'EXPORT_READY',
  RENDER_FAILED = 'RENDER_FAILED',
  // Sprint 4C (Alert Engine) - the first state-based (not event-driven)
  // types. See packages/database/src/alert-engine.ts.
  STORAGE_WARNING = 'STORAGE_WARNING',
  CREDIT_WARNING = 'CREDIT_WARNING',
  // Milestone 04f - the four originally "Collaboration-blocked" types,
  // unblocked once Sprint 5 shipped real Workspace/Comment/Approval
  // primitives. These were already firing from apps/api (comments.service.ts,
  // approvals.service.ts, workspace.service.ts each call recordNotification
  // with a matching Prisma NotificationType value) before this enum caught
  // up - the gap this closes is purely this shared-type/severity/icon/label
  // registry, which apps/web's NotificationBell/NotificationPreferencesTab
  // read from.
  COMMENT = 'COMMENT',
  MENTION = 'MENTION',
  REVIEW_REQUEST = 'REVIEW_REQUEST',
  APPROVAL = 'APPROVAL',
  MEMBER_INVITATION_ACCEPTED = 'MEMBER_INVITATION_ACCEPTED',
  // Stabilization Pass Area 5 tech-debt fix (2026-07-24) - a third
  // state-based type alongside STORAGE_WARNING/CREDIT_WARNING, per-account
  // rather than system-wide. See alert-engine.worker.ts's
  // syncFailureWarningRule.
  SYNC_FAILURE_WARNING = 'SYNC_FAILURE_WARNING',
}

// Mirrors NotificationChannel in packages/database's Prisma schema, same
// nominally-distinct-shared-runtime-values convention as NotificationType
// above. IN_APP has existed since Sprint 4A; Milestone 04d wired
// SLACK/DISCORD/WEBHOOK as outbound delivery surfaces, each independently
// toggleable per NotificationType (see NotificationPreferenceDto) and
// backed by one account-level destination (see NotificationWebhookDto).
// Milestone 04e wired TELEGRAM - same shape, but its "destination" is
// discovered in two steps (bot token, then a chat_id) rather than pasted in
// one - see NotificationWebhookDto's `pending` field.
export enum NotificationChannel {
  IN_APP = 'IN_APP',
  SLACK = 'SLACK',
  DISCORD = 'DISCORD',
  WEBHOOK = 'WEBHOOK',
  TELEGRAM = 'TELEGRAM',
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
  [NotificationType.STORAGE_WARNING]: 'warning',
  [NotificationType.CREDIT_WARNING]: 'warning',
  [NotificationType.SYNC_FAILURE_WARNING]: 'warning',
  // Milestone 04f - all 5 are positive/informational collaboration activity
  // (someone engaged with your content), not a warning or failure state -
  // same 'success' tone as the other event-driven types above.
  [NotificationType.COMMENT]: 'success',
  [NotificationType.MENTION]: 'success',
  [NotificationType.REVIEW_REQUEST]: 'success',
  [NotificationType.APPROVAL]: 'success',
  [NotificationType.MEMBER_INVITATION_ACCEPTED]: 'success',
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

// enabled/toast both optional - a single toggle click sends only the field
// that changed; the server reads current row state for the other. Milestone
// 04d - channel optional, defaults to IN_APP server-side; toast stays
// meaningful only for IN_APP.
export interface UpdateNotificationPreferenceDto {
  enabled?: boolean;
  toast?: boolean;
  channel?: NotificationChannel;
}

// Milestone 04d - one account-level outbound destination per channel (SLACK/
// DISCORD/WEBHOOK only, IN_APP has none). `configured` is the only signal
// about the secret ever sent to a client - the encrypted URL itself is
// write-only, same "secrets are for writing not reading back" posture a
// password field would use (see NotificationWebhook.url's own schema
// comment).
// Milestone 04e - `pending`/`telegramBotUsername` are additive, TELEGRAM-only
// fields (always undefined for SLACK/DISCORD/WEBHOOK). For TELEGRAM,
// `configured` means "chatId is known" (a message can actually be sent),
// not merely "a bot token was saved" - `pending: true` is the distinct
// in-between state ("token saved, waiting for the user to message their own
// bot"), needed so the UI can render a t.me/<username> deep link + "waiting"
// status instead of collapsing that into either "not configured" or
// "configured".
export interface NotificationWebhookDto {
  channel: NotificationChannel;
  configured: boolean;
  pending?: boolean;
  telegramBotUsername?: string;
}

export interface NotificationWebhookListDto {
  webhooks: NotificationWebhookDto[];
}

export interface UpsertNotificationWebhookDto {
  url: string;
}

// Milestone 04e - a genuinely different input shape from
// UpsertNotificationWebhookDto (a bot token, not a URL), and a distinct
// route (PUT /notifications/telegram) rather than the generic
// /notifications/webhooks/:channel - see NotificationsService.upsertTelegramWebhook's
// own comment for why this isn't folded into the generic upsert path.
export interface UpsertTelegramWebhookDto {
  botToken: string;
}
