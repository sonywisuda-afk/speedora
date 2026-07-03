import { randomBytes } from 'node:crypto';
import { resolveAccessToken } from './resolve-access-token';
import { decryptToken, encryptToken } from './token-encryption';
import type { YouTubeOAuthClient } from './youtube-oauth.client';

describe('resolveAccessToken', () => {
  const originalEnv = process.env;
  let client: { refreshAccessToken: jest.Mock };

  beforeEach(() => {
    process.env = { ...originalEnv, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
    client = { refreshAccessToken: jest.fn() };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns the current (decrypted) token without refreshing when it is not close to expiring', async () => {
    const stored = {
      accessToken: encryptToken('current-access'),
      refreshToken: encryptToken('current-refresh'),
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };

    const result = await resolveAccessToken(stored, client as unknown as YouTubeOAuthClient);

    expect(result).toEqual({ accessToken: 'current-access', refreshed: false });
    expect(client.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes and returns new encrypted tokens to persist when at/near expiry', async () => {
    const stored = {
      accessToken: encryptToken('current-access'),
      refreshToken: encryptToken('current-refresh'),
      tokenExpiresAt: new Date(Date.now() + 10_000), // within the 60s refresh buffer
    };
    const newExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    client.refreshAccessToken.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: newExpiresAt,
    });

    const result = await resolveAccessToken(stored, client as unknown as YouTubeOAuthClient);

    expect(client.refreshAccessToken).toHaveBeenCalledWith('current-refresh');
    expect(result.accessToken).toBe('new-access');
    expect(result.refreshed).toBe(true);
    expect(decryptToken(result.updated!.accessToken)).toBe('new-access');
    expect(decryptToken(result.updated!.refreshToken)).toBe('new-refresh');
    expect(result.updated!.tokenExpiresAt).toBe(newExpiresAt);
  });

  it('refreshes when the token is already expired (not just near expiry)', async () => {
    const stored = {
      accessToken: encryptToken('current-access'),
      refreshToken: encryptToken('current-refresh'),
      tokenExpiresAt: new Date(Date.now() - 1000),
    };
    client.refreshAccessToken.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const result = await resolveAccessToken(stored, client as unknown as YouTubeOAuthClient);

    expect(result.refreshed).toBe(true);
  });
});
