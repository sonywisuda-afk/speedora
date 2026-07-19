import { OAuthNotConfiguredError } from './errors';
import type { OAuthRefreshClient } from './resolve-access-token';

// video.upload is the "Upload to Inbox" (draft) scope - it works without
// TikTok's audit for the "direct public post" capability (video.publish
// scope), which is why Fase 6d built against Upload to Inbox instead of
// Direct Post (see CLAUDE.md's Fase 6d section). user.info.basic is just
// for the display name shown in the "Connect account" UI. video.list is
// what sync-publish-stats.worker.ts (Fase 6e) needs to query view/like/
// comment counts, once a post actually goes public (see CLAUDE.md's Fase
// 6e section) - accounts connected before this scope was added need to
// reconnect to pick it up. user.info.stats (Sprint 6F) is what
// sync-follower-count.worker.ts needs for follower_count - same
// "reconnect to pick up a scope added after they first connected" caveat
// applies; an account that hasn't reconnected yet just gets no follower
// snapshots (platform-capability.util.ts already models this as
// 'needs-reconnect', not a hard failure).
const SCOPES = ['user.info.basic', 'video.upload', 'video.list', 'user.info.stats'];

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface TikTokUser {
  openId: string;
  displayName: string;
}

interface TikTokCredentials {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
}

// TIKTOK_CLIENT_KEY/SECRET are optional at boot in both apps/api and
// apps/worker - same treatment as GOOGLE_OAUTH_CLIENT_ID/SECRET (Fase 6a):
// neither app has to stop working for everyone who hasn't set up a TikTok
// Developer app yet. Missing config is only a real error at the point
// someone actually tries to connect/publish a TikTok account.
function requireCredentials(): TikTokCredentials {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new OAuthNotConfiguredError('TikTok integration is not configured');
  }
  const apiBaseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
  return {
    clientKey,
    clientSecret,
    // Must exactly match a redirect URI registered on the TikTok Developer
    // app, including scheme/host/port/path.
    redirectUri: `${apiBaseUrl}/social/tiktok/callback`,
  };
}

// No official TikTok Node SDK exists (unlike Google's google-auth-library/
// googleapis) - hand-rolling these HTTP calls via fetch() isn't a deviation
// from Fase 6a/6b's "prefer an official client library" reasoning, there's
// simply nothing to prefer instead for TikTok.
export class TikTokOAuthClient implements OAuthRefreshClient {
  buildAuthorizeUrl(state: string): string {
    const { clientKey, redirectUri } = requireCredentials();
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_key', clientKey);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(','));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<TikTokTokens> {
    const { clientKey, clientSecret, redirectUri } = requireCredentials();
    return requestTokens({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
  }

  // Unlike Google (which keeps the same refresh_token across refreshes
  // unless explicitly re-consented), TikTok rotates the refresh_token on
  // every refresh - the newly-returned one is always used, no "keep the
  // old one if omitted" fallback needed here.
  async refreshAccessToken(refreshToken: string): Promise<TikTokTokens> {
    const { clientKey, clientSecret } = requireCredentials();
    return requestTokens({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  // Best-effort - a caller disconnecting an account should still remove it
  // locally even if the token was already invalid/expired on TikTok's side.
  async revokeToken(token: string): Promise<void> {
    const { clientKey, clientSecret } = requireCredentials();
    const res = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, token }),
    });
    if (!res.ok) {
      throw new Error(`TikTok oauth/revoke failed: ${res.status} ${await res.text()}`);
    }
  }

  async fetchUserInfo(accessToken: string): Promise<TikTokUser> {
    const url = new URL(USER_INFO_URL);
    url.searchParams.set('fields', 'open_id,display_name');
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`TikTok user/info failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      data?: { user?: { open_id?: string; display_name?: string } };
    };
    const user = body.data?.user;
    if (!user?.open_id) {
      throw new Error('TikTok did not return a user open_id');
    }
    return { openId: user.open_id, displayName: user.display_name ?? user.open_id };
  }
}

async function requestTokens(params: Record<string, string>): Promise<TikTokTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams(params),
  });
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new Error(
      `TikTok oauth/token failed: ${res.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim(),
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    // expires_in is seconds-from-now (unlike Google's absolute epoch-ms
    // expiry_date) - converted to an absolute Date here so callers (and
    // resolveAccessToken()) don't need to care about the difference.
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
  };
}
