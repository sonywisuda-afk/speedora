import { OAuthNotConfiguredError } from './errors';
import {
  deriveCodeChallenge,
  deriveCodeVerifier,
  X_API_BASE_URL,
  X_OAUTH_AUTHORIZE_URL,
  X_OAUTH_TOKEN_URL,
} from './x-graph';
import type { OAuthRefreshClient } from './resolve-access-token';

// offline.access is what makes X issue a refresh_token at all (without it,
// the access token is a hard 2-hour token with no way to renew) -
// tweet.write is what publish-clip.worker.ts needs to post; users.read is
// what fetchAccountInfo() needs for /2/users/me.
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];

export interface XTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface XAccount {
  userId: string; // X's own numeric user id - stored as SocialAccount.platformAccountId
  username: string;
}

interface XCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// X_CLIENT_ID/SECRET are optional at boot in both apps/api and apps/worker -
// same treatment as every other platform's credentials (see CLAUDE.md's
// Fase 6a/6d). Registered as a confidential client (client_secret via Basic
// Auth), same posture as every other OAuth client in this package.
function requireCredentials(): XCredentials {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new OAuthNotConfiguredError('X integration is not configured');
  }
  const apiBaseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
  return { clientId, clientSecret, redirectUri: `${apiBaseUrl}/social/x/callback` };
}

interface XTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface XErrorBody {
  title?: string;
  detail?: string;
}

function errorMessageOf(body: XErrorBody): string {
  return body.detail ?? body.title ?? '';
}

// No official X Node SDK maintained for this OAuth flow - hand-rolled via
// fetch(), same reasoning as every other platform's client in this package.
export class XOAuthClient implements OAuthRefreshClient {
  buildAuthorizeUrl(state: string): string {
    const { clientId, redirectUri } = requireCredentials();
    const codeChallenge = deriveCodeChallenge(deriveCodeVerifier(state));
    const url = new URL(X_OAUTH_AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  // Takes `state` as a second param (unlike every other platform's
  // exchangeCode(code)) purely to re-derive the same PKCE code_verifier
  // buildAuthorizeUrl() used - see x-graph.ts's deriveCodeVerifier()
  // comment. SocialController.callback() already has `state` in scope
  // (verified just before this call), so this is a same-signature-family
  // addition, not new state to thread through.
  async exchangeCode(code: string, state: string): Promise<XTokens> {
    const { redirectUri } = requireCredentials();
    const codeVerifier = deriveCodeVerifier(state);
    return requestTokens({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
  }

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const tokens = await requestTokens({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return {
      accessToken: tokens.accessToken,
      // X rotates the refresh token on every use (like TikTok) - the
      // response always includes a new one for this grant type.
      refreshToken: tokens.refreshToken || refreshToken,
      expiresAt: tokens.expiresAt,
    };
  }

  async fetchAccountInfo(accessToken: string): Promise<XAccount> {
    const res = await fetch(`${X_API_BASE_URL}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json()) as { data?: { id?: string; username?: string } } & {
      errors?: XErrorBody[];
    };
    if (!res.ok || !body.data?.id) {
      throw new Error(
        `X users/me failed: ${res.status} ${errorMessageOf(body.errors?.[0] ?? {})}`.trim(),
      );
    }
    return { userId: body.data.id, username: body.data.username ?? body.data.id };
  }

  // X's OAuth 2.0 implementation supports RFC 7009 token revocation, but
  // it's undocumented for third-party confidential clients in the current
  // v2 docs - disconnect just removes the local row, same posture as
  // Threads'/LinkedIn's/Pinterest's revokeToken().
  async revokeToken(_token: string): Promise<void> {
    return Promise.resolve();
  }
}

async function requestTokens(
  params: Record<string, string>,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const { clientId, clientSecret } = requireCredentials();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(X_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ ...params, client_id: clientId }),
  });
  const body = (await res.json()) as XTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(
      `X oauth2/token failed: ${res.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim(),
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? '',
    // 2-hour default matches X's non-offline-access token lifespan; with
    // offline.access (always requested here) X returns a real expires_in.
    expiresAt: new Date(Date.now() + (body.expires_in ?? 2 * 60 * 60) * 1000),
  };
}
