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
  WORKSPACE_LEFT: 'Anggota keluar dari workspace',
};
