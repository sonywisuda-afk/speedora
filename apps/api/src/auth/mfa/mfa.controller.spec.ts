import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
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
  let authService: { recordSecurityEvent: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      mfaRecoveryCode: {
        count: jest.fn(),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
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
    authService = { recordSecurityEvent: jest.fn().mockResolvedValue(undefined) };
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
    it('rejects when MFA is not currently enabled', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ mfaEnabled: false, mfaSecret: null });

      await expect(
        controller.disable(user, fakeRequest(), { code: '123456' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an invalid code and leaves MFA enabled', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        mfaEnabled: true,
        mfaSecret: 'encrypted-secret',
      });
      mfaService.verifyMfaCodeOrRecoveryCode.mockResolvedValue(false);

      await expect(
        controller.disable(user, fakeRequest(), { code: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('disables MFA, clears the secret/recovery codes, and records a security event on success', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        mfaEnabled: true,
        mfaSecret: 'encrypted-secret',
      });
      mfaService.verifyMfaCodeOrRecoveryCode.mockResolvedValue(true);

      const result = await controller.disable(user, fakeRequest(), { code: '123456' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { mfaEnabled: false, mfaSecret: null, mfaEnabledAt: null },
      });
      expect(prisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: user.id },
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

      await expect(
        controller.regenerateRecoveryCodes(user, fakeRequest(), { code: '123456' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('replaces recovery codes and records a security event on success', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        mfaEnabled: true,
        mfaSecret: 'encrypted-secret',
      });
      mfaService.verifyMfaCodeOrRecoveryCode.mockResolvedValue(true);

      const result = await controller.regenerateRecoveryCodes(user, fakeRequest(), {
        code: '123456',
      });

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
});
