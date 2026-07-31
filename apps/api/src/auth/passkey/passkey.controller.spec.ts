import type { Request, Response } from 'express';
import type { AuthService } from '../auth.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { PasskeyController } from './passkey.controller';
import type { PasskeyService } from './passkey.service';

const fakeUser = {
  id: 'user-1',
  email: 'a@example.com',
  role: 'CREATOR' as const,
  emailVerified: true,
};

function fakeRequest(): Request {
  return {
    headers: { 'user-agent': 'Mozilla/5.0 (Test)' },
    ip: '127.0.0.1',
    cookies: {},
  } as unknown as Request;
}

function fakeResponse(): Response {
  return { cookie: jest.fn().mockReturnThis() } as unknown as Response;
}

const fakeTokens = {
  accessToken: 'access-tok',
  refreshToken: 'refresh-tok',
  refreshTokenExpiresAt: new Date(Date.now() + 60_000),
};

describe('PasskeyController', () => {
  let controller: PasskeyController;
  let passkeyService: {
    list: jest.Mock;
    generateRegistrationOptionsFor: jest.Mock;
    verifyAndSaveRegistration: jest.Mock;
    rename: jest.Mock;
    delete: jest.Mock;
    generateAuthenticationOptionsFor: jest.Mock;
    verifyAuthentication: jest.Mock;
  };
  let authService: {
    recordSecurityEvent: jest.Mock;
    computeLoginRisk: jest.Mock;
    isMfaEnabled: jest.Mock;
    checkTrustedDevice: jest.Mock;
    issueMfaChallengeToken: jest.Mock;
    createSession: jest.Mock;
  };
  let prisma: { user: { findUniqueOrThrow: jest.Mock } };

  beforeEach(() => {
    passkeyService = {
      list: jest.fn(),
      generateRegistrationOptionsFor: jest.fn(),
      verifyAndSaveRegistration: jest.fn(),
      rename: jest.fn(),
      delete: jest.fn(),
      generateAuthenticationOptionsFor: jest.fn(),
      verifyAuthentication: jest.fn(),
    };
    authService = {
      recordSecurityEvent: jest.fn().mockResolvedValue(undefined),
      computeLoginRisk: jest.fn().mockResolvedValue({ score: 0, signals: [] }),
      isMfaEnabled: jest.fn().mockResolvedValue(false),
      checkTrustedDevice: jest.fn().mockResolvedValue(false),
      issueMfaChallengeToken: jest.fn().mockReturnValue('mfa-challenge-token'),
      createSession: jest.fn().mockResolvedValue(fakeTokens),
    };
    prisma = { user: { findUniqueOrThrow: jest.fn().mockResolvedValue(fakeUser) } };
    controller = new PasskeyController(
      passkeyService as unknown as PasskeyService,
      authService as unknown as AuthService,
      prisma as unknown as PrismaService,
    );
  });

  describe('list', () => {
    it('delegates to PasskeyService scoped to the current user', async () => {
      passkeyService.list.mockResolvedValue([{ id: 'p1' }]);

      const result = await controller.list(fakeUser);

      expect(passkeyService.list).toHaveBeenCalledWith('user-1');
      expect(result).toEqual([{ id: 'p1' }]);
    });
  });

  describe('registerOptions', () => {
    it('generates options scoped to the current user id/email', async () => {
      passkeyService.generateRegistrationOptionsFor.mockResolvedValue({
        options: { challenge: 'c' },
        challengeToken: 'tok',
      });

      await controller.registerOptions(fakeUser);

      expect(passkeyService.generateRegistrationOptionsFor).toHaveBeenCalledWith(
        'user-1',
        'a@example.com',
      );
    });
  });

  describe('registerVerify', () => {
    it('saves the credential and records a PASSKEY_ADDED security event', async () => {
      const passkey = { id: 'p1', deviceType: 'singleDevice' };
      passkeyService.verifyAndSaveRegistration.mockResolvedValue(passkey);
      const req = fakeRequest();

      const result = await controller.registerVerify(
        fakeUser,
        { response: {} as never, challengeToken: 'tok', name: 'My Passkey' },
        req,
      );

      expect(passkeyService.verifyAndSaveRegistration).toHaveBeenCalledWith(
        'user-1',
        {},
        'tok',
        'My Passkey',
      );
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith({
        userId: 'user-1',
        email: 'a@example.com',
        eventType: 'PASSKEY_ADDED',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0 (Test)',
        metadata: { passkeyId: 'p1', deviceType: 'singleDevice' },
      });
      expect(result).toBe(passkey);
    });

    it('does not record a security event when verification throws', async () => {
      passkeyService.verifyAndSaveRegistration.mockRejectedValue(new Error('boom'));

      await expect(
        controller.registerVerify(
          fakeUser,
          { response: {} as never, challengeToken: 'tok', name: 'My Passkey' },
          fakeRequest(),
        ),
      ).rejects.toThrow('boom');
      expect(authService.recordSecurityEvent).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('delegates to PasskeyService scoped to the current user', async () => {
      passkeyService.rename.mockResolvedValue({ id: 'p1', name: 'New name' });

      const result = await controller.rename(fakeUser, 'p1', { name: 'New name' });

      expect(passkeyService.rename).toHaveBeenCalledWith('user-1', 'p1', 'New name');
      expect(result).toEqual({ id: 'p1', name: 'New name' });
    });
  });

  describe('delete', () => {
    it('deletes and records a PASSKEY_REMOVED security event', async () => {
      const req = fakeRequest();

      await controller.delete(fakeUser, 'p1', req);

      expect(passkeyService.delete).toHaveBeenCalledWith('user-1', 'p1');
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith({
        userId: 'user-1',
        email: 'a@example.com',
        eventType: 'PASSKEY_REMOVED',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0 (Test)',
        metadata: { passkeyId: 'p1' },
      });
    });

    it('does not record a security event when deletion throws', async () => {
      passkeyService.delete.mockRejectedValue(new Error('not found'));

      await expect(controller.delete(fakeUser, 'p1', fakeRequest())).rejects.toThrow('not found');
      expect(authService.recordSecurityEvent).not.toHaveBeenCalled();
    });
  });

  describe('loginOptions', () => {
    it('delegates to PasskeyService with no user context (usernameless)', async () => {
      passkeyService.generateAuthenticationOptionsFor.mockResolvedValue({
        options: { challenge: 'c' },
        challengeToken: 'tok',
      });

      await controller.loginOptions();

      expect(passkeyService.generateAuthenticationOptionsFor).toHaveBeenCalledWith();
    });
  });

  describe('loginVerify', () => {
    it('creates a session directly when the assertion carried user verification', async () => {
      passkeyService.verifyAuthentication.mockResolvedValue({
        userId: 'user-1',
        userVerified: true,
      });
      const req = fakeRequest();
      const res = fakeResponse();

      const result = await controller.loginVerify(
        { response: {} as never, challengeToken: 'tok' },
        req,
        res,
      );

      // UV assertion is MFA-equivalent (Tahap 3 Sprint 2 decision) - the
      // isMfaEnabled/trusted-device/challenge branch must never even be
      // consulted.
      expect(authService.isMfaEnabled).not.toHaveBeenCalled();
      expect(authService.issueMfaChallengeToken).not.toHaveBeenCalled();
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith({
        userId: 'user-1',
        email: 'a@example.com',
        eventType: 'LOGIN_SUCCESS',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0 (Test)',
        metadata: { method: 'passkey', userVerified: true, riskScore: 0, signals: [] },
      });
      expect(authService.createSession).toHaveBeenCalledWith(
        fakeUser,
        'Mozilla/5.0 (Test)',
        '127.0.0.1',
      );
      expect(res.cookie).toHaveBeenCalled();
      expect(result).toEqual(fakeUser);
    });

    it('falls back to an MFA challenge when the assertion lacked user verification and MFA is enabled', async () => {
      passkeyService.verifyAuthentication.mockResolvedValue({
        userId: 'user-1',
        userVerified: false,
      });
      authService.isMfaEnabled.mockResolvedValue(true);
      authService.checkTrustedDevice.mockResolvedValue(false);

      const result = await controller.loginVerify(
        { response: {} as never, challengeToken: 'tok' },
        fakeRequest(),
        fakeResponse(),
      );

      expect(result).toEqual({ mfaRequired: true, mfaToken: 'mfa-challenge-token' });
      expect(authService.createSession).not.toHaveBeenCalled();
      expect(authService.recordSecurityEvent).not.toHaveBeenCalled();
    });

    it('creates a session for a non-UV assertion when the account has no MFA enabled', async () => {
      passkeyService.verifyAuthentication.mockResolvedValue({
        userId: 'user-1',
        userVerified: false,
      });
      authService.isMfaEnabled.mockResolvedValue(false);

      const result = await controller.loginVerify(
        { response: {} as never, challengeToken: 'tok' },
        fakeRequest(),
        fakeResponse(),
      );

      expect(authService.createSession).toHaveBeenCalled();
      expect(result).toEqual(fakeUser);
    });

    it('skips the trusted-device cookie check and challenges when risk is above the threshold, even for a non-UV assertion', async () => {
      passkeyService.verifyAuthentication.mockResolvedValue({
        userId: 'user-1',
        userVerified: false,
      });
      authService.isMfaEnabled.mockResolvedValue(true);
      authService.computeLoginRisk.mockResolvedValue({ score: 99, signals: ['new_ip'] });

      const result = await controller.loginVerify(
        { response: {} as never, challengeToken: 'tok' },
        fakeRequest(),
        fakeResponse(),
      );

      expect(authService.checkTrustedDevice).not.toHaveBeenCalled();
      expect(result).toEqual({ mfaRequired: true, mfaToken: 'mfa-challenge-token' });
    });
  });
});
