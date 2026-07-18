import { PINTEREST_API_BASE_URL } from './pinterest-graph';

export interface PinterestPinStats {
  viewCount: number | null; // IMPRESSION
  // Pinterest has no "like" concept - SAVE (a user adding the Pin to their
  // own board) is the closest engagement analog, same "map the nearest
  // native concept" precedent as Threads' reposts -> shareCount.
  likeCount: number | null;
  commentCount: number | null; // no comment-count metric at this API tier
  shareCount: number | null;
  watchTimeSeconds: number | null; // no watch-time metric for Pins
}

// Pinterest's analytics endpoint requires a bounded date range, not a true
// lifetime cumulative total - 90 days back from today is the widest window
// generally available without additional ad-account permissions this
// integration doesn't request. This means older Pins' totals reported here
// will under-count engagement from before the window - a real, documented
// limitation (see CLAUDE.md's Publish Center section), not a bug.
const LOOKBACK_DAYS = 90;
const METRICS = ['IMPRESSION', 'SAVE'];

interface PinterestErrorBody {
  message?: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Used by sync-publish-stats.worker.ts to refresh impression/save counts
// for a published Pin. Requires the pins:read scope (see
// pinterest-oauth.client.ts's SCOPES).
export async function fetchPinterestPinStats(
  accessToken: string,
  pinId: string,
): Promise<PinterestPinStats> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const url = new URL(`${PINTEREST_API_BASE_URL}/pins/${pinId}/analytics`);
  url.searchParams.set('start_date', isoDate(startDate));
  url.searchParams.set('end_date', isoDate(endDate));
  url.searchParams.set('metric_types', METRICS.join(','));
  url.searchParams.set('granularity', 'TOTAL');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = (await res.json()) as {
    all?: { summary_metrics?: { IMPRESSION?: number; SAVE?: number } };
  } & PinterestErrorBody;
  if (!res.ok) {
    throw new Error(`Pinterest pin analytics failed: ${res.status} ${body.message ?? ''}`.trim());
  }

  const summary = body.all?.summary_metrics;
  return {
    viewCount: summary?.IMPRESSION ?? null,
    likeCount: summary?.SAVE ?? null,
    commentCount: null,
    shareCount: null,
    watchTimeSeconds: null,
  };
}
