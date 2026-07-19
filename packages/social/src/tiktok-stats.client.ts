const STATUS_FETCH_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
const QUERY_VIDEO_URL = 'https://open.tiktokapis.com/v2/video/query/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

export interface TikTokPublishStatus {
  status: string;
  // Non-null only once the user has actually finished posting the draft
  // from their TikTok inbox - see fetchTikTokPublishStatus() below.
  videoId: string | null;
}

export interface TikTokVideoStats {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
}

interface TikTokErrorBody {
  error?: { code?: string; message?: string };
}

function isTikTokError(body: TikTokErrorBody): boolean {
  return Boolean(body.error?.code && body.error.code !== 'ok');
}

// TikTok's Content Posting API doesn't hand back a public video id at
// upload time for "Upload to Inbox" (Fase 6d) - the post only gets one
// once the user actually finishes posting the draft themselves from their
// TikTok inbox. sync-publish-stats.worker.ts (Fase 6e) calls this first to
// check whether that's happened yet before trying to fetch real stats.
//
// NOTE: the exact response field for the resulting post id
// (publicaly_available_post_id, per TikTok's docs as of writing) is one of
// the more likely things to have shifted if TikTok has changed its API
// since - same class of caveat as Instagram's insight metric names in
// instagram-stats.client.ts.
export async function fetchTikTokPublishStatus(
  accessToken: string,
  publishId: string,
): Promise<TikTokPublishStatus> {
  const res = await fetch(STATUS_FETCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const body = (await res.json()) as {
    data?: { status?: string; publicaly_available_post_id?: number[] };
  } & TikTokErrorBody;
  if (!res.ok || isTikTokError(body)) {
    throw new Error(
      `TikTok post status fetch failed: ${res.status} ${body.error?.message ?? ''}`.trim(),
    );
  }
  const videoId = body.data?.publicaly_available_post_id?.[0];
  return {
    status: body.data?.status ?? 'UNKNOWN',
    videoId: videoId != null ? String(videoId) : null,
  };
}

// Only meaningful once fetchTikTokPublishStatus() has returned a videoId -
// TikTok can't report view/like/comment counts for a post that isn't
// public yet. Requires the video.list scope (see tiktok-oauth.client.ts).
export async function fetchTikTokVideoStats(
  accessToken: string,
  videoId: string,
): Promise<TikTokVideoStats> {
  const url = new URL(QUERY_VIDEO_URL);
  url.searchParams.set('fields', 'id,view_count,like_count,comment_count,share_count');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ filters: { video_ids: [videoId] } }),
  });
  const body = (await res.json()) as {
    data?: {
      videos?: Array<{
        id: string;
        view_count?: number;
        like_count?: number;
        comment_count?: number;
        share_count?: number;
      }>;
    };
  } & TikTokErrorBody;
  if (!res.ok || isTikTokError(body)) {
    throw new Error(`TikTok video query failed: ${res.status} ${body.error?.message ?? ''}`.trim());
  }
  const video = body.data?.videos?.find((v) => v.id === videoId);
  return {
    viewCount: video?.view_count ?? null,
    likeCount: video?.like_count ?? null,
    commentCount: video?.comment_count ?? null,
    shareCount: video?.share_count ?? null,
  };
}

// Sprint 6F (Followers) - account-level, unlike fetchTikTokVideoStats
// above (per-video). Requires the user.info.stats scope (see
// tiktok-oauth.client.ts's SCOPES) - an account connected before that scope
// was added will get a real API error here (insufficient scope) until it
// reconnects; sync-follower-count.worker.ts's per-account isolated
// try/catch already treats that as "skip this account, no snapshot
// created," which is exactly the right "needs-reconnect" signal (see
// platform-capability.util.ts).
export async function fetchTikTokFollowerCount(accessToken: string): Promise<number> {
  const url = new URL(USER_INFO_URL);
  url.searchParams.set('fields', 'follower_count');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = (await res.json()) as {
    data?: { user?: { follower_count?: number } };
  } & TikTokErrorBody;
  if (!res.ok || isTikTokError(body)) {
    throw new Error(`TikTok user/info (stats) failed: ${res.status} ${body.error?.message ?? ''}`.trim());
  }
  const followerCount = body.data?.user?.follower_count;
  if (followerCount === undefined) {
    throw new Error('TikTok user/info did not return a follower_count');
  }
  return followerCount;
}
