import { OAuthNotConfiguredError } from './errors';
import type { OAuthRefreshClient } from './resolve-access-token';
import {
  THREADS_AUTHORIZE_URL,
  THREADS_GRAPH_BASE_URL,
  THREADS_OAUTH_BASE_URL,
} from './threads-graph';

// threads_basic is mandatory for any Threads API call; threads_content_publish
// is what publish-clip.worker.ts needs to actually post. Unlike Instagram/
// Facebook, there's no linked-Page indirection - the Threads user access
// token itself is what publish/stats calls use directly (see
// SocialAccountsService.connectThreads).
const SCOPES = ['threads_basic', 'threads_content_publish'];

export interface ThreadsTokens {
  accessToken: string; // long-lived Threads USER access token, used directly for API calls
  expiresAt: Date;
}

export interface ThreadsUser {
  threadsUserId: string;
  username: string;
}

interface ThreadsCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// THREADS_CLIENT_ID/SECRET are a SEPARATE Meta app registration from
// FACEBOOK_APP_ID/SECRET (Threads has its own app type in the Meta
// Developer console) - optional at boot, same treatment as every other
// platform's credentials (see CLAUDE.md's Fase 6a/6d).
function requireCredentials(): ThreadsCredentials {
  const clientId = process.env.THREADS_CLIENT_ID;
  const clientSecret = process.env.THREADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new OAuthNotConfiguredError('Threads integration is not configured');
  }
  const apiBaseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
  return {
    clientId,
    clientSecret,
    // Must exactly match a redirect URI registered on the Threads app.
    redirectUri: `${apiBaseUrl}/social/threads/callback`,
  };
}

interface ThreadsTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface ThreadsErrorResponse {
  error?: { message?: string } | string;
}

function errorMessageOf(body: ThreadsErrorResponse): string {
  if (typeof body.error === 'string') return body.error;
  return body.error?.message ?? '';
}

// No official Meta Node SDK for Threads - hand-rolled via fetch(), same
// reasoning as every other platform's client in this package.
export class ThreadsOAuthClient implements OAuthRefreshClient {
  buildAuthorizeUrl(state: string): string {
    const { clientId, redirectUri } = requireCredentials();
    const url = new URL(THREADS_AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', SCOPES.join(','));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url.toString();
  }

  // Exchanges the code for a short-lived (1 hour) token, then immediately
  // exchanges that for a long-lived (60 day) one - same two-step shape as
  // Instagram/Facebook's long-lived token dance, just Threads' own
  // th_exchange_token grant type rather than fb_exchange_token.
  async exchangeCode(code: string): Promise<ThreadsTokens> {
    const { clientId, clientSecret, redirectUri } = requireCredentials();
    const res = await fetch(`${THREADS_OAUTH_BASE_URL}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const body = (await res.json()) as { access_token?: string } & ThreadsErrorResponse;
    if (!res.ok || !body.access_token) {
      throw new Error(
        `Threads oauth/access_token failed: ${res.status} ${errorMessageOf(body)}`.trim(),
      );
    }

    return this.exchangeForLongLivedToken(body.access_token);
  }

  private async exchangeForLongLivedToken(shortLivedToken: string): Promise<ThreadsTokens> {
    const { clientSecret } = requireCredentials();
    const url = new URL(`${THREADS_OAUTH_BASE_URL}/access_token`);
    url.searchParams.set('grant_type', 'th_exchange_token');
    url.searchParams.set('client_secret', clientSecret);
    url.searchParams.set('access_token', shortLivedToken);
    const res = await fetch(url);
    const body = (await res.json()) as ThreadsTokenResponse & ThreadsErrorResponse;
    if (!res.ok || !body.access_token) {
      throw new Error(
        `Threads long-lived exchange failed: ${res.status} ${errorMessageOf(body)}`.trim(),
      );
    }

    return {
      accessToken: body.access_token,
      expiresAt: new Date(Date.now() + (body.expires_in ?? 60 * 24 * 60 * 60) * 1000),
    };
  }

  async fetchAccountInfo(accessToken: string): Promise<ThreadsUser> {
    const url = new URL(`${THREADS_GRAPH_BASE_URL}/me`);
    url.searchParams.set('fields', 'id,username');
    url.searchParams.set('access_token', accessToken);
    const res = await fetch(url);
    const body = (await res.json()) as { id?: string; username?: string } & ThreadsErrorResponse;
    if (!res.ok || !body.id) {
      throw new Error(`Threads profile fetch failed: ${res.status} ${errorMessageOf(body)}`.trim());
    }
    return { threadsUserId: body.id, username: body.username ?? body.id };
  }

  // Unlike Instagram/Facebook's "re-exchange the user token, re-derive a
  // Page token" dance, Threads refreshes its own long-lived token directly
  // via th_refresh_token - no app secret needed for this call (per Meta's
  // docs), no separate Page-token indirection to re-derive.
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const url = new URL(`${THREADS_OAUTH_BASE_URL}/refresh_access_token`);
    url.searchParams.set('grant_type', 'th_refresh_token');
    url.searchParams.set('access_token', refreshToken);
    const res = await fetch(url);
    const body = (await res.json()) as ThreadsTokenResponse & ThreadsErrorResponse;
    if (!res.ok || !body.access_token) {
      throw new Error(`Threads token refresh failed: ${res.status} ${errorMessageOf(body)}`.trim());
    }
    const expiresAt = new Date(Date.now() + (body.expires_in ?? 60 * 24 * 60 * 60) * 1000);
    // No distinct refresh_token concept - the long-lived access token
    // itself is what gets refreshed and re-stored as both fields, same
    // "one token, no separate refresh_token" model as Instagram/Facebook's
    // long-lived USER token (just without the extra Page-token derivation
    // step those two have).
    return { accessToken: body.access_token, refreshToken: body.access_token, expiresAt };
  }

  // Meta's Threads API has no documented token-revoke endpoint - disconnect
  // just removes the local row (see SocialAccountsService.disconnect's
  // best-effort revokeToken() call). Same (token: string): Promise<void>
  // signature as every other platform's client - SocialAccountsService's
  // clientFor() return type is a union of these concrete classes, so a
  // mismatched arity here would break every call site, not just this one.
  async revokeToken(_token: string): Promise<void> {
    void _token;
    return Promise.resolve();
  }
}
