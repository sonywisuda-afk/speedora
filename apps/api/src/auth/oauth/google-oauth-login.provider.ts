import { Injectable } from '@nestjs/common';
import { OAuthNotConfiguredError } from '@speedora/social';
import { OAuth2Client } from 'google-auth-library';
import type { OAuthLoginAdapter, OAuthProfile } from './oauth-provider.interface';

// Login-only scopes - deliberately NOT packages/social's youtube.upload/
// youtube.readonly (this flow never touches YouTube's API). Reuses the
// SAME GOOGLE_OAUTH_CLIENT_ID/SECRET already configured for YouTube
// publishing - one Google Cloud OAuth client can register multiple
// redirect URIs and request different scopes per flow; only a new
// authorized redirect URI needs adding in Google Cloud Console, not a new
// OAuth app.
const SCOPES = ['openid', 'email', 'profile'];

// Same "optional at boot, only a real error at the point someone actually
// tries to use it" posture as packages/social's youtube-oauth.client.ts -
// GOOGLE_OAUTH_CLIENT_ID/SECRET being unset doesn't stop apps/api from
// booting, it just means the "Continue with Google" link 503s if clicked.
function requireOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new OAuthNotConfiguredError('Google sign-in is not configured');
  }
  const apiBaseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;
  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: `${apiBaseUrl}/auth/oauth/google/callback`,
  });
}

@Injectable()
export class GoogleOAuthLoginProvider implements OAuthLoginAdapter {
  buildAuthorizeUrl(state: string): string {
    const client = requireOAuth2Client();
    return client.generateAuthUrl({
      // Login only needs the ID token's claims for this one request - no
      // access_type: 'offline'/prompt: 'consent' (those exist to force a
      // refresh_token for later unattended API calls, which this flow
      // never makes).
      scope: SCOPES,
      state,
    });
  }

  async exchangeCode(code: string): Promise<{ accessToken: string; idToken?: string }> {
    const client = requireOAuth2Client();
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token) {
      throw new Error('Google did not return an access_token');
    }
    return { accessToken: tokens.access_token, idToken: tokens.id_token ?? undefined };
  }

  // Verifies + decodes the ID token directly (Google's own recommended
  // pattern for "who signed in") rather than a second profile API call -
  // the ID token is a signed JWT Google already handed back in the token
  // exchange above.
  async fetchProfile(tokens: { accessToken: string; idToken?: string }): Promise<OAuthProfile> {
    if (!tokens.idToken) {
      throw new Error('Google did not return an id_token');
    }
    const client = requireOAuth2Client();
    const ticket = await client.verifyIdToken({
      idToken: tokens.idToken,
      audience: process.env.GOOGLE_OAUTH_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new Error('Google ID token is missing sub/email claims');
    }
    if (!payload.email_verified) {
      throw new Error('Google account email is not verified');
    }
    return { providerAccountId: payload.sub, email: payload.email, name: payload.name };
  }
}
