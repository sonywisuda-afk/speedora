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
  // Transfer Ownership roadmap - fires to the new owner once
  // WorkspaceService.transferOwnership completes.
  WORKSPACE_OWNERSHIP_TRANSFERRED = 'WORKSPACE_OWNERSHIP_TRANSFERRED',
  // Generate More Clips roadmap (Phase C) - fires from
  // generate-more-clips.worker.ts when it finds zero usable new candidates.
  // Unlike PIPELINE_PROGRESS below, this is a real single-shot notification
  // (not a thread-status concept), so it belongs in the full V1 enum with a
  // normal icon/label/severity, not the V2-only widened union.
  GENERATE_MORE_NO_CANDIDATES = 'GENERATE_MORE_NO_CANDIDATES',
  // Download Reliability Framework - a fourth state-based type alongside
  // STORAGE_WARNING/CREDIT_WARNING/SYNC_FAILURE_WARNING, system-wide. See
  // alert-engine.worker.ts's videoImportInternalCrashSpikeRule.
  IMPORT_FAILURE_SPIKE = 'IMPORT_FAILURE_SPIKE',
  // Speaker Intelligence Phase 0 (Production Diarization Foundation) - a
  // fifth state-based type, system-wide. See alert-engine.worker.ts's
  // diarizationDependencyMissingRule.
  DIARIZATION_DEPENDENCY_MISSING = 'DIARIZATION_DEPENDENCY_MISSING',
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
  [NotificationType.WORKSPACE_OWNERSHIP_TRANSFERRED]: 'success',
  // Generate More Clips roadmap (Phase C) - neither success (nothing new
  // was produced) nor an error (the job itself succeeded) - closest to a
  // neutral/informational tone, and this type's own severity set has no
  // dedicated 'info' value, so 'warning' is used the same way this codebase
  // already treats STORAGE_WARNING/CREDIT_WARNING: worth the user's
  // attention, not a failure.
  [NotificationType.GENERATE_MORE_NO_CANDIDATES]: 'warning',
  // Download Reliability Framework - a degraded-condition warning, same tone
  // as STORAGE_WARNING/CREDIT_WARNING/SYNC_FAILURE_WARNING.
  [NotificationType.IMPORT_FAILURE_SPIKE]: 'warning',
  // Speaker Intelligence Phase 0 - same tone, same reasoning.
  [NotificationType.DIARIZATION_DEPENDENCY_MISSING]: 'warning',
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

// ============================================================================
// Notification Center v2 Phase 3 (API Layer) - everything below is a NEW,
// ADDITIVE contract for GET/PATCH/DELETE /notifications/v2/*. Nothing above
// this line is touched - NotificationType/NotificationChannel/NOTIFICATION_
// SEVERITY/NotificationDto/NotificationListDto/etc. keep meaning exactly what
// they meant before, and V1's /notifications/* routes keep returning exactly
// what they always have. A V2-only type (e.g. PIPELINE_PROGRESS) is
// deliberately NOT added to the NotificationType enum above - that enum's
// NOTIFICATION_SEVERITY Record is exhaustiveness-checked and consumed by
// apps/web's V1 icon/label/tone registries, which must never be forced to
// handle a type V1 can never actually return (see
// NotificationsService.list()'s threadId: null, groupId: null guard - a
// PIPELINE_PROGRESS row can never reach a V1 endpoint). Notification*V2Dto
// below widens `type` with a plain union instead.
// ============================================================================

// Mirrors NotificationCategory in packages/database's Prisma schema (same
// nominally-distinct-shared-runtime-values convention as NotificationType
// above) - a coarse "which product area" bucket, orthogonal to `type`. Net
// new to this shared package - V1's NotificationDto never exposed category.
export enum NotificationCategoryV2 {
  UPLOAD = 'UPLOAD',
  AI_PROCESSING = 'AI_PROCESSING',
  CLIP_GENERATION = 'CLIP_GENERATION',
  RENDERING = 'RENDERING',
  PUBLISHING = 'PUBLISHING',
  ANALYTICS = 'ANALYTICS',
  BILLING = 'BILLING',
  WORKSPACE = 'WORKSPACE',
  SYSTEM = 'SYSTEM',
  ERRORS = 'ERRORS',
}

