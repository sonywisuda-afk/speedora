import { OAuthNotConfiguredError } from '@speedora/social';
import { GoogleOAuthLoginProvider } from './google-oauth-login.provider';

const mockClient = {
  generateAuthUrl: jest.fn(),
  getToken: jest.fn(),
  verifyIdToken: jest.fn(),
};

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => mockClient),
}));

describe('GoogleOAuthLoginProvider', () => {
  let provider: GoogleOAuthLoginProvider;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new GoogleOAuthLoginProvider();
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
    process.env.API_BASE_URL = 'http://localhost:3001';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('buildAuthorizeUrl', () => {
    it('delegates to OAuth2Client.generateAuthUrl with login-only scopes', () => {
      mockClient.generateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?...');

      const url = provider.buildAuthorizeUrl('random-state');

      expect(mockClient.generateAuthUrl).toHaveBeenCalledWith({
        scope: ['openid', 'email', 'profile'],
        state: 'random-state',
      });
      expect(url).toBe('https://accounts.google.com/o/oauth2/auth?...');
    });

    it('throws OAuthNotConfiguredError when Google credentials are unset', () => {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;

      expect(() => provider.buildAuthorizeUrl('state')).toThrow(OAuthNotConfiguredError);
    });
  });

  describe('exchangeCode', () => {
    it('returns the access and id tokens', async () => {
      mockClient.getToken.mockResolvedValue({
        tokens: { access_token: 'access-tok', id_token: 'id-tok' },
      });

      const result = await provider.exchangeCode('raw-code');

      expect(result).toEqual({ accessToken: 'access-tok', idToken: 'id-tok' });
    });

    it('throws when Google does not return an access_token', async () => {
      mockClient.getToken.mockResolvedValue({ tokens: {} });

      await expect(provider.exchangeCode('raw-code')).rejects.toThrow(
        'did not return an access_token',
      );
    });
  });

  describe('fetchProfile', () => {
    it('returns the profile from a verified id token', async () => {
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google-sub-123',
          email: 'a@example.com',
          email_verified: true,
          name: 'A User',
        }),
      });

      const profile = await provider.fetchProfile({ accessToken: 'tok', idToken: 'id-tok' });

      expect(profile).toEqual({
        providerAccountId: 'google-sub-123',
        email: 'a@example.com',
        name: 'A User',
      });
    });

    it('throws when no idToken is present', async () => {
      await expect(provider.fetchProfile({ accessToken: 'tok' })).rejects.toThrow(
        'did not return an id_token',
      );
    });

    it('throws when the email is not verified', async () => {
      mockClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google-sub-123',
          email: 'a@example.com',
          email_verified: false,
        }),
      });

      await expect(
        provider.fetchProfile({ accessToken: 'tok', idToken: 'id-tok' }),
      ).rejects.toThrow('email is not verified');
    });
  });
});
