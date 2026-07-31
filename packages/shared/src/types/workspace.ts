// Sprint 5A (Collaboration Foundation). Mirrors WorkspaceRole in
// packages/database's Prisma schema - the single permission-rank enum for
// everything workspace-scoped (membership, invites, and every future
// Collaboration feature). Rank order, highest to lowest: OWNER > ADMIN >
// EDITOR > REVIEWER > VIEWER - see apps/api/src/workspace/
// workspace-access.service.ts for the rank table. Real TS enum (not a
// string-literal union), same convention as ExportType/CaptionStyle, so
// class-validator's @IsEnum() works against a real runtime object.
export enum WorkspaceRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  EDITOR = 'EDITOR',
  REVIEWER = 'REVIEWER',
  VIEWER = 'VIEWER',
}

export interface WorkspaceMemberDto {
  userId: string;
  email: string;
  role: WorkspaceRole;
  createdAt: string;
}

// `role` is the REQUESTER's own role in this workspace (not a list of all
// roles) - lets the frontend gate UI (e.g. hide "Invite" for a VIEWER)
// without a second round-trip.
export interface WorkspaceDto {
  id: string;
  name: string;
  isPersonal: boolean;
  role: WorkspaceRole;
  memberCount: number;
  createdAt: string;
}

export interface WorkspaceDetailDto extends WorkspaceDto {
  members: WorkspaceMemberDto[];
}

export interface WorkspaceListDto {
  workspaces: WorkspaceDto[];
}

export interface ProjectDto {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ProjectListDto {
  projects: ProjectDto[];
}

// Bulk Actions roadmap - each id in the request is validated and audited
// independently (reusing archive()/unarchive()/move()/remove()'s own
// per-project role + business-rule checks), so a batch is a partial-success
// operation, not all-or-nothing: one project failing a check (e.g. still
// has videos, blocking a move) doesn't block the others in the same
// request. `failed[].reason` is the same message the single-item endpoint
// would have thrown.
export interface ProjectBulkActionResultDto {
  succeeded: string[];
  failed: { id: string; reason: string }[];
}

export interface FolderDto {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  createdAt: string;
}

export interface FolderListDto {
  folders: FolderDto[];
}

// Mirrors PendingInviteStatus in packages/database's Prisma schema.
export enum PendingInviteStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REVOKED = 'REVOKED',
}

// Replaces the old (Sprint 1-2) PendingInviteDto that used to live in
// ./dashboard - that version had no workspaceId/status since the old
// invite flow was a one-way "send an email, log it" action with no real
// lifecycle. This one is scoped to a Workspace and has a real
// PENDING -> ACCEPTED/REVOKED lifecycle (see POST /invites/:token/accept).
export interface PendingInviteDto {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  status: PendingInviteStatus;
  createdAt: string;
}

export interface PendingInviteListDto {
  invites: PendingInviteDto[];
}
