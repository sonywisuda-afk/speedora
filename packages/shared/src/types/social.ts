// Mirrors SocialPlatform in packages/database's Prisma schema. Only YOUTUBE
// for Fase 6a - see CLAUDE.md's "Publish Center" section.
export enum SocialPlatform {
  YOUTUBE = 'YOUTUBE',
}

// API/UI-facing DTO for a connected account - deliberately never includes
// accessToken/refreshToken (see apps/api/src/social/social.service.ts's
// toDto()). Client never needs the tokens themselves; publishing (a later
// fase) happens server-side in apps/worker.
export interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  tokenExpiresAt: string;
  createdAt: string;
}
