import { SocialPlatform } from '@speedora/database';
import { platformRegistry, type PlatformPublishAdapter } from '../../publish/platform-registry';

// Temporarily substitutes one platform's syncStats/fetchFollowerCount on the
// real, shared platformRegistry object (apps/worker/src/publish/platform-registry.ts)
// for the duration of this script's run, then restores the original -
// exactly the "fake deps directly, don't jest.mock() the module it wraps"
// seam docs/testing.md already documents for module tests, applied at
// runtime instead of inside a Jest file. This is the only way to exercise
// the REAL per-record isolation / per-platform gating code in
// sync-publish-stats.worker.ts / sync-follower-count.worker.ts without
// live platform credentials - production dispatch logic itself is never
// touched.
type Substitutable = Pick<PlatformPublishAdapter, 'syncStats' | 'fetchFollowerCount'>;

const originals = new Map<SocialPlatform, Substitutable>();

function save(platform: SocialPlatform): void {
  if (!originals.has(platform)) {
    originals.set(platform, {
      syncStats: platformRegistry[platform].syncStats,
      fetchFollowerCount: platformRegistry[platform].fetchFollowerCount,
    });
  }
}

// YouTube is this run's "happy path" platform - viewCount is a deterministic
// linear function of the clip's own highlightScore (looked up by the
// platformPostId the seed step assigned), so Prediction's (highlightScore,
// engagementScore) correlation has real, non-degenerate variance to fit
// instead of a flat line.
//
// sync-publish-stats.worker.ts's query is system-wide (every PUBLISHED
// PublishRecord on a stats-capable platform, not scoped to this script's own
// seed data) - so this substitute MUST NOT fabricate stats for a
// platformPostId it doesn't recognize, or it would silently pollute
// unrelated real dev-DB rows this run has no business touching.
// `{ kind: 'pending' }` is the real "nothing to report yet" case the actual
// TikTok adapter already models (see platform-registry.ts) - returning it
// for an unrecognized post id leaves that record completely untouched, same
// as if this fake didn't exist.
export function fakeYouTubeVariedSuccess(
  statsByPostId: Map<string, { viewCount: number; likeCount: number; commentCount: number }>,
): void {
  save(SocialPlatform.YOUTUBE);
  platformRegistry[SocialPlatform.YOUTUBE].syncStats = async ({ platformPostId }) => {
    const stats = statsByPostId.get(platformPostId);
    if (!stats) return { kind: 'pending' };
    return { kind: 'stats', stats: { ...stats, shareCount: null, watchTimeSeconds: null } };
  };
}

// Same "don't touch rows this run doesn't own" guard as syncStats above -
// sync-follower-count.worker.ts's query is every SocialAccount on a
// follower-capable platform, system-wide. fetchFollowerCount has no
// "pending" concept to fall back on (unlike syncStats), so an unrecognized
// platformAccountId throws instead - isolated per-account by the real
// worker's own try/catch, same inert-to-unrelated-rows effect as `pending`
// has for syncStats (no snapshot row gets written either way).
export function fakeYouTubeFollowerCount(
  knownPlatformAccountId: string,
  followerCount: number,
): void {
  save(SocialPlatform.YOUTUBE);
  platformRegistry[SocialPlatform.YOUTUBE].fetchFollowerCount = async ({ platformAccountId }) => {
    if (platformAccountId !== knownPlatformAccountId) {
      throw new Error(
        "E2E fake: not this run's own account, refusing to fabricate a follower count",
      );
    }
    return followerCount;
  };
}

// TikTok is this run's "account not reconnected" platform - syncStats
// throws exactly like a real expired/revoked-token API error would, so the
// worker's real per-record try/catch isolation is what's actually under
// test, not a stand-in for it.
export function fakeTikTokDisconnected(): void {
  save(SocialPlatform.TIKTOK);
  platformRegistry[SocialPlatform.TIKTOK].syncStats = async () => {
    throw new Error(
      'E2E-simulated: TikTok API rejected the stored token (account not reconnected)',
    );
  };
}

// Threads is deliberately left untouched - it has no syncStats in the real
// registry at all (see platform-registry.ts), so platformsWithStatsSync()
// already excludes it for real. That real gating is the "platform doesn't
// support this metric" proof; no substitution needed for it.

export function restorePlatformRegistry(): void {
  for (const [platform, original] of originals) {
    platformRegistry[platform].syncStats = original.syncStats;
    platformRegistry[platform].fetchFollowerCount = original.fetchFollowerCount;
  }
  originals.clear();
}
