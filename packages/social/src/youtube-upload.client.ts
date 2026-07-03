import type { Readable } from 'node:stream';
import { google } from 'googleapis';

// googleapis vendors its own copy of google-auth-library internally, whose
// OAuth2Client type doesn't structurally match the standalone
// google-auth-library package used by youtube-oauth.client.ts for the
// connect/refresh/revoke flow (even at matching semver ranges - a classic
// "two copies of the same-named type" pnpm/TS pain point). Constructing
// the auth object via googleapis' own google.auth.OAuth2 here, instead of
// reusing youtube-oauth.client.ts's OAuth2Client, sidesteps that entirely.
function authorizedClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

export interface YouTubeUploadParams {
  accessToken: string;
  title: string;
  description: string;
  videoStream: Readable;
  // Defaults to 'unlisted' - see CLAUDE.md's Fase 6b section for why: safe
  // for "prove the publish pipe works" without risking a mis-picked clip
  // or an off caption going straight to a public feed on the first real
  // run of this code path.
  privacyStatus?: 'private' | 'unlisted' | 'public';
}

export interface YouTubeUploadResult {
  videoId: string;
  url: string;
}

// Uses the official googleapis client (which itself uses google-auth-
// library under the hood) rather than hand-rolling YouTube's resumable
// upload protocol via raw fetch - the same reasoning as YouTubeOAuthClient
// using OAuth2Client instead of raw HTTP calls for the OAuth dance: a
// subtly wrong from-scratch implementation of a multi-request upload
// protocol is a much more expensive class of bug than the dependency
// weight of using the real client.
export async function uploadYouTubeVideo(
  params: YouTubeUploadParams,
): Promise<YouTubeUploadResult> {
  const { accessToken, title, description, videoStream, privacyStatus = 'unlisted' } = params;
  const youtube = google.youtube('v3');

  const res = await youtube.videos.insert({
    auth: authorizedClient(accessToken),
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title, description },
      status: { privacyStatus },
    },
    media: { body: videoStream },
  });

  const videoId = res.data.id;
  if (!videoId) {
    throw new Error('YouTube videos.insert did not return a video id');
  }
  return { videoId, url: `https://youtu.be/${videoId}` };
}
