import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import type { CaptchaProvider } from './captcha/captcha-provider.interface';
import type { LoginBackoffService } from './login-backoff.service';

function fakeResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;
}

function fakeRequest(cookies: Record<string, string> = {}) {
  return {
    headers: { 'user-agent': 'Mozilla/5.0 (Test)' },
    ip: '127.0.0.1',
    cookies,
  } as unknown as Request;
}

const fakeTokens = {
  accessToken: 'access-signed-token',
  refreshToken: 'raw-refresh-token',
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
};

const noRisk = { score: 0, signals: [] };

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    register: jest.Mock;
    validateUser: jest.Mock;
    createSession: jest.Mock;
    rotateRefreshToken: jest.Mock;
    revokeSession: jest.Mock;
    revokeAllSessions: jest.Mock;
    listSessions: jest.Mock;
    revokeSessionById: jest.Mock;
    revokeOtherSessions: jest.Mock;
    requestPasswordReset: jest.Mock;
    resetPassword: jest.Mock;
    sendVerificationEmail: jest.Mock;
    verifyEmail: jest.Mock;
    resendVerification: jest.Mock;
    changePassword: jest.Mock;
    deleteAccount: jest.Mock;
    computeLoginRisk: jest.Mock;
    recordSecurityEvent: jest.Mock;
    isMfaEnabled: jest.Mock;
    checkTrustedDevice: jest.Mock;
    issueMfaChallengeToken: jest.Mock;
    verifyElevationCredential: jest.Mock;
    elevateSession: jest.Mock;
  };
  let loginBackoff: {
    checkAllowed: jest.Mock;
    recordFailure: jest.Mock;
    reset: jest.Mock;
  };
  let captchaProvider: { verify: jest.Mock };

  beforeEach(() => {
    authService = {
      register: jest.fn(),
      validateUser: jest.fn(),
      createSession: jest.fn().mockResolvedValue(fakeTokens),
      rotateRefreshToken: jest.fn().mockResolvedValue(fakeTokens),
      revokeSession: jest.fn().mockResolvedValue(undefined),
      revokeAllSessions: jest.fn().mockResolvedValue(undefined),
      listSessions: jest.fn(),
      revokeSessionById: jest.fn().mockResolvedValue(undefined),
      revokeOtherSessions: jest.fn().mockResolvedValue(undefined),
      requestPasswordReset: jest.fn(),
      resetPassword: jest.fn(),
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      verifyEmail: jest.fn(),
      resendVerification: jest.fn().mockResolvedValue(undefined),
      changePassword: jest.fn(),
      deleteAccount: jest.fn().mockResolvedValue(undefined),
      computeLoginRisk: jest.fn().mockResolvedValue(noRisk),
      recordSecurityEvent: jest.fn().mockResolvedValue(undefined),
      isMfaEnabled: jest.fn().mockResolvedValue(false),
      checkTrustedDevice: jest.fn().mockResolvedValue(false),
      issueMfaChallengeToken: jest.fn().mockReturnValue('mfa-challenge-token'),
      verifyElevationCredential: jest.fn().mockResolvedValue(true),
      elevateSession: jest.fn().mockResolvedValue(new Date(Date.now() + 15 * 60 * 1000)),
    };
    loginBackoff = {
      checkAllowed: jest.fn().mockResolvedValue({ allowed: true, retryAfterMs: 0 }),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    };
    captchaProvider = { verify: jest.fn().mockResolvedValue(true) };
    controller = new AuthController(
      authService as unknown as AuthService,
      loginBackoff as unknown as LoginBackoffService,
      captchaProvider as unknown as CaptchaProvider,
    );
  });

  describe('register', () => {
    it('registers the user, creates a session, and sets both auth cookies', async () => {
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR' as const,
        emailVerified: false,
      };
      authService.register.mockResolvedValue(user);
      const req = fakeRequest();
      const res = fakeResponse();

      const result = await controller.register({ email: user.email, password: 'pw' }, req, res);

      expect(authService.register).toHaveBeenCalledWith('a@example.com', 'pw');
      expect(authService.createSession).toHaveBeenCalledWith(
        user,
        'Mozilla/5.0 (Test)',
        '127.0.0.1',
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'token',
        fakeTokens.accessToken,
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        fakeTokens.refreshToken,
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/auth' }),
      );
      expect(authService.sendVerificationEmail).toHaveBeenCalledWith('user-1', expect.any(String));
      expect(result).toEqual(user);
    });
  });

  describe('login', () => {
    const user = {
      id: 'user-1',
      email: 'a@example.com',
      role: 'CREATOR' as const,
      emailVerified: false,
    };

    it('validates credentials, creates a session, sets cookies, and logs LOGIN_SUCCESS', async () => {
      authService.validateUser.mockResolvedValue(user);
      const req = fakeRequest();
      const res = fakeResponse();

      const result = await controller.login({ email: user.email, password: 'pw' }, req, res);

      expect(loginBackoff.checkAllowed).toHaveBeenCalledWith('a@example.com');
      expect(authService.validateUser).toHaveBeenCalledWith('a@example.com', 'pw');
      expect(loginBackoff.reset).toHaveBeenCalledWith('a@example.com');
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', eventType: 'LOGIN_SUCCESS' }),
      );
      expect(authService.createSession).toHaveBeenCalledWith(
        user,
        'Mozilla/5.0 (Test)',
        '127.0.0.1',
      );
      expect(res.cookie).toHaveBeenCalledWith('token', fakeTokens.accessToken, expect.any(Object));
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        fakeTokens.refreshToken,
        expect.any(Object),
      );
      expect(result).toEqual(user);
    });

    it('throws 429 and never checks credentials when backoff blocks the email', async () => {
      loginBackoff.checkAllowed.mockResolvedValue({ allowed: false, retryAfterMs: 5000 });
      const req = fakeRequest();
      const res = fakeResponse();

      await expect(
        controller.login({ email: user.email, password: 'pw' }, req, res),
      ).rejects.toThrow(HttpException);
      expect(authService.validateUser).not.toHaveBeenCalled();
      expect(authService.computeLoginRisk).not.toHaveBeenCalled();
    });

    it('records LOGIN_FAILED and a backoff failure when credentials are wrong', async () => {
      authService.validateUser.mockRejectedValue(new UnauthorizedException('bad creds'));
      const req = fakeRequest();
      const res = fakeResponse();

      await expect(
        controller.login({ email: user.email, password: 'wrong' }, req, res),
      ).rejects.toThrow(UnauthorizedException);

      expect(loginBackoff.recordFailure).toHaveBeenCalledWith('a@example.com');
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'a@example.com', eventType: 'LOGIN_FAILED' }),
      );
      expect(authService.createSession).not.toHaveBeenCalled();
    });

    it('requires a captcha token when risk score is high and none was provided', async () => {
      authService.computeLoginRisk.mockResolvedValue({ score: 80, signals: ['new_ip'] });
      const req = fakeRequest();
      const res = fakeResponse();

      await expect(
        controller.login({ email: user.email, password: 'pw' }, req, res),
      ).rejects.toThrow(BadRequestException);
      expect(authService.validateUser).not.toHaveBeenCalled();
      expect(captchaProvider.verify).not.toHaveBeenCalled();
    });

    it('verifies the captcha token when risk is high and one was provided, then proceeds', async () => {
      authService.computeLoginRisk.mockResolvedValue({ score: 80, signals: ['new_ip'] });
      authService.validateUser.mockResolvedValue(user);
      const req = fakeRequest();
      const res = fakeResponse();

      const result = await controller.login(
        { email: user.email, password: 'pw', captchaToken: 'tok' },
        req,
        res,
      );

      expect(captchaProvider.verify).toHaveBeenCalledWith('tok', '127.0.0.1');
      expect(authService.validateUser).toHaveBeenCalled();
      expect(result).toEqual(user);
    });

    it('rejects with requiresCaptcha when the provided captcha token fails verification', async () => {
      authService.computeLoginRisk.mockResolvedValue({ score: 80, signals: ['new_ip'] });
      captchaProvider.verify.mockResolvedValue(false);
      const req = fakeRequest();
      const res = fakeResponse();

      await expect(
        controller.login({ email: user.email, password: 'pw', captchaToken: 'bad' }, req, res),
      ).rejects.toThrow(BadRequestException);
      expect(authService.validateUser).not.toHaveBeenCalled();
    });

    it('returns mfaRequired instead of creating a session when MFA is enabled and no trusted device matches', async () => {
      authService.validateUser.mockResolvedValue(user);
      authService.isMfaEnabled.mockResolvedValue(true);
      authService.checkTrustedDevice.mockResolvedValue(false);
      const req = fakeRequest();
      const res = fakeResponse();

      const result = await controller.login({ email: user.email, password: 'pw' }, req, res);

      expect(authService.createSession).not.toHaveBeenCalled();
      expect(authService.recordSecurityEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'LOGIN_SUCCESS' }),
      );
      expect(result).toEqual({ mfaRequired: true, mfaToken: 'mfa-challenge-token' });
    });

    it('skips the MFA challenge when a valid trusted-device cookie is present under low risk', async () => {
      authService.validateUser.mockResolvedValue(user);
      authService.isMfaEnabled.mockResolvedValue(true);
      authService.computeLoginRisk.mockResolvedValue({ score: 0, signals: [] });
      authService.checkTrustedDevice.mockResolvedValue(true);
      const req = fakeRequest({ trusted_device: 'raw-trusted-token' });
      const res = fakeResponse();

      const result = await controller.login({ email: user.email, password: 'pw' }, req, res);

      expect(authService.checkTrustedDevice).toHaveBeenCalledWith('user-1', 'raw-trusted-token');
      expect(authService.createSession).toHaveBeenCalled();
      expect(result).toEqual(user);
    });

    it('still requires the MFA challenge when a trusted-device cookie is valid but risk is high', async () => {
      authService.validateUser.mockResolvedValue(user);
      authService.isMfaEnabled.mockResolvedValue(true);
      authService.computeLoginRisk.mockResolvedValue({ score: 60, signals: ['new_ip'] });
      authService.checkTrustedDevice.mockResolvedValue(true);
      const req = fakeRequest({ trusted_device: 'raw-trusted-token' });
      const res = fakeResponse();

      const result = await controller.login(
        { email: user.email, password: 'pw', captchaToken: 'tok' },
        req,
        res,
      );

      expect(authService.checkTrustedDevice).not.toHaveBeenCalled();
      expect(authService.createSession).not.toHaveBeenCalled();
      expect(result).toEqual({ mfaRequired: true, mfaToken: 'mfa-challenge-token' });
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token and re-sets both cookies', async () => {
      const req = fakeRequest({ refresh_token: 'old-raw-token' });
      const res = fakeResponse();

      const result = await controller.refresh(req, res);

      expect(authService.rotateRefreshToken).toHaveBeenCalledWith('old-raw-token');
      expect(res.cookie).toHaveBeenCalledWith('token', fakeTokens.accessToken, expect.any(Object));
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        fakeTokens.refreshToken,
        expect.any(Object),
      );
      expect(result).toEqual({ success: true });
    });

    it('throws UnauthorizedException and clears cookies when no refresh cookie is present', async () => {
      const req = fakeRequest();
      const res = fakeResponse();

      await expect(controller.refresh(req, res)).rejects.toThrow(UnauthorizedException);
      expect(authService.rotateRefreshToken).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledWith('token', expect.any(Object));
      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
      expect(authService.recordSecurityEvent).not.toHaveBeenCalled();
    });

    it('logs REFRESH_REJECTED and clears cookies when a provided token is rejected', async () => {
      authService.rotateRefreshToken.mockRejectedValue(new UnauthorizedException('bad token'));
      const req = fakeRequest({ refresh_token: 'stale-token' });
      const res = fakeResponse();

      await expect(controller.refresh(req, res)).rejects.toThrow(UnauthorizedException);
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'REFRESH_REJECTED' }),
      );
      expect(res.clearCookie).toHaveBeenCalledWith('token', expect.any(Object));
    });
  });

  describe('logout', () => {
    it('revokes the session, logs LOGOUT, and clears both cookies', async () => {
      const req = fakeRequest({ refresh_token: 'raw-token' });
      const res = fakeResponse();

      const result = await controller.logout(req, res);

      expect(authService.revokeSession).toHaveBeenCalledWith('raw-token', 'logout');
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'LOGOUT' }),
      );
      expect(res.clearCookie).toHaveBeenCalledWith('token', expect.any(Object));
      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
      expect(result).toEqual({ success: true });
    });

    it('clears cookies without erroring when no refresh cookie is present', async () => {
      const req = fakeRequest();
      const res = fakeResponse();

      const result = await controller.logout(req, res);

      expect(authService.revokeSession).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledWith('token', expect.any(Object));
      expect(result).toEqual({ success: true });
    });
  });

  describe('logoutAll', () => {
    it('revokes every session, logs LOGOUT_ALL scope:all, and clears cookies', async () => {
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR' as const,
        emailVerified: false,
      };
      const req = fakeRequest();
      const res = fakeResponse();

      const result = await controller.logoutAll(user, req, res);

      expect(authService.revokeAllSessions).toHaveBeenCalledWith('user-1', 'logout_all');
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'LOGOUT_ALL', metadata: { scope: 'all' } }),
      );
      expect(res.clearCookie).toHaveBeenCalledWith('token', expect.any(Object));
      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
      expect(result).toEqual({ success: true });
    });
  });

  describe('listSessions', () => {
    it('returns the session list for the current user', async () => {
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR' as const,
        emailVerified: true,
      };
      const sessions = [{ id: 'session-1', current: true }];
      authService.listSessions.mockResolvedValue(sessions);

      const result = await controller.listSessions(user, 'session-1');

      expect(authService.listSessions).toHaveBeenCalledWith('user-1', 'session-1');
      expect(result).toEqual(sessions);
    });
  });

  describe('revokeSessionById', () => {
    it('revokes the given session and logs SESSION_REVOKED', async () => {
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR' as const,
        emailVerified: true,
      };
      const req = fakeRequest();

      await controller.revokeSessionById(user, 'session-2', req);

      expect(authService.revokeSessionById).toHaveBeenCalledWith('user-1', 'session-2');
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'SESSION_REVOKED',
          metadata: { sessionId: 'session-2' },
        }),
      );
    });
  });

  describe('logoutOthers', () => {
    it('revokes every other session and logs LOGOUT_ALL scope:others', async () => {
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR' as const,
        emailVerified: true,
      };
      const req = fakeRequest();

      const result = await controller.logoutOthers(user, 'session-1', req);

      expect(authService.revokeOtherSessions).toHaveBeenCalledWith('user-1', 'session-1');
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'LOGOUT_ALL', metadata: { scope: 'others' } }),
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('me', () => {
    it('returns the current user from the request', () => {
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR' as const,
        emailVerified: false,
      };

      expect(controller.me(user)).toEqual(user);
    });
  });

  describe('deleteAccount', () => {
    it('deletes the account and clears both auth cookies', async () => {
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR' as const,
        emailVerified: false,
      };
      const res = fakeResponse();

      await controller.deleteAccount(user, res);

      expect(authService.deleteAccount).toHaveBeenCalledWith('user-1');
      expect(res.clearCookie).toHaveBeenCalledWith('token', expect.any(Object));
      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
    });
  });

  describe('forgotPassword', () => {
    it('calls requestPasswordReset and returns a generic message', async () => {
      const result = await controller.forgotPassword({ email: 'a@example.com' });

      expect(authService.requestPasswordReset).toHaveBeenCalledWith(
        'a@example.com',
        expect.any(String),
      );
      expect(result).toEqual({
        message: 'If that email is registered, a reset link has been sent.',
      });
    });
  });

  describe('resetPassword', () => {
    it('resets the password, logs PASSWORD_RESET_COMPLETED, creates a session, sets cookies', async () => {
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR' as const,
        emailVerified: false,
      };
      authService.resetPassword.mockResolvedValue(user);
      const req = fakeRequest();
      const res = fakeResponse();

      const result = await controller.resetPassword(
        { token: 'raw-token', newPassword: 'newplaintext' },
        req,
        res,
      );

      expect(authService.resetPassword).toHaveBeenCalledWith('raw-token', 'newplaintext');
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', eventType: 'PASSWORD_RESET_COMPLETED' }),
      );
      expect(authService.createSession).toHaveBeenCalledWith(
        user,
        'Mozilla/5.0 (Test)',
        '127.0.0.1',
      );
      expect(res.cookie).toHaveBeenCalledWith('token', fakeTokens.accessToken, expect.any(Object));
      expect(result).toEqual(user);
    });
  });

  describe('verifyEmail', () => {
    it('calls verifyEmail with the token, logs EMAIL_VERIFIED, and returns the updated user', async () => {
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR' as const,
        emailVerified: true,
      };
      authService.verifyEmail.mockResolvedValue(user);
      const req = fakeRequest();

      const result = await controller.verifyEmail({ token: 'raw-token' }, req);

      expect(authService.verifyEmail).toHaveBeenCalledWith('raw-token');
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', eventType: 'EMAIL_VERIFIED' }),
      );
      expect(result).toEqual(user);
    });
  });

  describe('resendVerification', () => {
    it('calls resendVerification with the current user id and returns a generic message', async () => {
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR' as const,
        emailVerified: false,
      };

      const result = await controller.resendVerification(user);

      expect(authService.resendVerification).toHaveBeenCalledWith('user-1', expect.any(String));
      expect(result).toEqual({ message: 'Verification email sent.' });
    });
  });

  describe('changePassword', () => {
    it('calls changePassword with the current user id', async () => {
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        role: 'CREATOR' as const,
        emailVerified: false,
      };

      const result = await controller.changePassword({ newPassword: 'newplaintext' }, user);

      expect(authService.changePassword).toHaveBeenCalledWith('user-1', 'newplaintext');
      expect(result).toEqual({ success: true });
    });
  });

  describe('elevate', () => {
    const user = {
      id: 'user-1',
      email: 'a@example.com',
      role: 'CREATOR' as const,
      emailVerified: true,
    };

    it('verifies the credential, elevates the session, and returns the expiry', async () => {
      authService.verifyElevationCredential.mockResolvedValue(true);
      const elevatedUntil = new Date(Date.now() + 15 * 60 * 1000);
      authService.elevateSession.mockResolvedValue(elevatedUntil);

      const result = await controller.elevate({ code: '123456' }, user, 'session-1');

      expect(authService.verifyElevationCredential).toHaveBeenCalledWith('user-1', {
        code: '123456',
      });
      expect(authService.elevateSession).toHaveBeenCalledWith('session-1');
      expect(result).toEqual({ success: true, elevatedUntil });
    });

    it('rejects an invalid credential without elevating the session', async () => {
      authService.verifyElevationCredential.mockResolvedValue(false);

      await expect(controller.elevate({ code: 'wrong' }, user, 'session-1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.elevateSession).not.toHaveBeenCalled();
    });
  });
});
