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
  WORKSPACE_OWNERSHIP_TRANSFERRED = 'WORKSPACE_OWNERSHIP_TRANSFERRED',
  FOLDER_CREATED = 'FOLDER_CREATED',
  FOLDER_DELETED = 'FOLDER_DELETED',
  VIDEO_MOVED = 'VIDEO_MOVED',
  VIDEO_DELETED = 'VIDEO_DELETED',
  CLIP_DELETED = 'CLIP_DELETED',
  SHARE_LINK_CREATED = 'SHARE_LINK_CREATED',
  SHARE_LINK_REVOKED = 'SHARE_LINK_REVOKED',
  APPROVAL_DECIDED = 'APPROVAL_DECIDED',
  // Publishing Expansion Phase 6 (Scheduling) - Contract Governance audit
  // (2026-08-01) found these 4 were already being written by
  // CampaignsService/RecurringSchedulesService but were missing here,
  // exactly the ActivityEventType/WORKSPACE_DELETED contract-drift bug
  // class - see workspace.service.ts's mapAuditAction for the compile-time
  // guard that now prevents this from recurring silently.
  CAMPAIGN_CREATED = 'CAMPAIGN_CREATED',
  CAMPAIGN_CANCELLED = 'CAMPAIGN_CANCELLED',
  RECURRING_SCHEDULE_CREATED = 'RECURRING_SCHEDULE_CREATED',
  RECURRING_SCHEDULE_DELETED = 'RECURRING_SCHEDULE_DELETED',
  // Workspace Lifecycle Management roadmap. No WORKSPACE_DELETED here - see
  // the Prisma schema's AuditAction comment for why that event is recorded
  // elsewhere (ActivityEvent, not AuditLogEntry) instead of this one.
  WORKSPACE_LEFT = 'WORKSPACE_LEFT',
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
