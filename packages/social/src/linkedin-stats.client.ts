import { LINKEDIN_REST_BASE_URL, linkedinRestHeaders } from './linkedin-graph';

export interface LinkedInPostStats {
  // LinkedIn's Community Management API (the tier this integration uses -
  // no Marketing Developer Platform partnership) doesn't expose impression/
  // view counts for organic posts - honestly null, same posture as every
  // other documented gap in this package.
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  // No repost/share count available at this API tier either.
  shareCount: number | null;
  watchTimeSeconds: number | null;
}

interface LinkedInErrorBody {
  message?: string;
}

// Used by sync-publish-stats.worker.ts to refresh like/comment counts for a
// published LinkedIn post. Requires the same w_member_social scope used to
// create the post (see linkedin-oauth.client.ts's SCOPES) - LinkedIn's
// Social Actions API doesn't have a separate read-only permission for a
// member reading their own post's engagement.
export async function fetchLinkedInPostStats(
  accessToken: string,
  postUrn: string,
): Promise<LinkedInPostStats> {
  const url = `${LINKEDIN_REST_BASE_URL}/socialActions/${encodeURIComponent(postUrn)}`;
  const res = await fetch(url, { headers: linkedinRestHeaders(accessToken) });
  // A post with no likes/comments at all returns an empty JSON object, not
  // an error - see CLAUDE.md's Publish Center section.
  const body = (await res.json().catch(() => ({}))) as {
    likesSummary?: { totalLikes?: number };
    commentsSummary?: { aggregatedTotalComments?: number };
  } & LinkedInErrorBody;
  if (!res.ok) {
    throw new Error(`LinkedIn socialActions failed: ${res.status} ${body.message ?? ''}`.trim());
  }

  return {
    viewCount: null,
    likeCount: body.likesSummary?.totalLikes ?? null,
    commentCount: body.commentsSummary?.aggregatedTotalComments ?? null,
    shareCount: null,
    watchTimeSeconds: null,
  };
}