// Mirrors NotificationPriority in packages/database's Prisma schema - a real
// 5-level severity (INFO/SUCCESS/WARNING/ERROR/CRITICAL), superseding the
// narrower 3-value NotificationSeverity above for V2 consumers only. Net new
// to this shared package.
export enum NotificationPriorityV2 {
  INFO = 'INFO',
  SUCCESS = 'SUCCESS',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

// Mirrors NotificationThreadStatus in packages/database's Prisma schema -
// the Smart Timeline thread's own coarse aggregate state.
export enum NotificationThreadStatusV2 {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// Every real NotificationType value PLUS the one V2-only, non-terminal
// pipeline-progress type (see this block's own header comment for why
// PIPELINE_PROGRESS is never added to the V1 NotificationType enum itself).
export type NotificationTypeV2 = NotificationType | 'PIPELINE_PROGRESS';

// Every real NotificationChannel value PLUS the 3 schema-only (Phase 1),
// no-delivery-implementation-yet channels (EMAIL/PUSH/DESKTOP) - same
// widen-with-a-union pattern as NotificationTypeV2 above, for the same
// reason: the V1 NotificationChannel enum is exhaustiveness-checked by
// V1-only code paths that must never be forced to handle a channel that
// can't actually reach them. Used only by Phase 5's preferences DTOs below.
export type NotificationChannelV2 = NotificationChannel | 'EMAIL' | 'PUSH' | 'DESKTOP';

// The concrete set of actions a client can render as a button for a given
// V2 notification - server-derived (NotificationsService.deriveActions()),
// never guessed client-side, so adding a new action later never needs a
// frontend release ahead of the backend that can actually satisfy it. Every
// value here corresponds to a route/capability that genuinely exists today
// (Retry -> POST /videos/:id/retry, Publish -> POST /clips/:id/publish,
// etc.) - nothing speculative.
export enum NotificationActionType {
  RETRY = 'RETRY',
  OPEN_VIDEO = 'OPEN_VIDEO',
  OPEN_CLIP = 'OPEN_CLIP',
  PUBLISH = 'PUBLISH',
  VIEW_ANALYTICS = 'VIEW_ANALYTICS',
  VIEW_LOGS = 'VIEW_LOGS',
  DISMISS = 'DISMISS',
}

// The thread/group sub-object embedded in a V2 notification when this row is
// the representative row of a Smart Timeline thread or a dedup group - at
// most one of `thread`/`group` is ever non-null (see Notification.threadId/
// groupId's own schema comment). Deliberately a NARROW projection (not the
// full thread/group row) - just enough for the list view to render a
// stage-progress affordance or an "x N" badge without a second request.
export interface NotificationThreadSummaryDto {
  id: string;
  status: NotificationThreadStatusV2;
  lastActivityAt: string;
}

export interface NotificationGroupSummaryDto {
  id: string;
  occurrenceCount: number;
  lastOccurredAt: string;
}

export interface NotificationV2Dto {
  id: string;
  type: NotificationTypeV2;
  category: NotificationCategoryV2;
  priority: NotificationPriorityV2;
  title: string;
  body: string;
  videoId: string | null;
  clipId: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  thread: NotificationThreadSummaryDto | null;
  group: NotificationGroupSummaryDto | null;
  // Server-computed navigation target (e.g. "/videos/abc123/edit") - null
  // when this notification has no real destination (no videoId/clipId to
  // navigate to). Lets the client navigate directly on click without first
  // fetching the video/clip to figure out where it lives.
  deepLink: string | null;
  actions: NotificationActionType[];
}

export interface NotificationV2ListDto {
  notifications: NotificationV2Dto[];
  // Cursor pagination, same convention as VideosService.findAll/
  // GET /videos - a previously-returned notification id, or null when this
  // is the last page. Never offset-based (see that endpoint's own comment
  // on why: skips/duplicates rows as new ones land ahead of an in-progress
  // page walk - equally true here since notifications arrive continuously).
  nextCursor: string | null;
}

// Coarse list-view state filter - a UI-facing shorthand over
// readAt/archivedAt, not a new persisted column. 'all' still excludes
// archived (an archived notification is opt-in visible only via
// state: 'archived') - same "archived is its own explicit view, not mixed
// into the default list" posture V1 never needed since it had no archive
// state at all.
export type NotificationV2StateFilter = 'all' | 'unread' | 'archived';

export interface NotificationV2ListQuery {
  cursor?: string;
  limit?: number;
  state?: NotificationV2StateFilter;
  category?: NotificationCategoryV2;
  priority?: NotificationPriorityV2;
  // Free-text search over title/body (ILIKE, same convention as
  // SearchService) - covers "resource/video name" search too in practice,
  // since every real notification's title/body already embeds the video's
  // title as generated text (e.g. `Video "My Video" ...`), not a separate
  // joined field.
  q?: string;
}

// The Smart Timeline's per-stage detail, derived at READ TIME from
// VideoStatusEvent (never stored) - mirrors PipelineTimelineDto/
// TimelineStageDto in packages/database's notification-timeline.ts (that
// package is apps/api/apps/worker-only; this is the client-facing mirror of
// its exact shape, same nominally-distinct-shared-shape convention as every
// other Prisma-adjacent type in this file).
export type TimelineStageStatus = 'done' | 'active' | 'pending' | 'failed';

export interface TimelineStageDto {
  stage: string;
  label: string;
  status: TimelineStageStatus;
  startedAt: string | null;
  completedAt: string | null;
  progressPercent: number | null;
  detail: string | null;
}

export interface PipelineFailureHistoryEntryDto {
  stage: string;
  reason: string | null;
  occurredAt: string;
}

export interface PipelineTimelineDto {
  videoId: string;
  overallStatus: 'in_progress' | 'completed' | 'failed';
  failureReason: string | null;
  failureHistory: PipelineFailureHistoryEntryDto[];
  stages: TimelineStageDto[];
}

export interface NotificationThreadDetailDto {
  thread: {
    id: string;
    videoId: string | null;
    title: string;
    status: NotificationThreadStatusV2;
    lastActivityAt: string;
    archivedAt: string | null;
    createdAt: string;
  };
  // The thread's own representative Notification row (readAt/archivedAt/
  // actions/deepLink etc.) - null only in the never-really-reachable case
  // where the thread exists but its representative row was hard-deleted out
  // from under it (defensive, not an expected state).
  notification: NotificationV2Dto | null;
  // Only present when thread.videoId is set (true for every real thread
  // today - see NotificationThread's own schema comment) - the live,
  // never-fabricated per-stage breakdown.
  timeline: PipelineTimelineDto | null;
}

// Every bulk action below takes a plain id list and is idempotent - re-
// submitting the same ids (including ones already read/archived/deleted, or
// ids that were never this user's to begin with) never errors, same
// "absence/already-there is a fine, ordinary end state" posture V1's
// markRead/markAllRead already use. `count` is how many rows this call
// actually changed - 0 is a normal, successful result, not a partial
// failure.
export interface NotificationV2BulkActionRequest {
  ids: string[];
}

export interface NotificationV2BulkActionResult {
  count: number;
}

// ============================================================================
// Notification Center v2 Phase 5 (Preferences & Delivery) - a SEPARATE,
// deliberately coarser vocabulary from the real NotificationCategoryV2 enum
// above, and a separate contract from V1's own granular per-type
// NotificationPreferenceDto/GET/PATCH /notifications/preferences (untouched
// by this phase). Backs GET/PATCH /notifications/v2/preferences/*.
// ============================================================================

// "Rendering" merges the real RENDERING + CLIP_GENERATION categories into
// one user-facing toggle - product decision, not a technical limitation:
// today these two stages read as a single step to a user ("your clip is
// being made"), and splitting them would just be more UI for no real
// control benefit. The underlying event data keeps recording the real,
// separate categories for logic/analytics - only this preferences UI's
// grouping is coarser. Revisit only if the pipeline grows enough genuinely
// separate user-facing stages (e.g. distinct AI Enhancement/Auto Subtitle/
// Multi-format Render steps) to make finer control worth the extra UI.
//
// WORKSPACE (comments/mentions/review & approval requests) and ERRORS
// (RENDER_FAILED and any other failure) are deliberately NOT members of
// this enum - they're "essential" notifications by product decision (a
// missed approval request or a silently-swallowed failure is worse than
// one unwanted toggle) and are never exposed as a toggle at all, in either
// direction - the frontend should show a short explanatory note instead
// (see NotificationPreferencesV2Dto's own comment).
export enum PreferenceCategoryGroupV2 {
  UPLOAD = 'UPLOAD',
  PROCESSING = 'PROCESSING',
  RENDERING = 'RENDERING',
  PUBLISHING = 'PUBLISHING',
  ANALYTICS = 'ANALYTICS',
  BILLING = 'BILLING',
  SYSTEM = 'SYSTEM',
}

export interface NotificationInAppPreferenceV2Dto {
  group: PreferenceCategoryGroupV2;
  enabled: boolean;
}

// One row per NotificationChannel. SLACK/DISCORD/TELEGRAM/WEBHOOK are real
// and toggleable (`enabled` reflects/controls NotificationWebhook.enabled,
// `configured` whether a destination is saved at all - see that model's own
// schema comment for why the two are separate). EMAIL/PUSH/DESKTOP exist in
// the NotificationChannel enum (schema-only since Phase 1) but have no
// delivery implementation - `comingSoon: true`, `enabled`/`configured`
// always false, never accepted by PATCH .../preferences/channel/:channel.
export interface NotificationChannelPreferenceV2Dto {
  channel: NotificationChannelV2;
  enabled: boolean;
  configured: boolean;
  comingSoon: boolean;
}

// `essentialNote` is server-supplied display copy (not hardcoded twice in
// frontend + backend) explaining why WORKSPACE/ERRORS never appear in
// `inApp` - always the same string today, still returned from the API
// rather than a frontend constant so the wording only ever needs to change
// in one place.
export interface NotificationPreferencesV2Dto {
  inApp: NotificationInAppPreferenceV2Dto[];
  channels: NotificationChannelPreferenceV2Dto[];
  essentialNote: string;
}

export interface UpdateNotificationInAppPreferenceV2Dto {
  enabled: boolean;
}

export interface UpdateNotificationChannelPreferenceV2Dto {
  enabled: boolean;
}
