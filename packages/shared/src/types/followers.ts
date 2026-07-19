import type { SocialPlatform } from './social';

// Sprint 6F (Analytics Dashboard Expansion - Followers). One row per
// SocialAccountFollowerSnapshot - real, unaggregated history, ready to plot
// directly (oldest-first, same convention as EngagementTrendPoint).
export interface FollowerHistoryPoint {
  capturedAt: string;
  followerCount: number;
}

// One series per connected account, not per platform - a user/workspace
// can have more than one account on the same platform (e.g. two YouTube
// channels). latestFollowerCount/history are both empty/null when this
// platform is unavailable (LinkedIn/Threads - no public API) or the
// account hasn't reconnected to grant a newly-required scope yet (TikTok) -
// absence of snapshot rows *is* the "not available" signal, same posture
// as PublishRecordStatsSnapshot.watchTimeSeconds. See
// platform-capability.util.ts's `followerCount` capability for the
// per-platform reason to show alongside an empty series.
export interface FollowerAccountSeries {
  socialAccountId: string;
  platform: SocialPlatform;
  displayName: string;
  latestFollowerCount: number | null;
  history: FollowerHistoryPoint[];
}

export interface FollowersDto {
  accounts: FollowerAccountSeries[];
}
