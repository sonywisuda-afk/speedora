import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthService, SafeUser } from '../auth.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { MfaController } from './mfa.controller';
import type { MfaService } from './mfa.service';

function fakeRequest(): Request {
  return {
    headers: { 'user-agent': 'Mozilla/5.0 (Test)' },
    ip: '127.0.0.1',
  } as unknown as Request;
}

function fakeResponse(): Response {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;
}

const user: SafeUser = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'CREATOR',
  emailVerified: true,
};

describe('MfaController', () => {
  let controller: MfaController;
  let prisma: {
    user: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    mfaRecoveryCode: { count: jest.Mock; deleteMany: jest.Mock; createMany: jest.Mock };
    trustedDevice: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let mfaService: {
    generateSecret: jest.Mock;
    buildOtpAuthUrl: jest.Mock;
    generateQrCodeDataUrl: jest.Mock;
    verifyTotpCode: jest.Mock;
    encryptSecret: jest.Mock;
    decryptSecret: jest.Mock;
    generateRecoveryCodes: jest.Mock;
    hashRecoveryCode: jest.Mock;
    verifyMfaCodeOrRecoveryCode: jest.Mock;
  };
  let authService: {
    recordSecurityEvent: jest.Mock;
    verifyMfaChallengeToken: jest.Mock;
    createSession: jest.Mock;
    createTrustedDevice: jest.Mock;
    listTrustedDevices: jest.Mock;
    revokeTrustedDeviceById: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      mfaRecoveryCode: {
        count: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      trustedDevice: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    mfaService = {
      generateSecret: jest.fn().mockReturnValue('SECRET'),
      buildOtpAuthUrl: jest.fn().mockReturnValue('otpauth://totp/Speedora:user@example.com'),
      generateQrCodeDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,xyz'),
      verifyTotpCode: jest.fn(),
      encryptSecret: jest.fn().mockReturnValue('encrypted-secret'),
      decryptSecret: jest.fn().mockReturnValue('SECRET'),
      generateRecoveryCodes: jest.fn().mockReturnValue(['AAAA-1111', 'BBBB-2222']),
      hashRecoveryCode: jest.fn().mockImplementation((code: string) => `hash(${code})`),
      verifyMfaCodeOrRecoveryCode: jest.fn(),
    };
    authService = {
      recordSecurityEvent: jest.fn().mockResolvedValue(undefined),
      verifyMfaChallengeToken: jest.fn().mockReturnValue({ userId: user.id, method: 'password' }),
      createSession: jest.fn().mockResolvedValue({
        accessToken: 'access-tok',
        refreshToken: 'refresh-tok',
        refreshTokenExpiresAt: new Date(Date.now() + 60_000),
      }),
      createTrustedDevice: jest.fn().mockResolvedValue({
        rawToken: 'raw-trusted-token',
        expiresAt: new Date(Date.now() + 60_000),
      }),
      listTrustedDevices: jest.fn(),
      revokeTrustedDeviceById: jest.fn().mockResolvedValue(undefined),
    };
    controller = new MfaController(
      prisma as unknown as PrismaService,
      mfaService as unknown as MfaService,
      authService as unknown as AuthService,
    );
  });

  describe('status', () => {
    it('reports disabled with zero recovery codes when MFA was never enrolled', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ mfaEnabled: false, mfaEnabledAt: null });

      const result = await controller.status(user);

      expect(result).toEqual({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0 });
      expect(prisma.mfaRecoveryCode.count).not.toHaveBeenCalled();
    });

    it('reports enabled with the remaining unused recovery code count', async () => {
      const enabledAt = new Date();
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        mfaEnabled: true,
        mfaEnabledAt: enabledAt,
      });
      prisma.mfaRecoveryCode.count.mockResolvedValue(7);

      const result = await controller.status(user);

      expect(result).toEqual({ enabled: true, enabledAt, recoveryCodesRemaining: 7 });
      expect(prisma.mfaRecoveryCode.count).toHaveBeenCalledWith({
        where: { userId: user.id, usedAt: null },
      });
    });
  });

  describe('enroll', () => {
    it('generates and persists a fresh secret, returning it with a QR code', async () => {
      const result = await controller.enroll(user);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { mfaSecret: 'encrypted-secret' },
      });
      expect(mfaService.buildOtpAuthUrl).toHaveBeenCalledWith(user.email, 'SECRET');
      expect(result).toEqual({ secret: 'SECRET', qrCodeDataUrl: 'data:image/png;base64,xyz' });
    });
  });

  describe('confirmEnroll', () => {
    it('rejects when no enrollment (no mfaSecret) is in progress', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ mfaSecret: null });

      await expect(
        controller.confirmEnroll(user, fakeRequest(), { code: '123456' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an invalid verification code without enabling MFA', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ mfaSecret: 'encrypted-secret' });
      mfaService.verifyTotpCode.mockReturnValue(false);

      await expect(
        controller.confirmEnroll(user, fakeRequest(), { code: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('enables MFA, stores hashed recovery codes, and records a security event on success', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ mfaSecret: 'encrypted-secret' });
      mfaService.verifyTotpCode.mockReturnValue(true);

      const result = await controller.confirmEnroll(user, fakeRequest(), { code: '123456' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { mfaEnabled: true, mfaEnabledAt: expect.any(Date) },
      });
      expect(prisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: user.id },
      });
      expect(prisma.mfaRecoveryCode.createMany).toHaveBeenCalledWith({
        data: [
          { userId: user.id, codeHash: 'hash(AAAA-1111)' },
          { userId: user.id, codeHash: 'hash(BBBB-2222)' },
        ],
      });
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, eventType: 'MFA_ENABLED' }),
      );
      expect(result).toEqual({ recoveryCodes: ['AAAA-1111', 'BBBB-2222'] });
    });
  });

  describe('disable', () => {
    // Tahap 2 Step 2 Sprint 2b (Session Elevation) - disable no longer
    // verifies a code of its own; RecentMfaGuard (exercised via the real
    // HTTP pipeline, not by calling the controller method directly) already
    // proved recent identity via POST /auth/elevate.
    it('rejects when MFA is not currently enabled', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ mfaEnabled: false, mfaSecret: null });

      await expect(controller.disable(user, fakeRequest())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('disables MFA, clears the secret/recovery codes, and records a security event on success', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        mfaEnabled: true,
        mfaSecret: 'encrypted-secret',
      });

      const result = await controller.disable(user, fakeRequest());

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { mfaEnabled: false, mfaSecret: null, mfaEnabledAt: null },
      });
      expect(prisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: user.id },
      });
      expect(prisma.trustedDevice.updateMany).toHaveBeenCalledWith({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, eventType: 'MFA_DISABLED' }),
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('regenerateRecoveryCodes', () => {
    it('rejects when MFA is not currently enabled', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ mfaEnabled: false, mfaSecret: null });

      await expect(controller.regenerateRecoveryCodes(user, fakeRequest())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('replaces recovery codes and records a security event on success', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        mfaEnabled: true,
        mfaSecret: 'encrypted-secret',
      });

      const result = await controller.regenerateRecoveryCodes(user, fakeRequest());

      expect(prisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: user.id },
      });
      expect(prisma.mfaRecoveryCode.createMany).toHaveBeenCalled();
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, eventType: 'MFA_RECOVERY_CODES_REGENERATED' }),
      );
      expect(result).toEqual({ recoveryCodes: ['AAAA-1111', 'BBBB-2222'] });
    });
  });

  describe('challenge', () => {
    const mfaUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      mfaSecret: 'encrypted-secret',
    };

    it('rejects an invalid mfaToken before ever loading the user', async () => {
      authService.verifyMfaChallengeToken.mockImplementation(() => {
        throw new UnauthorizedException('MFA challenge is invalid or has expired');
      });

      await expect(
        controller.challenge({ mfaToken: 'bad', code: '123456' }, fakeRequest(), fakeResponse()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('rejects an invalid code, logs LOGIN_FAILED, and never creates a session', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(mfaUser);
      mfaService.verifyMfaCodeOrRecoveryCode.mockResolvedValue(false);

      await expect(
        controller.challenge({ mfaToken: 'good', code: 'wrong' }, fakeRequest(), fakeResponse()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'LOGIN_FAILED',
          metadata: { method: 'password', reason: 'invalid_mfa_code' },
        }),
      );
      expect(authService.createSession).not.toHaveBeenCalled();
    });

    it('creates a session, sets cookies, and logs LOGIN_SUCCESS on a valid code', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(mfaUser);
      mfaService.verifyMfaCodeOrRecoveryCode.mockResolvedValue(true);
      const res = fakeResponse();

      const result = await controller.challenge(
        { mfaToken: 'good', code: '123456' },
        fakeRequest(),
        res,
      );

      expect(authService.recordSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'LOGIN_SUCCESS',
          metadata: { method: 'password', mfaVerified: true },
        }),
      );
      expect(authService.createSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'password',
      );
      expect(res.cookie).toHaveBeenCalledWith('token', 'access-tok', expect.any(Object));
      expect(authService.createTrustedDevice).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
      });
    });

    it('creates and sets a trusted-device cookie when rememberDevice is true', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(mfaUser);
      mfaService.verifyMfaCodeOrRecoveryCode.mockResolvedValue(true);
      const res = fakeResponse();

      await controller.challenge(
        { mfaToken: 'good', code: '123456', rememberDevice: true },
        fakeRequest(),
        res,
      );

      expect(authService.createTrustedDevice).toHaveBeenCalledWith(
        user.id,
        'Mozilla/5.0 (Test)',
        '127.0.0.1',
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'trusted_device',
        'raw-trusted-token',
        expect.any(Object),
      );
    });
  });

  describe('listTrustedDevices', () => {
    it('returns the trusted-device list for the current user', async () => {
      const devices = [{ id: 'device-1' }];
      authService.listTrustedDevices.mockResolvedValue(devices);

      const result = await controller.listTrustedDevices(user);

      expect(authService.listTrustedDevices).toHaveBeenCalledWith(user.id);
      expect(result).toEqual(devices);
    });
  });

  describe('revokeTrustedDevice', () => {
    it('revokes the given trusted device', async () => {
      await controller.revokeTrustedDevice(user, 'device-2');

      expect(authService.revokeTrustedDeviceById).toHaveBeenCalledWith(user.id, 'device-2');
    });
  });
});
