import { OAuthNotConfiguredError } from '@speedora/social';
import type { Request, Response } from 'express';
import type { AuthService } from '../auth.service';
import { OAuthController } from './oauth.controller';

function fakeResponse(): Response {
  return {
    cookie: jest.fn().mockReturnThis(),
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  } as unknown as Response;
}

function fakeRequest(query: Record<string, string> = {}) {
  return {
    headers: { 'user-agent': 'Mozilla/5.0 (Test)' },
    ip: '127.0.0.1',
    query,
  } as unknown as Request;
}

const fakeUser = {
  id: 'user-1',
  email: 'a@example.com',
  role: 'CREATOR' as const,
  emailVerified: true,
};

const fakeTokens = {
  accessToken: 'access-tok',
  refreshToken: 'refresh-tok',
  refreshTokenExpiresAt: new Date(Date.now() + 60_000),
};

describe('OAuthController', () => {
  let controller: OAuthController;
  let authService: {
    resolveOAuthLogin: jest.Mock;
    createSession: jest.Mock;
    recordSecurityEvent: jest.Mock;
    isMfaEnabled: jest.Mock;
    computeLoginRisk: jest.Mock;
    checkTrustedDevice: jest.Mock;
    issueMfaChallengeToken: jest.Mock;
    listLinkedProviders: jest.Mock;
    unlinkOAuthProvider: jest.Mock;
  };
  let jwt: { sign: jest.Mock; verify: jest.Mock };
  let google: { buildAuthorizeUrl: jest.Mock; exchangeCode: jest.Mock; fetchProfile: jest.Mock };
  let github: { buildAuthorizeUrl: jest.Mock; exchangeCode: jest.Mock; fetchProfile: jest.Mock };

  beforeEach(() => {
    authService = {
      resolveOAuthLogin: jest.fn().mockResolvedValue(fakeUser),
      createSession: jest.fn().mockResolvedValue(fakeTokens),
      recordSecurityEvent: jest.fn().mockResolvedValue(undefined),
      isMfaEnabled: jest.fn().mockResolvedValue(false),
      computeLoginRisk: jest.fn().mockResolvedValue({ score: 0, signals: [] }),
      checkTrustedDevice: jest.fn().mockResolvedValue(false),
      issueMfaChallengeToken: jest.fn().mockReturnValue('mfa-challenge-token'),
      listLinkedProviders: jest.fn(),
      unlinkOAuthProvider: jest.fn().mockResolvedValue(undefined),
    };
    jwt = { sign: jest.fn().mockReturnValue('signed-state'), verify: jest.fn() };
    google = {
      buildAuthorizeUrl: jest.fn().mockReturnValue('https://accounts.google.com/authorize?...'),
      exchangeCode: jest.fn().mockResolvedValue({ accessToken: 'g-tok', idToken: 'g-id' }),
      fetchProfile: jest
        .fn()
        .mockResolvedValue({ providerAccountId: 'google-sub', email: 'a@example.com' }),
    };
    github = {
      buildAuthorizeUrl: jest.fn().mockReturnValue('https://github.com/login/oauth/authorize?...'),
      exchangeCode: jest.fn().mockResolvedValue({ accessToken: 'gh-tok' }),
      fetchProfile: jest
        .fn()
        .mockResolvedValue({ providerAccountId: 'gh-id', email: 'a@example.com' }),
    };
    controller = new OAuthController(
      authService as unknown as AuthService,
      jwt as never,
      google as never,
      github as never,
    );
  });

  describe('start', () => {
    it('signs a nonce-only state and redirects to the provider authorize URL', () => {
      const res = fakeResponse();

      controller.start('google', res);

      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ nonce: expect.any(String) }),
        { expiresIn: '10m' },
      );
      expect(google.buildAuthorizeUrl).toHaveBeenCalledWith('signed-state');
      expect(res.redirect).toHaveBeenCalledWith('https://accounts.google.com/authorize?...');
    });

    it('is case-insensitive on the provider param', () => {
      const res = fakeResponse();

      controller.start('GitHub', res);

      expect(github.buildAuthorizeUrl).toHaveBeenCalled();
    });

    it('responds 404 for an unknown provider', () => {
      const res = fakeResponse();

      controller.start('facebook', res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(google.buildAuthorizeUrl).not.toHaveBeenCalled();
    });

    it('responds 503 when the provider is not configured', () => {
      google.buildAuthorizeUrl.mockImplementation(() => {
        throw new OAuthNotConfiguredError('Google sign-in is not configured');
      });
      const res = fakeResponse();

      controller.start('google', res);

      expect(res.status).toHaveBeenCalledWith(503);
    });
  });

  describe('callback', () => {
    it('resolves the login, sets cookies, logs LOGIN_SUCCESS, and redirects to /upload', async () => {
      jwt.verify.mockReturnValue({ nonce: 'abc' });
      const req = fakeRequest();
      const res = fakeResponse();

      await controller.callback('google', 'raw-code', 'valid-state', undefined, req, res);

      expect(jwt.verify).toHaveBeenCalledWith('valid-state');
      expect(google.exchangeCode).toHaveBeenCalledWith('raw-code');
      expect(authService.resolveOAuthLogin).toHaveBeenCalledWith(
        'GOOGLE',
        'google-sub',
        'a@example.com',
      );
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', eventType: 'LOGIN_SUCCESS' }),
      );
      expect(res.cookie).toHaveBeenCalledWith('token', fakeTokens.accessToken, expect.any(Object));
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/upload');
    });

    it('redirects to /mfa-challenge instead of creating a session when MFA is required', async () => {
      jwt.verify.mockReturnValue({ nonce: 'abc' });
      authService.isMfaEnabled.mockResolvedValue(true);
      authService.checkTrustedDevice.mockResolvedValue(false);
      const req = fakeRequest();
      const res = fakeResponse();

      await controller.callback('google', 'raw-code', 'valid-state', undefined, req, res);

      expect(authService.createSession).not.toHaveBeenCalled();
      expect(authService.recordSecurityEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'LOGIN_SUCCESS' }),
      );
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/mfa-challenge?token=mfa-challenge-token',
      );
    });

    it('skips the MFA challenge when a valid trusted-device cookie is present under low risk', async () => {
      jwt.verify.mockReturnValue({ nonce: 'abc' });
      authService.isMfaEnabled.mockResolvedValue(true);
      authService.computeLoginRisk.mockResolvedValue({ score: 0, signals: [] });
      authService.checkTrustedDevice.mockResolvedValue(true);
      const req = fakeRequest();
      const res = fakeResponse();

      await controller.callback('google', 'raw-code', 'valid-state', undefined, req, res);

      expect(authService.createSession).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/upload');
    });

    it('redirects with ?error=unknown_provider for an unrecognized provider', async () => {
      const req = fakeRequest();
      const res = fakeResponse();

      await controller.callback('facebook', 'code', 'state', undefined, req, res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/upload?error=unknown_provider',
      );
    });

    it('redirects with the provider error when the provider reports one', async () => {
      const req = fakeRequest();
      const res = fakeResponse();

      await controller.callback('google', undefined, undefined, 'access_denied', req, res);

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/upload?error=access_denied');
      expect(google.exchangeCode).not.toHaveBeenCalled();
    });

    it('redirects with ?error=invalid_state when state verification fails', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const req = fakeRequest();
      const res = fakeResponse();

      await controller.callback('google', 'code', 'bad-state', undefined, req, res);

      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/upload?error=invalid_state');
      expect(google.exchangeCode).not.toHaveBeenCalled();
    });

    it('redirects with ?error=oauth_failed and never throws when the exchange fails', async () => {
      jwt.verify.mockReturnValue({ nonce: 'abc' });
      google.exchangeCode.mockRejectedValue(new Error('network error'));
      const req = fakeRequest();
      const res = fakeResponse();

      await expect(
        controller.callback('google', 'code', 'valid-state', undefined, req, res),
      ).resolves.toBeUndefined();
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/upload?error=oauth_failed');
    });
  });

  describe('listLinked', () => {
    it('returns the linked-provider list for the current user', async () => {
      const linked = [{ provider: 'GOOGLE', email: 'a@example.com', createdAt: new Date() }];
      authService.listLinkedProviders.mockResolvedValue(linked);

      const result = await controller.listLinked(fakeUser);

      expect(authService.listLinkedProviders).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(linked);
    });
  });

  describe('unlinkProvider', () => {
    it('unlinks the provider and records OAUTH_UNLINKED', async () => {
      const req = fakeRequest();

      await controller.unlinkProvider(fakeUser, 'google', req);

      expect(authService.unlinkOAuthProvider).toHaveBeenCalledWith('user-1', 'GOOGLE');
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          eventType: 'OAUTH_UNLINKED',
          metadata: { provider: 'GOOGLE' },
        }),
      );
    });

    it('is case-insensitive on the provider param, same as start/callback', async () => {
      const req = fakeRequest();

      await controller.unlinkProvider(fakeUser, 'GitHub', req);

      expect(authService.unlinkOAuthProvider).toHaveBeenCalledWith('user-1', 'GITHUB');
    });

    it('throws NotFoundException for an unrecognized provider without calling the service', async () => {
      const req = fakeRequest();

      await expect(controller.unlinkProvider(fakeUser, 'facebook', req)).rejects.toThrow(
        'Unknown provider',
      );
      expect(authService.unlinkOAuthProvider).not.toHaveBeenCalled();
      expect(authService.recordSecurityEvent).not.toHaveBeenCalled();
    });

    it('propagates AuthService errors (e.g. last-sign-in-method validation) without recording an event', async () => {
      authService.unlinkOAuthProvider.mockRejectedValue(new Error('blocked'));
      const req = fakeRequest();

      await expect(controller.unlinkProvider(fakeUser, 'google', req)).rejects.toThrow('blocked');
      expect(authService.recordSecurityEvent).not.toHaveBeenCalled();
    });
  });
});
