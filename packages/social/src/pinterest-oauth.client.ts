import { OAuthNotConfiguredError } from './errors';
import { PINTEREST_API_BASE_URL, PINTEREST_OAUTH_AUTHORIZE_URL, PINTEREST_OAUTH_TOKEN_URL } from './pinterest-graph';
import type { OAuthRefreshClient } from './resolve-access-token';

// boards:read is what fetchAccountInfo() needs to pick a target board (see
// its own comment below); pins:write is what publish-clip.worker.ts needs
// to create the Pin; pins:read/user_accounts:read are the associated read
// scopes Pinterest's own docs recommend requesting alongside a write scope.
const SCOPES = ['boards:read', 'pins:read', 'pins:write', 'user_accounts:read'];

export interface PinterestTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// Unlike every other platform's SocialAccount.platformAccountId (the
// account/channel/Page id), this is a Pinterest BOARD id - Pin creation has
// no per-account URL segment (POST /v5/pins is account-implied by the
// access token), but does require a board_id in every request body. Storing
// the board id here keeps this field's "the identifier of the thing we
// publish to" meaning consistent across every platform in this package,
// without a schema change to add a separate "target board" column.
export interface PinterestAccount {
  boardId: string;
  displayName: string; // "{username} — {board name}", shown in the Connect UI
}

interface PinterestCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// PINTEREST_APP_ID/SECRET are optional at boot in both apps/api and
// apps/worker - same treatment as every other platform's credentials (see
// CLAUDE.md's Fase 6a/6d).
function requireCredentials(): PinterestCredentials {
  const clientId = process.env.PINTEREST_APP_ID;
  const clientSecret = process.env.PINTEREST_APP_SECRET;
  if (!clientId || !clientSecret) {
    throw new OAuthNotConfiguredError('Pinterest integration is not configured');
  }
  const apiBaseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
  return {
    clientId,
    clientSecret,
    redirectUri: `${apiBaseUrl}/social/pinterest/callback`,
  };
}

interface PinterestTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  message?: string;
}

interface PinterestErrorBody {
  message?: string;
}

// No official Pinterest Node SDK maintained for this flow - hand-rolled via
// fetch(), same reasoning as every other platform's client in this package.
export class PinterestOAuthClient implements OAuthRefreshClient {
  buildAuthorizeUrl(state: string): string {
    const { clientId, redirectUri } = requireCredentials();
    const url = new URL(PINTEREST_OAUTH_AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(','));
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<PinterestTokens> {
    const { redirectUri } = requireCredentials();
    return requestTokens({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  }

  // Pinterest's "continuous refresh token" - 60-day expiry, refreshable
  // indefinitely, but a fresh refresh_token isn't always returned on every
  // call (unlike TikTok's unconditional rotation) - keep the one already
  // stored if this response omits it.
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
    const tokens = await requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken });
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || refreshToken,
      expiresAt: tokens.expiresAt,
    };
  }

  // Picks the FIRST board the user has (same "revisit with a picker UI if
  // needed" call as Instagram/Facebook's first-Page selection) - Pinterest
  // has no "default board" concept of its own to defer to instead.
  async fetchAccountInfo(accessToken: string): Promise<PinterestAccount> {
    const headers = { Authorization: `Bearer ${accessToken}` };

    const accountRes = await fetch(`${PINTEREST_API_BASE_URL}/user_account`, { headers });
    const accountBody = (await accountRes.json()) as { username?: string } & PinterestErrorBody;
    if (!accountRes.ok || !accountBody.username) {
      throw new Error(
        `Pinterest user_account fetch failed: ${accountRes.status} ${accountBody.message ?? ''}`.trim(),
      );
    }

    const boardsRes = await fetch(`${PINTEREST_API_BASE_URL}/boards`, { headers });
    const boardsBody = (await boardsRes.json()) as {
      items?: Array<{ id: string; name: string }>;
    } & PinterestErrorBody;
    if (!boardsRes.ok) {
      throw new Error(
        `Pinterest boards fetch failed: ${boardsRes.status} ${boardsBody.message ?? ''}`.trim(),
      );
    }
    const board = boardsBody.items?.[0];
    if (!board) {
      throw new Error('No Pinterest board found - create at least one board to connect this account');
    }

    return { boardId: board.id, displayName: `${accountBody.username} — ${board.name}` };
  }

  // Pinterest's API has no documented token-revoke endpoint - disconnect
  // just removes the local row, same posture as Threads'/LinkedIn's
  // revokeToken().
  async revokeToken(_token: string): Promise<void> {
    return Promise.resolve();
  }
}

// Only access_token is required here - the refresh_token grant doesn't
// always echo back a refresh_token (Pinterest's continuous-refresh model
// can extend the existing one in place), so refreshAccessToken() above
// falls back to the one it already had rather than this helper enforcing
// its presence.
async function requestTokens(
  params: Record<string, string>,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const { clientId, clientSecret } = requireCredentials();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(PINTEREST_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  const body = (await res.json()) as PinterestTokenResponse;
  if (!res.ok || !body.access_token) {
    throw new Error(`Pinterest oauth/token failed: ${res.status} ${body.message ?? ''}`.trim());
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? '',
    expiresAt: new Date(Date.now() + (body.expires_in ?? 30 * 24 * 60 * 60) * 1000),
  };
}
