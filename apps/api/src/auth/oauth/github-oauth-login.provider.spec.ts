import { OAuthNotConfiguredError } from '@speedora/social';
import { GitHubOAuthLoginProvider } from './github-oauth-login.provider';

describe('GitHubOAuthLoginProvider', () => {
  let provider: GitHubOAuthLoginProvider;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    provider = new GitHubOAuthLoginProvider();
    process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client-id';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-client-secret';
    process.env.API_BASE_URL = 'http://localhost:3001';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('buildAuthorizeUrl', () => {
    it('builds a GitHub authorize URL with the client id/redirect/scope/state', () => {
      const url = provider.buildAuthorizeUrl('random-state');

      expect(url).toContain('https://github.com/login/oauth/authorize?');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain(
        'redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fauth%2Foauth%2Fgithub%2Fcallback',
      );
      expect(url).toContain('scope=user%3Aemail');
      expect(url).toContain('state=random-state');
    });

    it('throws OAuthNotConfiguredError when GitHub credentials are unset', () => {
      delete process.env.GITHUB_OAUTH_CLIENT_ID;

      expect(() => provider.buildAuthorizeUrl('state')).toThrow(OAuthNotConfiguredError);
    });
  });

  describe('exchangeCode', () => {
    it('exchanges the code for an access token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ access_token: 'gho_test-token' }),
      });

      const result = await provider.exchangeCode('raw-code');

      expect(result).toEqual({ accessToken: 'gho_test-token' });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://github.com/login/oauth/access_token',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws when GitHub does not return an access token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ error: 'bad_verification_code' }),
      });

      await expect(provider.exchangeCode('bad-code')).rejects.toThrow(
        'GitHub token exchange failed',
      );
    });
  });

  describe('fetchProfile', () => {
    it('returns the profile directly when /user has a public email', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 42, email: 'a@example.com', name: 'A User' }),
      });

      const profile = await provider.fetchProfile({ accessToken: 'tok' });

      expect(profile).toEqual({ providerAccountId: '42', email: 'a@example.com', name: 'A User' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to /user/emails when the primary email is private', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 42, email: null, name: 'A User' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { email: 'unverified@example.com', primary: false, verified: false },
              { email: 'verified-primary@example.com', primary: true, verified: true },
            ]),
        });
      global.fetch = fetchMock;

      const profile = await provider.fetchProfile({ accessToken: 'tok' });

      expect(profile.email).toBe('verified-primary@example.com');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws when no verified email can be found at all', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 42, email: null }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        });
      global.fetch = fetchMock;

      await expect(provider.fetchProfile({ accessToken: 'tok' })).rejects.toThrow(
        'no verified email',
      );
    });
  });
});
