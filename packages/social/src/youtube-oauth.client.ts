import { OAuth2Client } from 'google-auth-library';
import { OAuthNotConfiguredError } from './errors';

// youtube.upload is what the publish-clip job (Fase 6b) actually needs;
// requesting it since Fase 6a's connect flow avoids making users
// re-consent now that it's used. youtube.readonly is just for fetching
// the channel title/id to show in the "Connect account" UI.
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

export interface YouTubeTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface YouTubeChannel {
  channelId: string;
  title: string;
}

// GOOGLE_OAUTH_CLIENT_ID/SECRET are optional at boot in both apps/api and
// apps/worker - neither app has to stop working for everyone who hasn't
// set up a Google Cloud OAuth client yet. Missing config is only a real
// error at the point someone actually tries to connect/publish a YouTube
// account - callers translate OAuthNotConfiguredError into whatever's
// appropriate for their context (apps/api: a 503 response; apps/worker:
// just let the job fail and get reported to Sentry like any other error).
function requireOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new OAuthNotConfiguredError();
  }
  const apiBaseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
  return new OAuth2Client({
    clientId,
    clientSecret,
    // Must exactly match a redirect URI registered on the Google Cloud
    // OAuth client, including scheme/host/port/path. Only actually used by
    // the connect/callback dance (buildAuthorizeUrl/exchangeCode) - refresh/
    // revoke/API calls don't redirect anywhere, but OAuth2Client always
    // wants one at construction time.
    redirectUri: `${apiBaseUrl}/social/youtube/callback`,
  });
}

export class YouTubeOAuthClient {
  buildAuthorizeUrl(state: string): string {
    const client = requireOAuth2Client();
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      // Forces Google to return a refresh_token even if this user already
      // consented before - without this, a reconnect after a token was
      // revoked/lost would silently come back with no refresh_token.
      prompt: 'consent',
      state,
    });
  }

  async exchangeCode(code: string): Promise<YouTubeTokens> {
    const client = requireOAuth2Client();
    const { tokens } = await client.getToken(code);
    return toYouTubeTokens(tokens);
  }

  async refreshAccessToken(refreshToken: string): Promise<YouTubeTokens> {
    const client = requireOAuth2Client();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();
    // Google doesn't always re-return the refresh_token on a refresh
    // response - keep the one we already had.
    return toYouTubeTokens({
      ...credentials,
      refresh_token: credentials.refresh_token ?? refreshToken,
    });
  }

  // Best-effort - a caller disconnecting an account should still remove it
  // locally even if the token was already invalid/expired on Google's side.
  async revokeToken(token: string): Promise<void> {
    const client = requireOAuth2Client();
    await client.revokeToken(token);
  }

  async fetchChannelInfo(accessToken: string): Promise<YouTubeChannel> {
    const res = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!res.ok) {
      throw new Error(`YouTube channels.list failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      items?: Array<{ id: string; snippet?: { title?: string } }>;
    };
    const channel = body.items?.[0];
    if (!channel) {
      throw new Error('No YouTube channel found for this account');
    }
    return { channelId: channel.id, title: channel.snippet?.title ?? channel.id };
  }
}

function toYouTubeTokens(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}): YouTubeTokens {
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Google did not return both an access_token and a refresh_token');
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    // expiry_date is epoch ms; fall back to a conservative 1-hour default
    // in the (unexpected) case Google omits it.
    expiresAt: new Date(tokens.expiry_date ?? Date.now() + 60 * 60 * 1000),
  };
}
