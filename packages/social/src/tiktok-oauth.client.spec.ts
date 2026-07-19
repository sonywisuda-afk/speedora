import { OAuthNotConfiguredError } from './errors';
import { TikTokOAuthClient } from './tiktok-oauth.client';

describe('TikTokOAuthClient', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let client: TikTokOAuthClient;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TIKTOK_CLIENT_KEY: 'client-key',
      TIKTOK_CLIENT_SECRET: 'client-secret',
      API_BASE_URL: 'http://localhost:3001',
    };
    client = new TikTokOAuthClient();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('when TIKTOK_CLIENT_KEY/SECRET are not configured', () => {
    it('throws OAuthNotConfiguredError rather than the app failing to boot', () => {
      delete process.env.TIKTOK_CLIENT_KEY;

      expect(() => client.buildAuthorizeUrl('state')).toThrow(OAuthNotConfiguredError);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('builds an authorize URL with the client key, scopes, redirect_uri, and state', () => {
      const url = new URL(client.buildAuthorizeUrl('signed-state'));

      expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
      expect(url.searchParams.get('client_key')).toBe('client-key');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe(
        'user.info.basic,video.upload,video.list,user.info.stats',
      );
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3001/social/tiktok/callback',
      );
      expect(url.searchParams.get('state')).toBe('signed-state');
    });
  });

  describe('exchangeCode', () => {
    it('exchanges a code for tokens', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        }),
      }) as unknown as typeof fetch;
      jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);

      const tokens = await client.exchangeCode('the-code');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://open.tiktokapis.com/v2/oauth/token/',
        expect.objectContaining({ method: 'POST' }),
      );
      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      const body = init.body as URLSearchParams;
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('the-code');
      expect(body.get('redirect_uri')).toBe('http://localhost:3001/social/tiktok/callback');
      expect(tokens).toEqual({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: new Date(1_800_000_000_000 + 3_600_000),
      });

      jest.restoreAllMocks();
    });

    it('throws when TikTok does not return both an access_token and a refresh_token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'access-1' }),
      }) as unknown as typeof fetch;

      await expect(client.exchangeCode('the-code')).rejects.toThrow(/oauth\/token failed/);
    });

    it('throws with the error details when TikTok rejects the exchange', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_description: 'code expired' }),
      }) as unknown as typeof fetch;

      await expect(client.exchangeCode('stale-code')).rejects.toThrow(/invalid_grant/);
    });
  });

  describe('refreshAccessToken', () => {
    it('refreshes and always uses the newly-returned refresh token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_in: 3600,
        }),
      }) as unknown as typeof fetch;

      const tokens = await client.refreshAccessToken('refresh-1');

      const [, init] = (global.fetch as jest.Mock).mock.calls[0];
      const body = init.body as URLSearchParams;
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('refresh-1');
      expect(tokens.accessToken).toBe('access-2');
      expect(tokens.refreshToken).toBe('refresh-2');
    });
  });

  describe('revokeToken', () => {
    it('posts the token to the revoke endpoint', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;

      await client.revokeToken('some-token');

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://open.tiktokapis.com/v2/oauth/revoke/');
      const body = init.body as URLSearchParams;
      expect(body.get('token')).toBe('some-token');
    });

    it('throws when the revoke call fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid token',
      }) as unknown as typeof fetch;

      await expect(client.revokeToken('bad-token')).rejects.toThrow(/oauth\/revoke failed/);
    });
  });

  describe('fetchUserInfo', () => {
    it('fetches open_id/display_name with a bearer token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { user: { open_id: 'user-1', display_name: 'My TikTok' } } }),
      }) as unknown as typeof fetch;

      const user = await client.fetchUserInfo('access-token');

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain('https://open.tiktokapis.com/v2/user/info/');
      expect(init).toEqual({ headers: { Authorization: 'Bearer access-token' } });
      expect(user).toEqual({ openId: 'user-1', displayName: 'My TikTok' });
    });

    it('throws when the response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid token',
      }) as unknown as typeof fetch;

      await expect(client.fetchUserInfo('bad-token')).rejects.toThrow(/user\/info failed/);
    });

    it('throws when TikTok omits the open_id', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { user: {} } }),
      }) as unknown as typeof fetch;

      await expect(client.fetchUserInfo('access-token')).rejects.toThrow(
        /did not return a user open_id/,
      );
    });
  });
});
