import { GRAPH_BASE_URL } from './meta-graph';

export interface FacebookVideoStats {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  // Meta's Reels insights only expose a *combined* comments+shares metric
  // (post_video_social_actions), not a clean share-only count - honestly
  // null rather than a guessed/incorrect split, same posture as YouTube/
  // TikTok's null watch-time fields elsewhere in this file's siblings.
  shareCount: number | null;
  watchTimeSeconds: number | null;
}

// blue_reels_play_count is the current (as of writing) Reels-specific plays
// metric on the video insights API - see CLAUDE.md's Publish Center section
// for the caveat that Meta has renamed Reels insights metrics before and
// this is the one place to update if it happens again.
const VIEW_METRIC = 'blue_reels_play_count';

interface GraphErrorResponse {
  error?: { message?: string };
}

// Used by sync-publish-stats.worker.ts to refresh view/like/comment counts
// for a published Facebook Reel. Requires the pages_read_engagement scope
// (see facebook-oauth.client.ts's SCOPES). Two calls, not one: the Reels
// play count only exists on the video_insights endpoint, while like/comment
// counts are more reliably read off the classic likes/comments edges than
// out of the insights API's engagement metrics.
export async function fetchFacebookVideoStats(
  accessToken: string,
  videoId: string,
): Promise<FacebookVideoStats> {
  const insightsUrl = new URL(`${GRAPH_BASE_URL}/${videoId}/video_insights`);
  insightsUrl.searchParams.set('metric', VIEW_METRIC);
  insightsUrl.searchParams.set('access_token', accessToken);
  const insightsRes = await fetch(insightsUrl);
  const insightsBody = (await insightsRes.json()) as {
    data?: Array<{ name: string; values?: Array<{ value: number }> }>;
  } & GraphErrorResponse;
  if (!insightsRes.ok || insightsBody.error) {
    throw new Error(
      `Facebook video_insights failed: ${insightsRes.status} ${insightsBody.error?.message ?? ''}`.trim(),
    );
  }
  const viewCount =
    insightsBody.data?.find((m) => m.name === VIEW_METRIC)?.values?.[0]?.value ?? null;

  const engagementUrl = new URL(`${GRAPH_BASE_URL}/${videoId}`);
  engagementUrl.searchParams.set('fields', 'likes.summary(true),comments.summary(true)');
  engagementUrl.searchParams.set('access_token', accessToken);
  const engagementRes = await fetch(engagementUrl);
  const engagementBody = (await engagementRes.json()) as {
    likes?: { summary?: { total_count?: number } };
    comments?: { summary?: { total_count?: number } };
  } & GraphErrorResponse;
  if (!engagementRes.ok || engagementBody.error) {
    throw new Error(
      `Facebook video engagement fetch failed: ${engagementRes.status} ${engagementBody.error?.message ?? ''}`.trim(),
    );
  }

  return {
    viewCount,
    likeCount: engagementBody.likes?.summary?.total_count ?? null,
    commentCount: engagementBody.comments?.summary?.total_count ?? null,
    shareCount: null,
    watchTimeSeconds: null,
  };
}

// Sprint 6F (Followers) - account-level (the Page node itself), unlike
// fetchFacebookVideoStats above (per-video). Requires only
// pages_read_engagement, already granted - no new scope needed.
export async function fetchFacebookFollowerCount(
  accessToken: string,
  pageId: string,
): Promise<number> {
  const url = new URL(`${GRAPH_BASE_URL}/${pageId}`);
  url.searchParams.set('fields', 'followers_count');
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url);
  const body = (await res.json()) as { followers_count?: number } & GraphErrorResponse;
  if (!res.ok || body.error) {
    throw new Error(
      `Facebook followers_count fetch failed: ${res.status} ${body.error?.message ?? ''}`.trim(),
    );
  }
  if (body.followers_count === undefined) {
    throw new Error(`Facebook Page ${pageId} did not return a followers_count`);
  }
  return body.followers_count;
}
