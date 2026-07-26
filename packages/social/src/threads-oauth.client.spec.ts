import { OAuthNotConfiguredError } from './errors';
import { ThreadsOAuthClient } from './threads-oauth.client';

describe('ThreadsOAuthClient', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let client: ThreadsOAuthClient;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      THREADS_CLIENT_ID: 'threads-client-id',
      THREADS_CLIENT_SECRET: 'threads-client-secret',
      API_BASE_URL: 'http://localhost:3001',
    };
    client = new ThreadsOAuthClient();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('when THREADS_CLIENT_ID/SECRET are not configured', () => {
    it('throws OAuthNotConfiguredError rather than the app failing to boot', () => {
      delete process.env.THREADS_CLIENT_ID;

      expect(() => client.buildAuthorizeUrl('state')).toThrow(OAuthNotConfiguredError);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('builds an authorize URL on threads.net (not facebook.com) with client id, scopes, redirect_uri, and state', () => {
      const url = new URL(client.buildAuthorizeUrl('signed-state'));

      expect(url.origin + url.pathname).toBe('https://threads.net/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('threads-client-id');
      expect(url.searchParams.get('scope')).toBe('threads_basic,threads_content_publish');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3001/social/threads/callback',
      );
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('signed-state');
    });
  });

  describe('exchangeCode', () => {
    it('exchanges the code for a short-lived token, then for a long-lived one', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'short-lived-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'long-lived-token', expires_in: 5_184_000 }),
        });
      global.fetch = fetchMock as unknown as typeof fetch;
      jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);

      const tokens = await client.exchangeCode('the-code');

      expect(String(fetchMock.mock.calls[0][0])).toBe(
        'https://graph.threads.net/oauth/access_token',
      );
      const firstBody = fetchMock.mock.calls[0][1].body as URLSearchParams;
      expect(firstBody.get('code')).toBe('the-code');
      expect(firstBody.get('grant_type')).toBe('authorization_code');
      expect(firstBody.get('redirect_uri')).toBe('http://localhost:3001/social/threads/callback');

      const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));
      expect(secondUrl.origin + secondUrl.pathname).toBe('https://graph.threads.net/access_token');
      expect(secondUrl.searchParams.get('grant_type')).toBe('th_exchange_token');
      expect(secondUrl.searchParams.get('access_token')).toBe('short-lived-token');

      expect(tokens).toEqual({
        accessToken: 'long-lived-token',
        expiresAt: new Date(1_800_000_000_000 + 5_184_000_000),
      });

      jest.restoreAllMocks();
    });

    it('throws with the Threads error message when the exchange fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Invalid authorization code' } }),
      }) as unknown as typeof fetch;

      await expect(client.exchangeCode('bad-code')).rejects.toThrow(/Invalid authorization code/);
    });
  });

  describe('fetchAccountInfo', () => {
    it('fetches the Threads user id and username', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'threads-user-1', username: 'my_threads' }),
      }) as unknown as typeof fetch;

      const account = await client.fetchAccountInfo('long-lived-token');

      expect(account).toEqual({ threadsUserId: 'threads-user-1', username: 'my_threads' });
    });

    it('throws when the profile fetch fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid OAuth access token.' } }),
      }) as unknown as typeof fetch;

      await expect(client.fetchAccountInfo('bad-token')).rejects.toThrow(
        /Invalid OAuth access token/,
      );
    });
  });

  describe('refreshAccessToken', () => {
    it('refreshes the long-lived token in place, returning it as both accessToken and refreshToken', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'fresh-long-lived-token', expires_in: 5_184_000 }),
      }) as unknown as typeof fetch;

      const result = await client.refreshAccessToken('stale-long-lived-token');

      const url = new URL(String((global.fetch as jest.Mock).mock.calls[0][0]));
      expect(url.origin + url.pathname).toBe('https://graph.threads.net/refresh_access_token');
      expect(url.searchParams.get('grant_type')).toBe('th_refresh_token');
      expect(url.searchParams.get('access_token')).toBe('stale-long-lived-token');
      expect(result.accessToken).toBe('fresh-long-lived-token');
      expect(result.refreshToken).toBe('fresh-long-lived-token');
    });

    it('throws when the refresh fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Token is not eligible for refresh' } }),
      }) as unknown as typeof fetch;

      await expect(client.refreshAccessToken('stale-token')).rejects.toThrow(
        /Token is not eligible for refresh/,
      );
    });
  });

  describe('revokeToken', () => {
    it('resolves without making a network call (no documented revoke endpoint)', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      await expect(client.revokeToken('some-token')).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
