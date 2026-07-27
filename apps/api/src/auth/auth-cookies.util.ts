import type { Response } from 'express';
import type { SessionTokens } from './auth.service';

// Extracted out of AuthController (Tahap 2 Step 1) - OAuthController needs
// the exact same cookie-setting logic and duplicating security-sensitive
// cookie flags (httpOnly/sameSite/secure/path) across two controllers risks
// them drifting out of sync if one is ever changed without the other.

const ACCESS_COOKIE_NAME = 'token';
// Kept in sync with the ACCESS_TOKEN_EXPIRES_IN default (15m, see
// .env.example / auth.module.ts). The JWT's own expiry is what's actually
// enforced; this just keeps the browser from holding onto an unusable
// cookie long after that.
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

// Authentication Foundation Sprint 1 - a second, narrower-scoped cookie for
// the opaque refresh token. Path is scoped to /auth (not '/') so it's only
// ever sent to the handful of routes that actually consume it
// (refresh/logout/logout-all/oauth callbacks), shrinking its exposure
// versus a site-wide cookie.
export const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/auth';

export function setAuthCookies(res: Response, tokens: SessionTokens): void {
  res.cookie(ACCESS_COOKIE_NAME, tokens.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
    path: '/',
  });
  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.max(0, tokens.refreshTokenExpiresAt.getTime() - Date.now()),
    path: REFRESH_COOKIE_PATH,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE_NAME, { path: '/' });
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

// Tahap 2 Step 2 Sprint 2a (MFA Enforcement) - "remember this device."
// Path scoped to /auth, same reasoning as REFRESH_COOKIE_PATH above: it
// needs to reach /auth/login, /auth/mfa/challenge, and
// /auth/oauth/:provider/callback (the three places a login can originate),
// but nowhere else.
export const TRUSTED_DEVICE_COOKIE_NAME = 'trusted_device';
const TRUSTED_DEVICE_COOKIE_PATH = '/auth';

export function setTrustedDeviceCookie(res: Response, rawToken: string, expiresAt: Date): void {
  res.cookie(TRUSTED_DEVICE_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    path: TRUSTED_DEVICE_COOKIE_PATH,
  });
}

export function clearTrustedDeviceCookie(res: Response): void {
  res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, { path: TRUSTED_DEVICE_COOKIE_PATH });
}
