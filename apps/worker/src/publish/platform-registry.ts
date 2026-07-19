import { SocialPlatform, type Clip, type PublishRecord, type SocialAccount } from '@speedora/database';
import {
  FacebookOAuthClient,
  fetchFacebookFollowerCount,
  fetchFacebookVideoStats,
  fetchInstagramFollowerCount,
  fetchInstagramMediaStats,
  fetchLinkedInPostStats,
  fetchPinterestFollowerCount,
  fetchThreadsPostStats,
  fetchTikTokFollowerCount,
  fetchTikTokPublishStatus,
  fetchTikTokVideoStats,
  fetchXFollowerCount,
  fetchYouTubeFollowerCount,
  fetchYouTubeVideoStats,
  fetchPinterestPinStats,
  fetchXTweetStats,
  InstagramOAuthClient,
  LinkedInOAuthClient,
  PinterestOAuthClient,
  ThreadsOAuthClient,
  TikTokOAuthClient,
  uploadFacebookReel,
  uploadInstagramReel,
  uploadLinkedInVideo,
  uploadPinterestVideo,
  uploadThreadsVideo,
  uploadTikTokVideo,
  uploadXVideo,
  uploadYouTubeVideo,
  XOAuthClient,
  YouTubeOAuthClient,
  type OAuthRefreshClient,
} from '@speedora/social';
import { getObjectStream, getPresignedDownloadUrl } from '@speedora/storage';

// Multi-Platform Publishing Expansion, Phase 0. Single source of truth for
// per-platform publish/stats dispatch, shared by publish-clip.worker.ts and
// sync-publish-stats.worker.ts - previously each file had its own
// independent if/else ladder plus its own oauthClientFor() switch. Only the
// *dispatch* is unified here, not the underlying mechanics: TikTok's
// Upload-to-Inbox, Instagram's presigned-URL container-poll-publish, and
// YouTube's one-shot upload stay exactly as different as they really are -
// see each entry below.

export type PublishRecordWithRelations = PublishRecord & { clip: Clip; socialAccount: SocialAccount };

export interface PublishResult {
  platformPostId: string;
  logDetail: string;
}

export interface PublishContext {
  record: PublishRecordWithRelations;
  outputUrl: string;
  accessToken: string;
}

export interface PlatformStats {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  // Not every platform's stats client reports these yet - YouTube has
  // neither (needs the deferred Analytics API scope), TikTok has no
  // watch-time endpoint at all. See docs/ai/dataset-feedback-loop.md.
  shareCount?: number | null;
  watchTimeSeconds?: number | null;
}

// TikTok's own stats fetch is two-step and can legitimately have no result
// yet (the user hasn't finished posting the Upload-to-Inbox draft from
// their TikTok app) - 'pending' is a normal state, not a failure, distinct
// from syncStats simply throwing on a real error.
export type StatsResult = { kind: 'stats'; stats: PlatformStats } | { kind: 'pending' };

export interface StatsContext {
  accessToken: string;
  platformPostId: string;
}

// Sprint 6F (Followers) - platformAccountId is only actually used by the
// Meta platforms (Instagram/Facebook need a specific node id); the
// "whoami"-style platforms (YouTube/Pinterest/X/TikTok) ignore it and just
// read the access token's own identity. Always passing both keeps this
// symmetric with StatsContext rather than branching the adapter interface
// per platform.
export interface FollowerContext {
  accessToken: string;
  platformAccountId: string;
}

export interface PlatformPublishAdapter {
  oauth: OAuthRefreshClient;
  publish(ctx: PublishContext): Promise<PublishResult>;
  // Absent (not just failing) for a platform with no stats endpoint at all -
  // sync-publish-stats.worker.ts filters on this rather than a second
  // hand-maintained platform list.
  syncStats?(ctx: StatsContext): Promise<StatsResult>;
  // Absent for LinkedIn/Threads (no public API exposes a follower count at
  // all) - sync-follower-count.worker.ts filters on this the same way
  // syncStats above does. Present but liable to throw for TikTok until an
  // account reconnects to grant user.info.stats - see
  // fetchTikTokFollowerCount's own comment.
  fetchFollowerCount?(ctx: FollowerContext): Promise<number>;
}

