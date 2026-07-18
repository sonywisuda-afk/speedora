import { OAuthNotConfiguredError } from './errors';
import { PinterestOAuthClient } from './pinterest-oauth.client';

describe('PinterestOAuthClient', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let client: PinterestOAuthClient;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      PINTEREST_APP_ID: 'pin-app-id',
      PINTEREST_APP_SECRET: 'pin-app-secret',
      API_BASE_URL: 'http://localhost:3001',
    };
    client = new PinterestOAuthClient();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('when PINTEREST_APP_ID/SECRET are not configured', () => {
    it('throws OAuthNotConfiguredError rather than the app failing to boot', () => {
      delete process.env.PINTEREST_APP_ID;

      expect(() => client.buildAuthorizeUrl('state')).toThrow(OAuthNotConfiguredError);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('builds an authorize URL with the client id, scopes, redirect_uri, and state', () => {
      const url = new URL(client.buildAuthorizeUrl('signed-state'));

      expect(url.origin + url.pathname).toBe('https://www.pinterest.com/oauth/');
      expect(url.searchParams.get('client_id')).toBe('pin-app-id');
      expect(url.searchParams.get('scope')).toBe('boards:read,pins:read,pins:write,user_accounts:read');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3001/social/pinterest/callback',
      );
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('signed-state');
    });
  });

  describe('exchangeCode', () => {
    it('exchanges the code using HTTP Basic Auth', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 2_592_000,
        }),
      }) as unknown as typeof fetch;
      jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);

      const tokens = await client.exchangeCode('the-code');

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.pinterest.com/v5/oauth/token');
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from('pin-app-id:pin-app-secret').toString('base64')}`,
      );
      const body = init.body as URLSearchParams;
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('the-code');
      expect(body.get('redirect_uri')).toBe('http://localhost:3001/social/pinterest/callback');

      expect(tokens).toEqual({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: new Date(1_800_000_000_000 + 2_592_000_000),
      });

      jest.restoreAllMocks();
    });

    it('throws with the Pinterest error message when the exchange fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid authorization code' }),
      }) as unknown as typeof fetch;

      await expect(client.exchangeCode('bad-code')).rejects.toThrow(/Invalid authorization code/);
    });
  });

  describe('fetchAccountInfo', () => {
    it('fetches the username then picks the first board', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ username: 'my_pins' }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [{ id: 'board-1', name: 'My Board' }] }),
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      const account = await client.fetchAccountInfo('access-1');

      expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.pinterest.com/v5/user_account', {
        headers: { Authorization: 'Bearer access-1' },
      });
      expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.pinterest.com/v5/boards', {
        headers: { Authorization: 'Bearer access-1' },
      });
      expect(account).toEqual({ boardId: 'board-1', displayName: 'my_pins — My Board' });
    });

    it('throws when the user has no boards', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ username: 'my_pins' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) }) as unknown as typeof fetch;

      await expect(client.fetchAccountInfo('access-1')).rejects.toThrow(/No Pinterest board found/);
    });
  });

  describe('refreshAccessToken', () => {
    it('keeps the existing refresh token when the response omits a new one', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'fresh-access', expires_in: 2_592_000 }),
      }) as unknown as typeof fetch;

      const result = await client.refreshAccessToken('stale-refresh');

      const body = (global.fetch as jest.Mock).mock.calls[0][1].body as URLSearchParams;
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('stale-refresh');
      expect(result).toEqual({
        accessToken: 'fresh-access',
        refreshToken: 'stale-refresh',
        expiresAt: expect.any(Date),
      });
    });

    it('uses the new refresh token when one is returned', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'fresh-access',
          refresh_token: 'fresh-refresh',
          expires_in: 2_592_000,
        }),
      }) as unknown as typeof fetch;

      const result = await client.refreshAccessToken('stale-refresh');

      expect(result.refreshToken).toBe('fresh-refresh');
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
