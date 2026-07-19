import { X_API_BASE_URL } from './x-graph';

export interface XTweetStats {
  viewCount: number | null; // impression_count
  likeCount: number | null;
  commentCount: number | null; // reply_count
  shareCount: number | null; // retweet_count
  watchTimeSeconds: number | null; // no watch-time metric for tweets
}

interface XErrorBody {
  title?: string;
  detail?: string;
}

// Used by sync-publish-stats.worker.ts to refresh engagement counts for a
// published tweet. Requires the tweet.read scope (see x-oauth.client.ts's
// SCOPES) - counted against the same pay-per-use "post read" pricing as
// every other v2 GET call (see CLAUDE.md's Publish Center section), not a
// separate cost from publishing itself.
export async function fetchXTweetStats(accessToken: string, tweetId: string): Promise<XTweetStats> {
  const url = new URL(`${X_API_BASE_URL}/tweets/${tweetId}`);
  url.searchParams.set('tweet.fields', 'public_metrics');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = (await res.json()) as {
    data?: {
      public_metrics?: {
        impression_count?: number;
        like_count?: number;
        reply_count?: number;
        retweet_count?: number;
      };
    };
    errors?: XErrorBody[];
  };
  if (!res.ok) {
    const first = body.errors?.[0];
    throw new Error(`X tweets fetch failed: ${res.status} ${first?.detail ?? first?.title ?? ''}`.trim());
  }

  const metrics = body.data?.public_metrics;
  return {
    viewCount: metrics?.impression_count ?? null,
    likeCount: metrics?.like_count ?? null,
    commentCount: metrics?.reply_count ?? null,
    shareCount: metrics?.retweet_count ?? null,
    watchTimeSeconds: null,
  };
}

// Sprint 6F (Followers) - account-level ("whoami" style via /2/users/me),
// unlike fetchXTweetStats above (per-tweet). Requires only users.read,
// already granted - no new scope needed.
export async function fetchXFollowerCount(accessToken: string): Promise<number> {
  const url = new URL(`${X_API_BASE_URL}/users/me`);
  url.searchParams.set('user.fields', 'public_metrics');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = (await res.json()) as {
    data?: { public_metrics?: { followers_count?: number } };
    errors?: XErrorBody[];
  };
  if (!res.ok) {
    const first = body.errors?.[0];
    throw new Error(`X users/me fetch failed: ${res.status} ${first?.detail ?? first?.title ?? ''}`.trim());
  }
  const followersCount = body.data?.public_metrics?.followers_count;
  if (followersCount === undefined) {
    throw new Error('X users/me did not return a followers_count');
  }
  return followersCount;
}