const youtubeOAuth = new YouTubeOAuthClient();
const tiktokOAuth = new TikTokOAuthClient();
const instagramOAuth = new InstagramOAuthClient();
const facebookOAuth = new FacebookOAuthClient();
const threadsOAuth = new ThreadsOAuthClient();
const linkedinOAuth = new LinkedInOAuthClient();
const pinterestOAuth = new PinterestOAuthClient();
const xOAuth = new XOAuthClient();

// How long the presigned URL handed to Meta's servers (Instagram Reels,
// Facebook Reels, and Threads video posts - all fetch-from-URL rather than
// byte-upload) stays valid. Meta fetches the video shortly after the
// container/upload-session call returns, so this just needs comfortable
// margin over that, not over any separately-polled processing time.
const META_PRESIGNED_URL_TTL_SECONDS = 15 * 60;

function buildDescription(hashtags: string[]): string {
  return hashtags.map((tag) => `#${tag}`).join(' ');
}

// Instagram Reels only has a single caption field (no separate title), so
// hookText and hashtags are combined here rather than split like YouTube's
// title/description.
function buildCaption(hookText: string | null, hashtags: string[]): string {
  const hashtagLine = buildDescription(hashtags);
  return [hookText, hashtagLine || null]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

export const platformRegistry: Record<SocialPlatform, PlatformPublishAdapter> = {
  [SocialPlatform.YOUTUBE]: {
    oauth: youtubeOAuth,
    async publish({ record, outputUrl, accessToken }) {
      const videoStream = await getObjectStream(outputUrl);
      const upload = await uploadYouTubeVideo({
        accessToken,
        title: record.clip.hookText || `Clip ${record.clip.id}`,
        description: buildDescription(record.clip.hashtags),
        videoStream,
        // Fase 6b default (see CLAUDE.md) - "publish now" uploads a real
        // video to the user's channel, and unlisted avoids a mis-picked
        // clip going live publicly with no safety net, while still being
        // an actual publish (unlike private, which would defeat the
        // point).
        privacyStatus: 'unlisted',
      });
      return { platformPostId: upload.videoId, logDetail: upload.url };
    },
    async syncStats({ accessToken, platformPostId }) {
      return { kind: 'stats', stats: await fetchYouTubeVideoStats(accessToken, platformPostId) };
    },
    async fetchFollowerCount({ accessToken }) {
      return fetchYouTubeFollowerCount(accessToken);
    },
  },
  [SocialPlatform.TIKTOK]: {
    oauth: tiktokOAuth,
    async publish({ outputUrl, accessToken }) {
      // Upload to Inbox (draft) - see CLAUDE.md's Fase 6d section for why.
      // publish_id just acknowledges TikTok received the video into the
      // user's inbox, it isn't a public content id/URL - the user still
      // has to open the TikTok app and finish posting themselves. There's
      // no title/caption field to set here either (only Direct Post's API
      // accepts one); hookText/hashtags are simply unused for a TikTok
      // publish.
      const videoStream = await getObjectStream(outputUrl);
      const upload = await uploadTikTokVideo({ accessToken, videoStream });
      return {
        platformPostId: upload.publishId,
        logDetail: `sent to TikTok inbox, publish_id ${upload.publishId}`,
      };
    },
    async syncStats({ accessToken, platformPostId }) {
      // platformPostId here is the ephemeral publish_id from Upload to
      // Inbox (Fase 6d), not a video id. A real, queryable video id only
      // exists once the user actually finishes posting the draft
      // themselves from their TikTok inbox - until then this is a normal
      // "not yet" state. See CLAUDE.md's Fase 6e section.
      const publishStatus = await fetchTikTokPublishStatus(accessToken, platformPostId);
      if (!publishStatus.videoId) {
        return { kind: 'pending' };
      }
      return { kind: 'stats', stats: await fetchTikTokVideoStats(accessToken, publishStatus.videoId) };
    },
    async fetchFollowerCount({ accessToken }) {
      return fetchTikTokFollowerCount(accessToken);
    },
  },
  [SocialPlatform.INSTAGRAM]: {
    oauth: instagramOAuth,
    async publish({ record, outputUrl, accessToken }) {
      // Instagram's Content Publishing API has no direct byte-upload
      // option - it fetches the video itself from a public HTTPS URL (see
      // CLAUDE.md's Fase 6d "Instagram" section), so a short-lived
      // presigned URL is generated instead of opening a stream here.
      const videoUrl = await getPresignedDownloadUrl(outputUrl, META_PRESIGNED_URL_TTL_SECONDS);
      const upload = await uploadInstagramReel({
        accessToken,
        igUserId: record.socialAccount.platformAccountId,
        videoUrl,
        caption: buildCaption(record.clip.hookText, record.clip.hashtags),
      });
      return {
        platformPostId: upload.mediaId,
        logDetail: `published as Instagram Reel, media id ${upload.mediaId}`,
      };
    },
    async syncStats({ accessToken, platformPostId }) {
      return { kind: 'stats', stats: await fetchInstagramMediaStats(accessToken, platformPostId) };
    },
    async fetchFollowerCount({ accessToken, platformAccountId }) {
      return fetchInstagramFollowerCount(accessToken, platformAccountId);
    },
  },
  [SocialPlatform.FACEBOOK]: {
    oauth: facebookOAuth,
    async publish({ record, outputUrl, accessToken }) {
      // Same "fetch from a public URL" model as Instagram, via the Video
      // Reels API's upload-session handoff - see facebook-upload.client.ts.
      const videoUrl = await getPresignedDownloadUrl(outputUrl, META_PRESIGNED_URL_TTL_SECONDS);
      const upload = await uploadFacebookReel({
        accessToken,
        pageId: record.socialAccount.platformAccountId,
        videoUrl,
        caption: buildCaption(record.clip.hookText, record.clip.hashtags),
      });
      return {
        platformPostId: upload.videoId,
        logDetail: `published as Facebook Reel, video id ${upload.videoId}`,
      };
    },
    async syncStats({ accessToken, platformPostId }) {
      return { kind: 'stats', stats: await fetchFacebookVideoStats(accessToken, platformPostId) };
    },
    async fetchFollowerCount({ accessToken, platformAccountId }) {
      return fetchFacebookFollowerCount(accessToken, platformAccountId);
    },
  },
  [SocialPlatform.THREADS]: {
    oauth: threadsOAuth,
    async publish({ record, outputUrl, accessToken }) {
      // Same "fetch from a public URL" container-create/publish model as
      // Instagram - see threads-upload.client.ts.
      const videoUrl = await getPresignedDownloadUrl(outputUrl, META_PRESIGNED_URL_TTL_SECONDS);
      const upload = await uploadThreadsVideo({
        accessToken,
        threadsUserId: record.socialAccount.platformAccountId,
        videoUrl,
        text: buildCaption(record.clip.hookText, record.clip.hashtags),
      });
      return {
        platformPostId: upload.threadsPostId,
        logDetail: `published to Threads, post id ${upload.threadsPostId}`,
      };
    },
    async syncStats({ accessToken, platformPostId }) {
      return { kind: 'stats', stats: await fetchThreadsPostStats(accessToken, platformPostId) };
    },
  },
  [SocialPlatform.LINKEDIN]: {
    oauth: linkedinOAuth,
    async publish({ record, outputUrl, accessToken }) {
      // LinkedIn's Videos API requires the actual bytes (its own fixed
      // 4MiB-part multi-part upload), not a fetch-from-URL hosted model
      // like Meta's platforms - see uploadLinkedInVideo's own comment.
      const videoStream = await getObjectStream(outputUrl);
      const upload = await uploadLinkedInVideo({
        accessToken,
        personUrn: record.socialAccount.platformAccountId,
        videoStream,
        title: record.clip.hookText || `Clip ${record.clip.id}`,
        commentary: buildCaption(record.clip.hookText, record.clip.hashtags),
      });
      return {
        platformPostId: upload.postUrn,
        logDetail: `published to LinkedIn, post urn ${upload.postUrn}`,
      };
    },
    async syncStats({ accessToken, platformPostId }) {
      return { kind: 'stats', stats: await fetchLinkedInPostStats(accessToken, platformPostId) };
    },
  },
  [SocialPlatform.PINTEREST]: {
    oauth: pinterestOAuth,
    async publish({ record, outputUrl, accessToken }) {
      // Pinterest mandates a cover image for every video Pin - unlike the
      // rest of this registry, there's no reasonable fallback if the clip's
      // AI-selected thumbnail (packages/thumbnail-selection) hasn't been
      // extracted yet, so this fails loudly and specifically rather than
      // sending Pinterest a request that will 400 anyway.
      if (!record.clip.thumbnailUrl) {
        throw new Error(
          `Clip ${record.clip.id} has no thumbnail available - Pinterest requires a cover image for video Pins`,
        );
      }
      const [videoStream, coverImageUrl] = await Promise.all([
        getObjectStream(outputUrl),
        getPresignedDownloadUrl(record.clip.thumbnailUrl, META_PRESIGNED_URL_TTL_SECONDS),
      ]);
      const upload = await uploadPinterestVideo({
        accessToken,
        boardId: record.socialAccount.platformAccountId,
        videoStream,
        title: record.clip.hookText || `Clip ${record.clip.id}`,
        description: buildCaption(record.clip.hookText, record.clip.hashtags),
        coverImageUrl,
      });
      return { platformPostId: upload.pinId, logDetail: `published as a Pinterest Pin, pin id ${upload.pinId}` };
    },
    async syncStats({ accessToken, platformPostId }) {
      return { kind: 'stats', stats: await fetchPinterestPinStats(accessToken, platformPostId) };
    },
    async fetchFollowerCount({ accessToken }) {
      return fetchPinterestFollowerCount(accessToken);
    },
  },
  [SocialPlatform.X]: {
    oauth: xOAuth,
    async publish({ record, outputUrl, accessToken }) {
      // Best-effort platform (see CLAUDE.md's Publish Center section) - a
      // billing/quota failure from X's API surfaces as a normal thrown
      // error here, which the caller (publish-clip.worker.ts) already
      // turns into PublishRecord.errorMessage/FAILED, the same honest-
      // status path every other publish failure uses. No special casing
      // needed for X specifically.
      const videoStream = await getObjectStream(outputUrl);
      const upload = await uploadXVideo({
        accessToken,
        videoStream,
        text: buildCaption(record.clip.hookText, record.clip.hashtags),
      });
      return { platformPostId: upload.tweetId, logDetail: `posted to X, tweet id ${upload.tweetId}` };
    },
    async syncStats({ accessToken, platformPostId }) {
      return { kind: 'stats', stats: await fetchXTweetStats(accessToken, platformPostId) };
    },
    async fetchFollowerCount({ accessToken }) {
      return fetchXFollowerCount(accessToken);
    },
  },
};

export function platformsWithStatsSync(): SocialPlatform[] {
  return (Object.entries(platformRegistry) as Array<[SocialPlatform, PlatformPublishAdapter]>)
    .filter(([, adapter]) => adapter.syncStats)
    .map(([platform]) => platform);
}

// Sprint 6F (Followers) - same "filter on adapter capability, not a second
// hand-maintained platform list" pattern as platformsWithStatsSync above.
// LinkedIn/Threads are naturally excluded (no fetchFollowerCount defined on
// their adapters) - TikTok IS included even though individual accounts may
// still fail until they reconnect (see fetchTikTokFollowerCount).
export function platformsWithFollowerSync(): SocialPlatform[] {
  return (Object.entries(platformRegistry) as Array<[SocialPlatform, PlatformPublishAdapter]>)
    .filter(([, adapter]) => adapter.fetchFollowerCount)
    .map(([platform]) => platform);
}
