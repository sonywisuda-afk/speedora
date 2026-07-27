import { Injectable } from '@nestjs/common';
import { OAuthNotConfiguredError } from '@speedora/social';
import type { OAuthLoginAdapter, OAuthProfile } from './oauth-provider.interface';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const EMAILS_URL = 'https://api.github.com/user/emails';

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

// No GitHub SDK dependency exists anywhere in this codebase (confirmed
// during planning) - plain fetch (Node 24 native) for both the token
// exchange and profile/email fetch, same posture as Sprint 4's
// TurnstileCaptchaProvider using fetch instead of adding a new HTTP client.
function requireCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new OAuthNotConfiguredError('GitHub sign-in is not configured');
  }
  return { clientId, clientSecret };
}

function redirectUri(): string {
  const apiBaseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
  return `${apiBaseUrl}/auth/oauth/github/callback`;
}

@Injectable()
export class GitHubOAuthLoginProvider implements OAuthLoginAdapter {
  buildAuthorizeUrl(state: string): string {
    const { clientId } = requireCredentials();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      // user:email - the only scope this flow needs; GitHub's default
      // /user response omits email entirely for accounts with a private
      // email, which is why fetchProfile below falls back to /user/emails.
      scope: 'user:email',
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{ accessToken: string }> {
    const { clientId, clientSecret } = requireCredentials();
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri(),
      }),
    });
    const body = (await res.json()) as { access_token?: string; error?: string };
    if (!body.access_token) {
      throw new Error(`GitHub token exchange failed: ${body.error ?? res.status}`);
    }
    return { accessToken: body.access_token };
  }

  async fetchProfile(tokens: { accessToken: string }): Promise<OAuthProfile> {
    const headers = {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: 'application/vnd.github+json',
    };

    const userRes = await fetch(USER_URL, { headers });
    if (!userRes.ok) {
      throw new Error(`GitHub /user failed: ${userRes.status} ${await userRes.text()}`);
    }
    const user = (await userRes.json()) as { id: number; email: string | null; name?: string };

    let email = user.email;
    if (!email) {
      // Private primary email - the only way to get a verified email in
      // that case is the dedicated emails endpoint (requires user:email
      // scope, already requested above).
      const emailsRes = await fetch(EMAILS_URL, { headers });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as GitHubEmail[];
        email = emails.find((e) => e.primary && e.verified)?.email ?? null;
      }
    }

    if (!email) {
      throw new Error('GitHub account has no verified email address');
    }

    return { providerAccountId: String(user.id), email, name: user.name };
  }
}
