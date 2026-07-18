import { OAuthNotConfiguredError } from './errors';
import { LinkedInOAuthClient } from './linkedin-oauth.client';

describe('LinkedInOAuthClient', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let client: LinkedInOAuthClient;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      LINKEDIN_CLIENT_ID: 'linkedin-client-id',
      LINKEDIN_CLIENT_SECRET: 'linkedin-client-secret',
      API_BASE_URL: 'http://localhost:3001',
    };
    client = new LinkedInOAuthClient();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('when LINKEDIN_CLIENT_ID/SECRET are not configured', () => {
    it('throws OAuthNotConfiguredError rather than the app failing to boot', () => {
      delete process.env.LINKEDIN_CLIENT_ID;

      expect(() => client.buildAuthorizeUrl('state')).toThrow(OAuthNotConfiguredError);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('builds an authorize URL with the client id, scopes, redirect_uri, and state', () => {
      const url = new URL(client.buildAuthorizeUrl('signed-state'));

      expect(url.origin + url.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
      expect(url.searchParams.get('client_id')).toBe('linkedin-client-id');
      expect(url.searchParams.get('scope')).toBe('openid profile w_member_social');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3001/social/linkedin/callback',
      );
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('signed-state');
    });
  });

  describe('exchangeCode', () => {
    it('exchanges the code for an access token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'access-1', expires_in: 5_184_000 }),
      }) as unknown as typeof fetch;
      jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);

      const tokens = await client.exchangeCode('the-code');

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://www.linkedin.com/oauth/v2/accessToken');
      const body = init.body as URLSearchParams;
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('the-code');
      expect(body.get('redirect_uri')).toBe('http://localhost:3001/social/linkedin/callback');

      expect(tokens).toEqual({
        accessToken: 'access-1',
        refreshToken: null,
        expiresAt: new Date(1_800_000_000_000 + 5_184_000_000),
      });

      jest.restoreAllMocks();
    });

    it('defaults refreshToken to null when LinkedIn does not issue one', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'access-1', expires_in: 5_184_000 }),
      }) as unknown as typeof fetch;

      const tokens = await client.exchangeCode('the-code');

      expect(tokens.refreshToken).toBeNull();
    });

    it('throws with the LinkedIn error message when the exchange fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_request', error_description: 'code expired' }),
      }) as unknown as typeof fetch;

      await expect(client.exchangeCode('bad-code')).rejects.toThrow(/code expired/);
    });
  });

  describe('fetchAccountInfo', () => {
    it('fetches the userinfo endpoint and constructs a urn:li:person URN from sub', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sub: 'abc123', name: 'Jane Doe' }),
      }) as unknown as typeof fetch;

      const member = await client.fetchAccountInfo('access-1');

      expect(global.fetch).toHaveBeenCalledWith('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: 'Bearer access-1' },
      });
      expect(member).toEqual({ personUrn: 'urn:li:person:abc123', name: 'Jane Doe' });
    });

    it('throws when the userinfo request fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Invalid access token' }),
      }) as unknown as typeof fetch;

      await expect(client.fetchAccountInfo('bad-token')).rejects.toThrow(/Invalid access token/);
    });
  });

  describe('refreshAccessToken', () => {
    it('requests a fresh access token via the refresh_token grant', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'fresh-access',
          refresh_token: 'fresh-refresh',
          expires_in: 5_184_000,
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

    it('throws when the refresh fails (e.g. app not enrolled in Programmatic Refresh Tokens)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_description: 'refresh_token invalid' }),
      }) as unknown as typeof fetch;

      await expect(client.refreshAccessToken('stale-refresh')).rejects.toThrow(
        /refresh_token invalid/,
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
