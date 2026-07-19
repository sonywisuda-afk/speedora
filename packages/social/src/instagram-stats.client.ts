import { GRAPH_BASE_URL } from './meta-graph';

export interface InstagramMediaStats {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  // Average watch time per view, in seconds. Reachable today under the
  // already-granted instagram_manage_insights scope - no reconnect needed
  // (unlike YouTube's watch-time/CTR, which needs a separate Analytics API
  // scope - see docs/ai/dataset-feedback-loop.md).
  watchTimeSeconds: number | null;
}

// Meta's Insights metric names for Reels have shifted across Graph API
// versions in the past (e.g. "video_views" vs "plays") - these are the
// current (v21.0, see instagram-graph.ts) names as of writing. If Meta
// renames these again, this is the one place to update - see CLAUDE.md's
// Fase 6e section for this caveat.
const METRICS = ['plays', 'likes', 'comments', 'shares', 'ig_reels_avg_watch_time'];

// Used by sync-publish-stats.worker.ts (Fase 6e) to refresh view/like/
// comment counts for a published Reel. Requires the instagram_manage_insights
// scope (see instagram-oauth.client.ts's SCOPES).
export async function fetchInstagramMediaStats(
  accessToken: string,
  mediaId: string,
): Promise<InstagramMediaStats> {
  const url = new URL(`${GRAPH_BASE_URL}/${mediaId}/insights`);
  url.searchParams.set('metric', METRICS.join(','));
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url);
  const body = (await res.json()) as {
    data?: Array<{ name: string; values?: Array<{ value: number }> }>;
    error?: { message?: string };
  };
  if (!res.ok || body.error) {
    throw new Error(
      `Instagram media insights failed: ${res.status} ${body.error?.message ?? ''}`.trim(),
    );
  }

  function valueFor(name: string): number | null {
    const metric = body.data?.find((m) => m.name === name);
    const value = metric?.values?.[0]?.value;
    return typeof value === 'number' ? value : null;
  }

  return {
    viewCount: valueFor('plays'),
    likeCount: valueFor('likes'),
    commentCount: valueFor('comments'),
    shareCount: valueFor('shares'),
    watchTimeSeconds: valueFor('ig_reels_avg_watch_time'),
  };
}

interface GraphErrorResponse {
  error?: { message?: string };
}

// Sprint 6F (Followers) - account-level (the IG Business account node
// itself), unlike fetchInstagramMediaStats above (per-Reel). Requires only
// instagram_basic, already granted - no new scope needed.
export async function fetchInstagramFollowerCount(
  accessToken: string,
  igUserId: string,
): Promise<number> {
  const url = new URL(`${GRAPH_BASE_URL}/${igUserId}`);
  url.searchParams.set('fields', 'followers_count');
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url);
  const body = (await res.json()) as { followers_count?: number } & GraphErrorResponse;
  if (!res.ok || body.error) {
    throw new Error(
      `Instagram followers_count fetch failed: ${res.status} ${body.error?.message ?? ''}`.trim(),
    );
  }
  if (body.followers_count === undefined) {
    throw new Error(`Instagram account ${igUserId} did not return a followers_count`);
  }
  return body.followers_count;
}
