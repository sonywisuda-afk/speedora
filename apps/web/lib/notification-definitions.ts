import {
  AtSign,
  Bell,
  CreditCard,
  Download,
  FileWarning,
  Film,
  HardDrive,
  MessageSquare,
  ShieldCheck,
  UploadCloud,
  UserPlus,
  Unplug,
} from 'lucide-react';
import { NOTIFICATION_SEVERITY, NotificationType, type NotificationSeverity } from '@speedora/shared';

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
};

// Same 'good' | 'neutral' | 'bad' tone vocabulary as lib/export.ts's
// StatusBadge - components map tone to actual Tailwind classes themselves.
export type NotificationTone = 'good' | 'neutral' | 'bad';

const TONE_BY_SEVERITY: Record<NotificationSeverity, NotificationTone> = {
  success: 'good',
  warning: 'neutral',
  error: 'bad',
};

export function notificationTone(type: NotificationType): NotificationTone {
  return TONE_BY_SEVERITY[NOTIFICATION_SEVERITY[type]];
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
};
