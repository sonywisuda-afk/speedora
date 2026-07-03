const generateAuthUrlMock = jest.fn();
const getTokenMock = jest.fn();
const setCredentialsMock = jest.fn();
const refreshAccessTokenMock = jest.fn();
const revokeTokenMock = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    generateAuthUrl: generateAuthUrlMock,
    getToken: getTokenMock,
    setCredentials: setCredentialsMock,
    refreshAccessToken: refreshAccessTokenMock,
    revokeToken: revokeTokenMock,
  })),
}));

import { OAuthNotConfiguredError } from './errors';
import { YouTubeOAuthClient } from './youtube-oauth.client';

describe('YouTubeOAuthClient', () => {
  const originalEnv = process.env;
  let client: YouTubeOAuthClient;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      GOOGLE_OAUTH_CLIENT_ID: 'client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
      API_BASE_URL: 'http://localhost:3001',
    };
    client = new YouTubeOAuthClient();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('when GOOGLE_OAUTH_CLIENT_ID/SECRET are not configured', () => {
    it('throws OAuthNotConfiguredError rather than the app failing to boot', () => {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;

      expect(() => client.buildAuthorizeUrl('state')).toThrow(OAuthNotConfiguredError);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('requests offline access, forced consent, and the youtube upload+readonly scopes', () => {
      generateAuthUrlMock.mockReturnValue('https://accounts.google.com/authorize?...');

      const url = client.buildAuthorizeUrl('signed-state');

      expect(generateAuthUrlMock).toHaveBeenCalledWith({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/youtube.upload',
          'https://www.googleapis.com/auth/youtube.readonly',
        ],
        prompt: 'consent',
        state: 'signed-state',
      });
      expect(url).toBe('https://accounts.google.com/authorize?...');
    });
  });

  describe('exchangeCode', () => {
    it('exchanges a code for tokens', async () => {
      getTokenMock.mockResolvedValue({
        tokens: {
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expiry_date: 1_800_000_000_000,
        },
      });

      const tokens = await client.exchangeCode('the-code');

      expect(getTokenMock).toHaveBeenCalledWith('the-code');
      expect(tokens).toEqual({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: new Date(1_800_000_000_000),
      });
    });

    it('throws when Google omits the refresh_token (e.g. a repeat consent without prompt=consent)', async () => {
      getTokenMock.mockResolvedValue({ tokens: { access_token: 'access-1' } });

      await expect(client.exchangeCode('the-code')).rejects.toThrow(
        /did not return both an access_token and a refresh_token/,
      );
    });
  });

  describe('refreshAccessToken', () => {
    it('refreshes using the given refresh token and keeps it when Google does not re-return one', async () => {
      refreshAccessTokenMock.mockResolvedValue({
        credentials: { access_token: 'access-2', expiry_date: 1_900_000_000_000 },
      });

      const tokens = await client.refreshAccessToken('refresh-1');

      expect(setCredentialsMock).toHaveBeenCalledWith({ refresh_token: 'refresh-1' });
      expect(tokens).toEqual({
        accessToken: 'access-2',
        refreshToken: 'refresh-1',
        expiresAt: new Date(1_900_000_000_000),
      });
    });

    it('uses the newly-returned refresh token when Google does provide one', async () => {
      refreshAccessTokenMock.mockResolvedValue({
        credentials: {
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expiry_date: 1_900_000_000_000,
        },
      });

      const tokens = await client.refreshAccessToken('refresh-1');

      expect(tokens.refreshToken).toBe('refresh-2');
    });
  });

  describe('revokeToken', () => {
    it('delegates to the OAuth2Client', async () => {
      await client.revokeToken('some-token');

      expect(revokeTokenMock).toHaveBeenCalledWith('some-token');
    });
  });

  describe('fetchChannelInfo', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('fetches the caller-owned channel with a bearer token', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{ id: 'channel-1', snippet: { title: 'My Channel' } }],
        }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const channel = await client.fetchChannelInfo('access-token');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        { headers: { Authorization: 'Bearer access-token' } },
      );
      expect(channel).toEqual({ channelId: 'channel-1', title: 'My Channel' });
    });

    it('throws when the response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid token',
      }) as unknown as typeof fetch;

      await expect(client.fetchChannelInfo('bad-token')).rejects.toThrow(/channels.list failed/);
    });

    it('throws when the account has no channel', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] }),
      }) as unknown as typeof fetch;

      await expect(client.fetchChannelInfo('access-token')).rejects.toThrow(
        /No YouTube channel found/,
      );
    });
  });
});
