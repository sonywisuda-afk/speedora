import { SocialPlatform } from '@speedora/shared';

// Sprint 6A (Analytics Dashboard Expansion) - the single source of truth for
// "does this platform's public API actually give us this metric." Every
// later sprint's "Not available on this platform" UI reads from this table
// instead of re-deriving the answer ad hoc - generalizes the convention
// already used inline for TikTok watch-time before this sprint. Availability
// is per-platform-per-metric because it genuinely varies (e.g. Instagram has
// real watch-time, TikTok never does) - collapsing this into a single
// per-platform flag would either hide real data or fabricate missing data.
export type MetricKey =
  | 'views'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'watchTime'
  | 'followerCount';

// 'needs-reconnect' is distinct from 'unavailable': the data genuinely
// exists on the platform, but this app doesn't hold the OAuth scope to read
// it yet for accounts connected before that scope was requested (e.g.
// TikTok followerCount, pending Sprint 6F's `user.info.stats` scope
// addition) - the UI should offer a reconnect action, not a flat "never
// available" message.
export type MetricAvailability = 'available' | 'unavailable' | 'needs-reconnect';

export interface PlatformCapabilityEntry {
  availability: MetricAvailability;
  // Required whenever availability !== 'available' - the whole point of this
  // table is that "not available" is always explained, never a silent gap
  // (see the project's "no fabricated numbers" rule).
  reason?: string;
  // Optional caveat even when availability === 'available' - e.g. Instagram
  // watchTime is a real single scalar average, not a second-by-second
  // retention curve, and callers showing it need to say so.
  note?: string;
}

export type PlatformCapability = Record<MetricKey, PlatformCapabilityEntry>;

const available: PlatformCapabilityEntry = { availability: 'available' };

export const PLATFORM_CAPABILITY: Record<SocialPlatform, PlatformCapability> = {
  [SocialPlatform.YOUTUBE]: {
    views: available,
    likes: available,
    comments: available,
    shares: {
      availability: 'unavailable',
      reason: "YouTube's Data API doesn't expose a shares count for videos.",
    },
    watchTime: {
      availability: 'unavailable',
      reason:
        'Requires the YouTube Analytics API (a separate OAuth scope this app does not request today).',
    },
    followerCount: available,
  },
  [SocialPlatform.TIKTOK]: {
    views: available,
    likes: available,
    comments: available,
    shares: available,
    watchTime: {
      availability: 'unavailable',
      reason:
        "TikTok's public API has no endpoint exposing watch time or retention for any video — a hard platform limitation, not a gap in this app.",
    },
    followerCount: {
      availability: 'needs-reconnect',
      reason: 'Reconnect your TikTok account to grant the follower-count permission.',
    },
  },
  [SocialPlatform.INSTAGRAM]: {
    views: { availability: 'available', note: 'Reported by Instagram as "plays".' },
    likes: available,
    comments: available,
    shares: available,
    watchTime: {
      availability: 'available',
      note: 'A single average-watch-time value per post, not a second-by-second retention curve.',
    },
    followerCount: available,
  },
  [SocialPlatform.FACEBOOK]: {
    views: available,
    likes: available,
    comments: available,
    shares: {
      availability: 'unavailable',
      reason: "Not returned by the Graph API endpoints this app's scopes allow.",
    },
    watchTime: {
      availability: 'unavailable',
      reason: "Not exposed by the Graph API endpoints this app's scopes allow.",
    },
    followerCount: available,
  },
  [SocialPlatform.THREADS]: {
    views: available,
    likes: available,
    comments: { availability: 'available', note: 'Reported by Threads as "replies".' },
    shares: { availability: 'available', note: 'Reported by Threads as "reposts".' },
    watchTime: {
      availability: 'unavailable',
      reason: 'Not exposed by the Threads Graph API.',
    },
    followerCount: {
      availability: 'unavailable',
      reason: "The Threads Graph API doesn't expose a follower-count field today.",
    },
  },
  [SocialPlatform.LINKEDIN]: {
    views: {
      availability: 'unavailable',
      reason: "LinkedIn's API doesn't return a view count for this content type.",
    },
    likes: available,
    comments: available,
    shares: {
      availability: 'unavailable',
      reason: "Not returned by the scopes this app requests.",
    },
    watchTime: {
      availability: 'unavailable',
      reason: 'LinkedIn has no video-watch-time API.',
    },
    followerCount: {
      availability: 'unavailable',
      reason: 'No public LinkedIn API exposes personal-profile connection/follower counts.',
    },
  },
  [SocialPlatform.PINTEREST]: {
    views: { availability: 'available', note: 'Reported by Pinterest as impressions.' },
    likes: { availability: 'available', note: 'Reported by Pinterest as saves — Pinterest has no true "like".' },
    comments: {
      availability: 'unavailable',
      reason: "Pinterest's API doesn't expose a comment count for Pins.",
    },
    shares: {
      availability: 'unavailable',
      reason: "Not exposed by Pinterest's API.",
    },
    watchTime: {
      availability: 'unavailable',
      reason: "Not applicable — Pinterest Pins aren't a watch-time format.",
    },
    followerCount: available,
  },
  [SocialPlatform.X]: {
    views: { availability: 'available', note: 'Reported by X as impression_count.' },
    likes: available,
    comments: { availability: 'available', note: 'Reported by X as reply_count.' },
    shares: { availability: 'available', note: 'Reported by X as retweet_count.' },
    watchTime: {
      availability: 'unavailable',
      reason: "Not exposed by the X API tier this app uses.",
    },
    followerCount: available,
  },
};

export function getMetricCapability(
  platform: SocialPlatform,
  metric: MetricKey,
): PlatformCapabilityEntry {
  return PLATFORM_CAPABILITY[platform][metric];
}

export function isMetricAvailable(platform: SocialPlatform, metric: MetricKey): boolean {
  return PLATFORM_CAPABILITY[platform][metric].availability === 'available';
}
