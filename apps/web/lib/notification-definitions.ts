import {
  AtSign,
  Bell,
  Crown,
  CreditCard,
  Download,
  FileWarning,
  Film,
  HardDrive,
  MessageSquare,
  SearchX,
  ShieldCheck,
  UploadCloud,
  UserPlus,
  Unplug,
} from 'lucide-react';
import {
  NOTIFICATION_SEVERITY,
  NotificationType,
  type NotificationSeverity,
} from '@speedora/shared';

// Notification Center Sprint 4A - the client-side half of the type registry
// (icon needs lucide-react, so it can't live in packages/shared alongside
// NOTIFICATION_SEVERITY). Sprint 4C (Alert Engine) extends both this map and
// packages/shared's NOTIFICATION_SEVERITY with one entry per new type -
// NotificationBell never needs a new switch/if branch for it. Milestone 04f
// added the 5 Collaboration-driven entries.
export const NOTIFICATION_ICONS: Record<NotificationType, typeof Bell> = {
  [NotificationType.UPLOAD_COMPLETE]: UploadCloud,
  [NotificationType.CLIP_READY]: Film,
  [NotificationType.EXPORT_READY]: Download,
  [NotificationType.RENDER_FAILED]: FileWarning,
  [NotificationType.STORAGE_WARNING]: HardDrive,
  [NotificationType.CREDIT_WARNING]: CreditCard,
  [NotificationType.SYNC_FAILURE_WARNING]: Unplug,
  [NotificationType.COMMENT]: MessageSquare,
  [NotificationType.MENTION]: AtSign,
  [NotificationType.REVIEW_REQUEST]: ShieldCheck,
  [NotificationType.APPROVAL]: ShieldCheck,
  [NotificationType.MEMBER_INVITATION_ACCEPTED]: UserPlus,
  [NotificationType.WORKSPACE_OWNERSHIP_TRANSFERRED]: Crown,
  // Generate More Clips roadmap (Phase C) - "search that found nothing",
  // distinct from Film (CLIP_READY) so it never reads as "a clip is ready".
  [NotificationType.GENERATE_MORE_NO_CANDIDATES]: SearchX,
  // Download Reliability Framework - same icon as SYNC_FAILURE_WARNING
  // (a system-health "something is disconnected/broken" condition).
  [NotificationType.IMPORT_FAILURE_SPIKE]: Unplug,
  // Speaker Intelligence Phase 0 - same icon/tone, same "something's
  // disconnected/broken in the environment" condition.
  [NotificationType.DIARIZATION_DEPENDENCY_MISSING]: Unplug,
};

// Same 'good' | 'neutral' | 'bad' tone vocabulary as lib/export.ts's
// StatusBadge - components map tone to actual Tailwind classes themselves.
export type NotificationTone = 'good' | 'neutral' | 'bad';

const TONE_BY_SEVERITY: Record<NotificationSeverity, NotificationTone> = {
  success: 'good',
  warning: 'neutral',
  error: 'bad',
};

// Contract Governance audit Sprint 3 (Runtime Safety, 2026-08-01) - every
// enum-keyed lookup below now takes a plain `string`, not the narrow
// NotificationType, and is honest that a value read off the wire (a live
// frontend/backend version skew - the API starts sending a new
// NotificationType mid-deploy, before this bundle is rebuilt) might not
// actually be a member of it, despite what NotificationDto['type'] claims
// at compile time. Each one degrades to a safe default and logs a warning
// instead of ever indexing a Record with a key it doesn't have - the same
// crash class the ActivityEventType/WORKSPACE_DELETED incident (see
// activity-events.ts's isKnownActivityEventType) already fixed for
// Activity, just not yet closed here.
export function isKnownNotificationType(type: string): type is NotificationType {
  return (Object.values(NotificationType) as string[]).includes(type);
}

// Sprint 4B - row labels for NotificationPreferencesTab's settings grid.
// Same "web-only display registry, one entry per shipped type" convention
// as NOTIFICATION_ICONS above.
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  [NotificationType.UPLOAD_COMPLETE]: 'Upload selesai',
  [NotificationType.CLIP_READY]: 'Klip siap',
  [NotificationType.EXPORT_READY]: 'Export siap',
  [NotificationType.RENDER_FAILED]: 'Proses gagal',
  [NotificationType.STORAGE_WARNING]: 'Peringatan penyimpanan',
  [NotificationType.CREDIT_WARNING]: 'Kredit premium habis',
  [NotificationType.SYNC_FAILURE_WARNING]: 'Sinkronisasi akun gagal',
  [NotificationType.COMMENT]: 'Komentar baru',
  [NotificationType.MENTION]: 'Disebut dalam komentar',
  [NotificationType.REVIEW_REQUEST]: 'Permintaan review',
  [NotificationType.APPROVAL]: 'Keputusan review',
  [NotificationType.MEMBER_INVITATION_ACCEPTED]: 'Undangan diterima',
  [NotificationType.WORKSPACE_OWNERSHIP_TRANSFERRED]: 'Kepemilikan workspace ditransfer',
  [NotificationType.GENERATE_MORE_NO_CANDIDATES]: 'Tidak ada klip tambahan ditemukan',
  [NotificationType.IMPORT_FAILURE_SPIKE]: 'Lonjakan crash proses download',
  [NotificationType.DIARIZATION_DEPENDENCY_MISSING]: 'Dependency speaker diarization hilang',
};

const DEFAULT_ICON = Bell;
const DEFAULT_LABEL = 'Notifikasi tidak dikenal';
const DEFAULT_TONE: NotificationTone = 'neutral';

function warnUnknownType(type: string): void {
  console.warn(
    `[notification-definitions] unknown NotificationType "${type}" - falling back to a default. ` +
      'This means the API sent a type this frontend build does not recognize yet (a live ' +
      'frontend/backend version skew), not a real runtime error.',
  );
}

export function getNotificationIcon(type: string): typeof Bell {
  if (isKnownNotificationType(type)) return NOTIFICATION_ICONS[type];
  warnUnknownType(type);
  return DEFAULT_ICON;
}

export function getNotificationLabel(type: string): string {
  if (isKnownNotificationType(type)) return NOTIFICATION_TYPE_LABELS[type];
  warnUnknownType(type);
  return DEFAULT_LABEL;
}

export function notificationTone(type: string): NotificationTone {
  if (isKnownNotificationType(type)) return TONE_BY_SEVERITY[NOTIFICATION_SEVERITY[type]];
  warnUnknownType(type);
  return DEFAULT_TONE;
}
