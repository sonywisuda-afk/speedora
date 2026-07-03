import { OAuthNotConfiguredError } from './errors';
import { InstagramOAuthClient } from './instagram-oauth.client';

describe('InstagramOAuthClient', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let client: InstagramOAuthClient;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      FACEBOOK_APP_ID: 'app-id',
      FACEBOOK_APP_SECRET: 'app-secret',
      API_BASE_URL: 'http://localhost:3001',
    };
    client = new InstagramOAuthClient();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('when FACEBOOK_APP_ID/SECRET are not configured', () => {
    it('throws OAuthNotConfiguredError rather than the app failing to boot', () => {
      delete process.env.FACEBOOK_APP_ID;

      expect(() => client.buildAuthorizeUrl('state')).toThrow(OAuthNotConfiguredError);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('builds an authorize URL with the app id, scopes, redirect_uri, and state', () => {
      const url = new URL(client.buildAuthorizeUrl('signed-state'));

      expect(url.origin + url.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');
      expect(url.searchParams.get('client_id')).toBe('app-id');
      expect(url.searchParams.get('scope')).toBe(
        'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement',
      );
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3001/social/instagram/callback',
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

      const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
      expect(firstUrl.searchParams.get('code')).toBe('the-code');
      expect(firstUrl.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3001/social/instagram/callback',
      );

      const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));
      expect(secondUrl.searchParams.get('grant_type')).toBe('fb_exchange_token');
      expect(secondUrl.searchParams.get('fb_exchange_token')).toBe('short-lived-token');

      expect(tokens).toEqual({
        accessToken: 'long-lived-token',
        expiresAt: new Date(1_800_000_000_000 + 5_184_000_000),
      });

      jest.restoreAllMocks();
    });

    it('throws with the Graph API error message when the exchange fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Invalid verification code format.' } }),
      }) as unknown as typeof fetch;

      await expect(client.exchangeCode('bad-code')).rejects.toThrow(
        /Invalid verification code format/,
      );
    });
  });

  describe('fetchAccountInfo', () => {
    it('picks the first Page with a linked Instagram Business account', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { access_token: 'page-token-no-ig' },
            {
              access_token: 'page-token-with-ig',
              instagram_business_account: { id: 'ig-user-1', username: 'my_reels' },
            },
          ],
        }),
      }) as unknown as typeof fetch;

      const account = await client.fetchAccountInfo('long-lived-user-token');

      expect(account).toEqual({
        igUserId: 'ig-user-1',
        username: 'my_reels',
        pageAccessToken: 'page-token-with-ig',
      });
    });

    it('throws when no Page has a linked Instagram Business account', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ access_token: 'page-token-no-ig' }] }),
      }) as unknown as typeof fetch;

      await expect(client.fetchAccountInfo('long-lived-user-token')).rejects.toThrow(
        /No Instagram Business\/Creator account found/,
      );
    });
  });

  describe('refreshAccessToken', () => {
    it('re-exchanges the stored long-lived user token and re-derives a fresh Page token', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'fresh-long-lived-user-token',
            expires_in: 5_184_000,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                access_token: 'fresh-page-token',
                instagram_business_account: { id: 'ig-user-1', username: 'my_reels' },
              },
            ],
          }),
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.refreshAccessToken('stale-long-lived-user-token');

      const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
      expect(firstUrl.searchParams.get('fb_exchange_token')).toBe('stale-long-lived-user-token');
      expect(result.accessToken).toBe('fresh-page-token');
      expect(result.refreshToken).toBe('fresh-long-lived-user-token');
    });
  });

  describe('revokeToken', () => {
    it('sends a DELETE to /me/permissions with the token', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      global.fetch = fetchMock as unknown as typeof fetch;

      await client.revokeToken('some-token');

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('/me/permissions');
      expect(new URL(String(url)).searchParams.get('access_token')).toBe('some-token');
      expect(init).toEqual({ method: 'DELETE' });
    });

    it('throws when the revoke call fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid OAuth access token.' } }),
      }) as unknown as typeof fetch;

      await expect(client.revokeToken('bad-token')).rejects.toThrow(/Invalid OAuth access token/);
    });
  });
});
