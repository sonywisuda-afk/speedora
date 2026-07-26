import { OAuthNotConfiguredError } from './errors';
import { XOAuthClient } from './x-oauth.client';

describe('XOAuthClient', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let client: XOAuthClient;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      X_CLIENT_ID: 'x-client-id',
      X_CLIENT_SECRET: 'x-client-secret',
      JWT_SECRET: 'test-jwt-secret',
      API_BASE_URL: 'http://localhost:3001',
    };
    client = new XOAuthClient();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('when X_CLIENT_ID/SECRET are not configured', () => {
    it('throws OAuthNotConfiguredError rather than the app failing to boot', () => {
      delete process.env.X_CLIENT_ID;

      expect(() => client.buildAuthorizeUrl('state')).toThrow(OAuthNotConfiguredError);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('builds a PKCE authorize URL with the client id, scopes, redirect_uri, state, and code_challenge', () => {
      const url = new URL(client.buildAuthorizeUrl('signed-state'));

      expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize');
      expect(url.searchParams.get('client_id')).toBe('x-client-id');
      expect(url.searchParams.get('scope')).toBe(
        'tweet.read tweet.write users.read offline.access',
      );
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3001/social/x/callback');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('signed-state');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    });

    it('derives the same code_challenge for the same state (deterministic, no session storage)', () => {
      const url1 = new URL(client.buildAuthorizeUrl('same-state'));
      const url2 = new URL(client.buildAuthorizeUrl('same-state'));

      expect(url1.searchParams.get('code_challenge')).toBe(url2.searchParams.get('code_challenge'));
    });

    it('derives a different code_challenge for a different state', () => {
      const url1 = new URL(client.buildAuthorizeUrl('state-a'));
      const url2 = new URL(client.buildAuthorizeUrl('state-b'));

      expect(url1.searchParams.get('code_challenge')).not.toBe(
        url2.searchParams.get('code_challenge'),
      );
    });
  });

  describe('exchangeCode', () => {
    it('exchanges the code with a code_verifier re-derived from the same state', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 7200,
        }),
      }) as unknown as typeof fetch;
      jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);

      const tokens = await client.exchangeCode('the-code', 'signed-state');

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.x.com/2/oauth2/token');
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from('x-client-id:x-client-secret').toString('base64')}`,
      );
      const body = init.body as URLSearchParams;
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('the-code');
      expect(body.get('redirect_uri')).toBe('http://localhost:3001/social/x/callback');
      expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9\-_]{43}$/);

      expect(tokens).toEqual({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: new Date(1_800_000_000_000 + 7_200_000),
      });

      jest.restoreAllMocks();
    });

    it('throws with the X error message when the exchange fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_description: 'code expired' }),
      }) as unknown as typeof fetch;

      await expect(client.exchangeCode('bad-code', 'signed-state')).rejects.toThrow(/code expired/);
    });
  });

  describe('fetchAccountInfo', () => {
    it('fetches the X user id and username', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: 'x-user-1', username: 'my_x' } }),
      }) as unknown as typeof fetch;

      const account = await client.fetchAccountInfo('access-1');

      expect(global.fetch).toHaveBeenCalledWith('https://api.x.com/2/users/me', {
        headers: { Authorization: 'Bearer access-1' },
      });
      expect(account).toEqual({ userId: 'x-user-1', username: 'my_x' });
    });

    it('throws when the request fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ errors: [{ title: 'Unauthorized', detail: 'Invalid token' }] }),
      }) as unknown as typeof fetch;

      await expect(client.fetchAccountInfo('bad-token')).rejects.toThrow(/Invalid token/);
    });
  });

  describe('refreshAccessToken', () => {
    it('requests a fresh token pair via the refresh_token grant', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'fresh-access',
          refresh_token: 'fresh-refresh',
          expires_in: 7200,
        }),
      }) as unknown as typeof fetch;

      const result = await client.refreshAccessToken('stale-refresh');

      const body = (global.fetch as jest.Mock).mock.calls[0][1].body as URLSearchParams;
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('stale-refresh');
      expect(result).toEqual({
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh',
        expiresAt: expect.any(Date),
      });
    });

    it('keeps the old refresh token when the response omits a new one', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'fresh-access', expires_in: 7200 }),
      }) as unknown as typeof fetch;

      const result = await client.refreshAccessToken('stale-refresh');

      expect(result.refreshToken).toBe('stale-refresh');
    });
  });

  describe('revokeToken', () => {
    it('resolves without making a network call (undocumented for this client type)', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(client.revokeToken('some-token')).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
