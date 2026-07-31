// Sprint 5F (Audit Log). Mirrors AuditAction in packages/database's Prisma
// schema.
export enum AuditAction {
  MEMBER_ROLE_CHANGED = 'MEMBER_ROLE_CHANGED',
  MEMBER_REMOVED = 'MEMBER_REMOVED',
  INVITE_CREATED = 'INVITE_CREATED',
  INVITE_ACCEPTED = 'INVITE_ACCEPTED',
  PROJECT_CREATED = 'PROJECT_CREATED',
  PROJECT_DELETED = 'PROJECT_DELETED',
  PROJECT_ARCHIVED = 'PROJECT_ARCHIVED',
  PROJECT_UNARCHIVED = 'PROJECT_UNARCHIVED',
  PROJECT_MOVED = 'PROJECT_MOVED',
  FOLDER_CREATED = 'FOLDER_CREATED',
  FOLDER_DELETED = 'FOLDER_DELETED',
  VIDEO_MOVED = 'VIDEO_MOVED',
  VIDEO_DELETED = 'VIDEO_DELETED',
  CLIP_DELETED = 'CLIP_DELETED',
  SHARE_LINK_CREATED = 'SHARE_LINK_CREATED',
  SHARE_LINK_REVOKED = 'SHARE_LINK_REVOKED',
  APPROVAL_DECIDED = 'APPROVAL_DECIDED',
}

export interface AuditLogEntryDto {
  id: string;
  action: AuditAction;
  actorEmail: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// Cursor-paginated, same shape as PaginatedVideos - GET /workspaces/:id/
// audit-log is ADMIN+-only (a governance/security surface) and can grow
// unbounded over a workspace's lifetime.
export interface AuditLogListDto {
  entries: AuditLogEntryDto[];
  nextCursor: string | null;
}
