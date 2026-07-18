import { OAuthNotConfiguredError } from './errors';
import { LINKEDIN_OAUTH_AUTHORIZE_URL, LINKEDIN_OAUTH_TOKEN_URL, LINKEDIN_USERINFO_URL } from './linkedin-graph';
import type { OAuthRefreshClient } from './resolve-access-token';

// openid+profile (OpenID Connect "Sign In with LinkedIn") is what
// fetchAccountInfo() below needs to resolve the connecting member's own
// urn:li:person id; w_member_social is what publish-clip.worker.ts needs to
// post on their behalf. This connects the member's OWN personal profile,
// not a company Page - the LinkedIn analog of "connect your own channel/
// account" (YouTube/TikTok), not Facebook Reels' Page-admin model.
const SCOPES = ['openid', 'profile', 'w_member_social'];

export interface LinkedInTokens {
  accessToken: string;
  // LinkedIn only issues a refresh_token to apps in its "Programmatic
  // Refresh Tokens" partner program - most apps get none, and a lapsed
  // 60-day access token requires the member to go through the browser
  // consent flow again. null (not a throw) so a connected account without
  // one still stores cleanly; resolveAccessToken()'s refresh attempt simply
  // fails with a clear error once the access token actually expires, same
  // "let the real error surface at the point it matters" posture as every
  // other OAuthNotConfiguredError-style gap in this package.
  refreshToken: string | null;
  expiresAt: Date;
}

export interface LinkedInMember {
  personUrn: string; // urn:li:person:{sub} - stored as SocialAccount.platformAccountId
  name: string;
}

interface LinkedInCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// LINKEDIN_CLIENT_ID/SECRET are optional at boot in both apps/api and
// apps/worker - same treatment as every other platform's credentials (see
// CLAUDE.md's Fase 6a/6d). Missing config is only a real error at the point
// someone actually tries to connect/publish a LinkedIn account.
function requireCredentials(): LinkedInCredentials {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new OAuthNotConfiguredError('LinkedIn integration is not configured');
  }
  const apiBaseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
  return {
    clientId,
    clientSecret,
    // Must exactly match a redirect URL registered on the LinkedIn app -
    // LinkedIn requires this to be an absolute URL with no query string/
    // fragment (see LinkedIn's Auth tab docs).
    redirectUri: `${apiBaseUrl}/social/linkedin/callback`,
  };
}

interface LinkedInTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

// No official LinkedIn Node SDK maintained for this flow - hand-rolled via
// fetch(), same reasoning as every other platform's client in this package.
export class LinkedInOAuthClient implements OAuthRefreshClient {
  buildAuthorizeUrl(state: string): string {
    const { clientId, redirectUri } = requireCredentials();
    const url = new URL(LINKEDIN_OAUTH_AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<LinkedInTokens> {
    const { clientId, clientSecret, redirectUri } = requireCredentials();
    return requestTokens({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
  }

  // Only works for apps LinkedIn has enrolled in the Programmatic Refresh
  // Tokens program (see LinkedInTokens.refreshToken's comment) - fails with
  // a clear error otherwise, surfaced the same way every other refresh
  // failure in this codebase is (Sentry/logged, not silently swallowed).
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const { clientId, clientSecret } = requireCredentials();
    const tokens = await requestTokens({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? refreshToken,
      expiresAt: tokens.expiresAt,
    };
  }

  // OpenID Connect userinfo endpoint - `sub` is the member's own opaque id,
  // used to construct the urn:li:person URN stored as
  // SocialAccount.platformAccountId.
  async fetchAccountInfo(accessToken: string): Promise<LinkedInMember> {
    const res = await fetch(LINKEDIN_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json()) as { sub?: string; name?: string; message?: string };
    if (!res.ok || !body.sub) {
      throw new Error(`LinkedIn userinfo failed: ${res.status} ${body.message ?? ''}`.trim());
    }
    return { personUrn: `urn:li:person:${body.sub}`, name: body.name ?? body.sub };
  }

  // LinkedIn's API has no documented token-revoke endpoint - disconnect
  // just removes the local row, same posture as Threads' revokeToken().
  async revokeToken(_token: string): Promise<void> {
    return Promise.resolve();
  }
}

async function requestTokens(params: Record<string, string>): Promise<LinkedInTokens> {
  const res = await fetch(LINKEDIN_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = (await res.json()) as LinkedInTokenResponse;
  if (!res.ok || !body.access_token) {
    throw new Error(
      `LinkedIn oauth/accessToken failed: ${res.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim(),
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    // expires_in is seconds-from-now, like TikTok/Instagram - converted to
    // an absolute Date so callers (and resolveAccessToken()) don't need to
    // care about the difference from Google's absolute epoch-ms style.
    // 60-day default matches LinkedIn's fixed access-token lifespan.
    expiresAt: new Date(Date.now() + (body.expires_in ?? 60 * 24 * 60 * 60) * 1000),
  };
}
