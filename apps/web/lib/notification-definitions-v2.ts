import {
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  Bell,
  CheckCircle2,
  Circle,
  Clapperboard,
  CreditCard,
  Film,
  Info,
  Loader2,
  Megaphone,
  Settings2,
  UploadCloud,
  Users,
  XCircle,
} from 'lucide-react';
import {
  NotificationCategoryV2,
  NotificationPriorityV2,
  NotificationThreadStatusV2,
  type NotificationTypeV2,
} from '@speedora/shared';
import { NOTIFICATION_ICONS } from './notification-definitions';

// Notification Center v2 Phase 4 - the client-side display registry for
// everything V1's notification-definitions.ts never needed to represent
// (category, a real 5-level priority, thread status, timeline stage
// status). A SEPARATE file, not an extension of the V1 one - V1's own
// Record<NotificationType, ...> completeness checks must never be forced to
// handle a V2-only concept.

export const CATEGORY_ICONS: Record<NotificationCategoryV2, typeof Bell> = {
  [NotificationCategoryV2.UPLOAD]: UploadCloud,
  [NotificationCategoryV2.AI_PROCESSING]: Settings2,
  [NotificationCategoryV2.CLIP_GENERATION]: Clapperboard,
  [NotificationCategoryV2.RENDERING]: Film,
  [NotificationCategoryV2.PUBLISHING]: Megaphone,
  [NotificationCategoryV2.ANALYTICS]: BarChart3,
  [NotificationCategoryV2.BILLING]: CreditCard,
  [NotificationCategoryV2.WORKSPACE]: Users,
  [NotificationCategoryV2.SYSTEM]: Settings2,
  [NotificationCategoryV2.ERRORS]: AlertOctagon,
};

export const CATEGORY_LABELS: Record<NotificationCategoryV2, string> = {
  [NotificationCategoryV2.UPLOAD]: 'Upload',
  [NotificationCategoryV2.AI_PROCESSING]: 'Processing',
  [NotificationCategoryV2.CLIP_GENERATION]: 'Clip Generation',
  [NotificationCategoryV2.RENDERING]: 'Rendering',
  [NotificationCategoryV2.PUBLISHING]: 'Publishing',
  [NotificationCategoryV2.ANALYTICS]: 'Analytics',
  [NotificationCategoryV2.BILLING]: 'Billing',
  [NotificationCategoryV2.WORKSPACE]: 'Workspace',
  [NotificationCategoryV2.SYSTEM]: 'System',
  [NotificationCategoryV2.ERRORS]: 'Errors',
};

// Accessibility (WCAG 1.4.1) - every priority pairs a DISTINCT icon SHAPE
// with its color, never color alone. `badgeVariant` maps onto the existing
// semantic Badge system (components/ui/badge.tsx) - CRITICAL reuses
// `error`'s color (this app's status system has no separate "critical"
// surface token yet) but keeps its own icon/label so it never reads as a
// plain ERROR to anyone who can't rely on color.
export interface PriorityDefinition {
  label: string;
  icon: typeof Bell;
  badgeVariant: 'info' | 'success' | 'warning' | 'error';
}

export const PRIORITY_DEFINITIONS: Record<NotificationPriorityV2, PriorityDefinition> = {
  [NotificationPriorityV2.INFO]: { label: 'Info', icon: Info, badgeVariant: 'info' },
  [NotificationPriorityV2.SUCCESS]: {
    label: 'Success',
    icon: CheckCircle2,
    badgeVariant: 'success',
  },
  [NotificationPriorityV2.WARNING]: {
    label: 'Warning',
    icon: AlertTriangle,
    badgeVariant: 'warning',
  },
  [NotificationPriorityV2.ERROR]: { label: 'Error', icon: XCircle, badgeVariant: 'error' },
  [NotificationPriorityV2.CRITICAL]: {
    label: 'Critical',
    icon: AlertOctagon,
    badgeVariant: 'error',
  },
};

export interface ThreadStatusDefinition {
  label: string;
  icon: typeof Bell;
  badgeVariant: 'info' | 'success' | 'warning' | 'error';
  spin?: boolean;
}

export const THREAD_STATUS_DEFINITIONS: Record<NotificationThreadStatusV2, ThreadStatusDefinition> =
  {
    [NotificationThreadStatusV2.IN_PROGRESS]: {
      label: 'Sedang diproses',
      icon: Loader2,
      badgeVariant: 'info',
      spin: true,
    },
    [NotificationThreadStatusV2.COMPLETED]: {
      label: 'Selesai',
      icon: CheckCircle2,
      badgeVariant: 'success',
    },
    [NotificationThreadStatusV2.FAILED]: {
      label: 'Gagal',
      icon: XCircle,
      badgeVariant: 'error',
    },
  };

export type TimelineStageStatus = 'done' | 'active' | 'pending' | 'failed';

export const TIMELINE_STAGE_STATUS_DEFINITIONS: Record<
  TimelineStageStatus,
  { label: string; icon: typeof Bell; spin?: boolean }
> = {
  done: { label: 'Selesai', icon: CheckCircle2 },
  active: { label: 'Sedang berjalan', icon: Loader2, spin: true },
  pending: { label: 'Menunggu', icon: Circle },
  failed: { label: 'Gagal', icon: XCircle },
};

// V1's NOTIFICATION_ICONS is a closed Record<NotificationType, ...> - a V2
// row's `type` can also be the V2-only 'PIPELINE_PROGRESS' (see
// NotificationTypeV2 in packages/shared), which was deliberately never added
// to that enum/Record (see that file's own header comment on why). This
// function is the one place that widens the lookup with a real fallback
// instead of a runtime crash on an unrecognized key.
export function getNotificationIconV2(type: NotificationTypeV2): typeof Bell {
  if (type in NOTIFICATION_ICONS) {
    return NOTIFICATION_ICONS[type as keyof typeof NOTIFICATION_ICONS];
  }
  return Loader2;
}
