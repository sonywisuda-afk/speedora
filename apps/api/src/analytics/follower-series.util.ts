import type { SocialPlatform } from '@speedora/database';
import type { FollowersDto, SocialPlatform as SharedSocialPlatform } from '@speedora/shared';

// Stabilization Pass (API Contract Audit) - extracted from AnalyticsService
// and WorkspaceAnalyticsService, which had this duplicated verbatim. Shared
// here since both the owner-scoped (/analytics/followers) and
// workspace-scoped (/workspaces/:id/analytics/followers) surfaces need the
// exact same SocialAccount+followerSnapshots -> FollowersDto shape.
export function toFollowerAccountSeries(account: {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  followerSnapshots: Array<{ capturedAt: Date; followerCount: number }>;
}): FollowersDto['accounts'][number] {
  const history = account.followerSnapshots.map((snapshot) => ({
    capturedAt: snapshot.capturedAt.toISOString(),
    followerCount: snapshot.followerCount,
  }));
  return {
    socialAccountId: account.id,
    platform: account.platform as unknown as SharedSocialPlatform,
    displayName: account.displayName,
    latestFollowerCount: history.length > 0 ? history[history.length - 1].followerCount : null,
    history,
  };
}
