// Mirrors SocialPlatform in packages/database's Prisma schema. Only YOUTUBE
// for Fase 6a - see CLAUDE.md's "Publish Center" section.
export enum SocialPlatform {
  YOUTUBE = 'YOUTUBE',
}

// API/UI-facing DTO for a connected account - deliberately never includes
// accessToken/refreshToken (see apps/api/src/social/social.service.ts's
// toDto()). Client never needs the tokens themselves; publishing happens
// server-side in apps/worker.
export interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  tokenExpiresAt: string;
  createdAt: string;
}

// Mirrors PublishStatus in packages/database's Prisma schema. SCHEDULED
// (Fase 6c) is a row waiting for scheduledAt to arrive - the
// schedule-publish-clip poller (apps/worker) claims it into QUEUED once due.
export enum PublishStatus {
  SCHEDULED = 'SCHEDULED',
  QUEUED = 'QUEUED',
  PUBLISHING = 'PUBLISHING',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED',
}

// API/UI-facing shape for one publish attempt of a clip - platform is
// denormalized from the joined SocialAccount so the dashboard doesn't need
// a separate lookup to show e.g. "Published to YouTube".
export interface PublishRecord {
  id: string;
  clipId: string;
  socialAccountId: string;
  platform: SocialPlatform;
  status: PublishStatus;
  // Non-null only for a scheduled publish (Fase 6c) that hasn't fired yet -
  // null means either "publish now" or already past SCHEDULED.
  scheduledAt: string | null;
  // Non-null only once status is PUBLISHED - the platform's own id/URL for
  // the published content.
  platformPostId: string | null;
  errorMessage: string | null;
  publishedAt: string | null;
  createdAt: string;
}
