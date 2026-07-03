import { OAuthNotConfiguredError } from './errors';
import type { OAuthRefreshClient } from './resolve-access-token';

// Bump this as Meta deprecates old Graph API versions.
const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const AUTHORIZE_URL = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;

// instagram_content_publish is what publish-clip.worker.ts (Fase 6d) needs;
// pages_show_list/pages_read_engagement are needed to look up which Facebook
// Page (and its linked Instagram Business account) the user manages - see
// CLAUDE.md's Fase 6d "Instagram" section for why a linked Page is required
// at all (the classic Facebook Login flow, chosen over Meta's newer
// standalone Instagram Login).
const SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
];

export interface InstagramTokens {
  accessToken: string; // long-lived USER access token (NOT the Page token used for API calls)
  expiresAt: Date;
}

export interface InstagramAccount {
  igUserId: string; // Instagram Business Account id - stored as SocialAccount.platformAccountId
  username: string;
  pageAccessToken: string; // the token actually used for Content Publishing API calls
}

interface InstagramCredentials {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

// FACEBOOK_APP_ID/APP_SECRET are optional at boot in both apps/api and
// apps/worker - same treatment as the Google/TikTok credentials (Fase 6a/
// 6d): neither app has to stop working for everyone who hasn't set up a
// Meta app yet. Missing config is only a real error at the point someone
// actually tries to connect/publish an Instagram account.
function requireCredentials(): InstagramCredentials {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) {
    throw new OAuthNotConfiguredError('Instagram integration is not configured');
  }
  const apiBaseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
  return {
    appId,
    appSecret,
    // Must exactly match a redirect URI registered on the Meta app.
    redirectUri: `${apiBaseUrl}/social/instagram/callback`,
  };
}

interface GraphTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface GraphErrorResponse {
  error?: { message?: string; type?: string; code?: number };
}

async function graphGet<T>(url: URL): Promise<T> {
  const res = await fetch(url);
  const body = (await res.json()) as T & GraphErrorResponse;
  if (!res.ok || body.error) {
    throw new Error(
      `Instagram Graph API request failed: ${res.status} ${body.error?.message ?? ''}`.trim(),
    );
  }
  return body;
}

// No official Meta/Facebook Node SDK for this flow is maintained for
// general use (unlike Google's google-auth-library/googleapis) - hand-
// rolling via fetch() isn't a deviation from Fase 6a/6b's "prefer an
// official client library" reasoning, there's simply nothing suitable to
// prefer instead.
export class InstagramOAuthClient implements OAuthRefreshClient {
  buildAuthorizeUrl(state: string): string {
    const { appId, redirectUri } = requireCredentials();
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', SCOPES.join(','));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url.toString();
  }

  // Exchanges the authorization code for a short-lived user token, then
  // immediately exchanges that for a long-lived one (~60 days) - Facebook's
  // Graph API doesn't hand out a classic OAuth refresh_token for this flow;
  // instead the long-lived access token itself is what gets periodically
  // re-exchanged (see refreshAccessToken() below).
  async exchangeCode(code: string): Promise<InstagramTokens> {
    const { appId, appSecret, redirectUri } = requireCredentials();
    const shortLivedUrl = new URL(`${GRAPH_BASE_URL}/oauth/access_token`);
    shortLivedUrl.searchParams.set('client_id', appId);
    shortLivedUrl.searchParams.set('client_secret', appSecret);
    shortLivedUrl.searchParams.set('redirect_uri', redirectUri);
    shortLivedUrl.searchParams.set('code', code);
    const shortLived = await graphGet<GraphTokenResponse>(shortLivedUrl);

    return this.exchangeForLongLivedToken(shortLived.access_token);
  }

  private async exchangeForLongLivedToken(token: string): Promise<InstagramTokens> {
    const { appId, appSecret } = requireCredentials();
    const url = new URL(`${GRAPH_BASE_URL}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('fb_exchange_token', token);
    const longLived = await graphGet<GraphTokenResponse>(url);

    return {
      accessToken: longLived.access_token,
      // expires_in is seconds-from-now, like TikTok - converted to an
      // absolute Date so callers (and resolveAccessToken()) don't need to
      // care about the difference from Google's absolute epoch-ms style.
      expiresAt: new Date(Date.now() + (longLived.expires_in ?? 60 * 24 * 60 * 60) * 1000),
    };
  }

  // Looks up which Facebook Page (of the ones this user manages) has an
  // Instagram Business/Creator account linked, and that Page's own access
  // token - the token actually used for all Content Publishing API calls
  // against that Instagram account, not the user token. Picks the FIRST
  // eligible Page - a user with multiple Pages/IG accounts would need a
  // picker UI to choose otherwise, out of scope for this first pass (same
  // "simplify, revisit if needed" call as auto-selecting the first firing
  // repeatable job elsewhere in this project).
  async fetchAccountInfo(userAccessToken: string): Promise<InstagramAccount> {
    const url = new URL(`${GRAPH_BASE_URL}/me/accounts`);
    url.searchParams.set('fields', 'access_token,instagram_business_account{id,username}');
    url.searchParams.set('access_token', userAccessToken);
    const body = await graphGet<{
      data?: Array<{
        access_token: string;
        instagram_business_account?: { id: string; username: string };
      }>;
    }>(url);

    const page = body.data?.find((entry) => entry.instagram_business_account);
    if (!page?.instagram_business_account) {
      throw new Error(
        'No Instagram Business/Creator account found - link one to a Facebook Page you manage',
      );
    }
    return {
      igUserId: page.instagram_business_account.id,
      username: page.instagram_business_account.username,
      pageAccessToken: page.access_token,
    };
  }

  // The stored `refreshToken` here is actually the previously-issued
  // long-lived USER token (see SocialAccountsService.connectInstagram) -
  // re-exchanging it yields a fresh long-lived user token, from which a
  // fresh Page access token is re-derived the same way exchangeCode() does.
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const refreshedUserToken = await this.exchangeForLongLivedToken(refreshToken);
    const account = await this.fetchAccountInfo(refreshedUserToken.accessToken);
    return {
      accessToken: account.pageAccessToken,
      refreshToken: refreshedUserToken.accessToken,
      expiresAt: refreshedUserToken.expiresAt,
    };
  }

  // Best-effort - revokes ALL of this app's permissions for the user (Meta
  // has no narrower "just this one token" revoke), same as a caller
  // disconnecting an account should still remove it locally even if this
  // fails (e.g. token already invalid on Meta's side).
  async revokeToken(token: string): Promise<void> {
    const url = new URL(`${GRAPH_BASE_URL}/me/permissions`);
    url.searchParams.set('access_token', token);
    const res = await fetch(url, { method: 'DELETE' });
    const body = (await res.json().catch(() => ({}))) as GraphErrorResponse;
    if (!res.ok || body.error) {
      throw new Error(
        `Instagram permissions revoke failed: ${res.status} ${body.error?.message ?? ''}`.trim(),
      );
    }
  }
}
