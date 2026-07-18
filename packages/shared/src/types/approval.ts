// Sprint 5D (Approval). Mirrors ApprovalStatus in packages/database's
// Prisma schema.
export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  NEEDS_REVISION = 'NEEDS_REVISION',
}

export interface ApprovalEventDto {
  id: string;
  status: ApprovalStatus;
  actorEmail: string;
  note: string | null;
  createdAt: string;
}

export interface ApprovalDto {
  id: string;
  videoId: string;
  clipId: string | null;
  status: ApprovalStatus;
  requestedById: string;
  requestedByEmail: string;
  reviewerId: string | null;
  reviewerEmail: string | null;
  note: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: ApprovalEventDto[];
}

export interface ApprovalListDto {
  approvals: ApprovalDto[];
}
