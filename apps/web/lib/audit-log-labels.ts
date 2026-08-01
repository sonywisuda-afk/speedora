import type { AuditLogEntryDto } from '@speedora/shared';

// Sprint 5F (Audit Log) - shared between the dedicated /workspaces/[id]/audit-log
// page and the Audit Log tab of Workspace Settings (Workspace Lifecycle
// Management roadmap), so both render the same label for the same action
// instead of drifting.
export const ACTION_LABELS: Record<AuditLogEntryDto['action'], string> = {
  MEMBER_ROLE_CHANGED: 'Role anggota diubah',
  MEMBER_REMOVED: 'Anggota dihapus',
  INVITE_CREATED: 'Undangan dibuat',
  INVITE_ACCEPTED: 'Undangan diterima',
  PROJECT_CREATED: 'Project dibuat',
  PROJECT_DELETED: 'Project dihapus',
  PROJECT_ARCHIVED: 'Project diarsipkan',
  PROJECT_UNARCHIVED: 'Project dipulihkan',
  PROJECT_MOVED: 'Project dipindahkan ke workspace lain',
  WORKSPACE_OWNERSHIP_TRANSFERRED: 'Kepemilikan workspace ditransfer',
  FOLDER_CREATED: 'Folder dibuat',
  FOLDER_DELETED: 'Folder dihapus',
  VIDEO_MOVED: 'Video dipindahkan',
  VIDEO_DELETED: 'Video dihapus',
  CLIP_DELETED: 'Klip dihapus',
  SHARE_LINK_CREATED: 'Share link dibuat',
  SHARE_LINK_REVOKED: 'Share link dicabut',
  APPROVAL_DECIDED: 'Keputusan review',
  CAMPAIGN_CREATED: 'Campaign dibuat',
  CAMPAIGN_CANCELLED: 'Campaign dibatalkan',
  RECURRING_SCHEDULE_CREATED: 'Jadwal berulang dibuat',
  RECURRING_SCHEDULE_DELETED: 'Jadwal berulang dihapus',
  WORKSPACE_LEFT: 'Anggota keluar dari workspace',
};

// Contract Governance audit Sprint 3 (Runtime Safety, 2026-08-01) - this is
// exactly the AuditAction the same audit found packages/shared's enum
// silently missing 4 members of (Sprint 1's mapAuditAction). ACTION_LABELS
// is compile-time exhaustive today, but that only guarantees every member
// packages/shared's AuditAction *currently declares* has a label - it can't
// protect against a live frontend/backend version skew (a rebuilt API
// sending a newer AuditAction value before this frontend bundle is
// rebuilt). Falls back to the raw value (still legible in an audit log)
// plus a console.warn, instead of silently rendering nothing.
export function getAuditActionLabel(action: string): string {
  if (action in ACTION_LABELS) {
    return ACTION_LABELS[action as AuditLogEntryDto['action']];
  }
  console.warn(
    `[audit-log-labels] unknown AuditAction "${action}" - falling back to the raw value. ` +
      'This means the API sent an action this frontend build does not recognize yet.',
  );
  return action;
}
