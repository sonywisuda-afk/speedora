// Sprint 5B (Shared Clips). Mirrors ShareRole in packages/database's Prisma
// schema - a link holder gets read-only (VIEWER) or REVIEWER access to
// exactly one Video without becoming a real WorkspaceMembership member.
// REVIEWER has no extra capability yet (no Comments/Approval feature
// exists to gate) - the role is captured now so a future sprint can read
// it without a schema change, same "capture now, wire later" precedent as
// this codebase's other forward-compatible enum additions.
export enum ShareRole {
  VIEWER = 'VIEWER',
  REVIEWER = 'REVIEWER',
}

export interface ShareLinkDto {
  id: string;
  videoId: string;
  role: ShareRole;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

// The raw token only ever exists in the URL returned from the create call
// (see ShareLink.tokenHash's own schema comment) - every other read of a
// ShareLink (the list endpoint) returns the plain ShareLinkDto with no way
// to recover the URL, same "hash at rest, shown once" posture as a
// password-reset link.
export interface ShareLinkCreatedDto extends ShareLinkDto {
  url: string;
}

export interface ShareLinkListDto {
  links: ShareLinkDto[];
}

export interface SharedClipDto {
  id: string;
  startTime: number;
  endTime: number;
  hookText: string | null;
  hashtags: string[];
  // Endpoint paths (not raw storage keys), same "never the raw key"
  // treatment as every other resource - null while a clip is still
  // rendering.
  streamUrl: string | null;
  thumbnailUrl: string | null;
}

// GET /share/:token - deliberately a narrow, purpose-built read-only shape
// (not VideoWithClips) - a link holder should never see the creator-facing
// AI signal columns (highlightScore breakdowns, transcript segments, etc.),
// only what a viewer/reviewer actually needs.
export interface SharedVideoDto {
  role: ShareRole;
  video: {
    title: string | null;
    durationSeconds: number | null;
    thumbnailUrl: string | null;
    sourceStreamUrl: string;
    createdAt: string;
  };
  clips: SharedClipDto[];
}
