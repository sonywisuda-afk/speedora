import { authenticator } from 'otplib';
import type { PrismaService } from '../../prisma/prisma.service';
import { MfaService } from './mfa.service';

// Real encryptToken/decryptToken round trip (not mocked) - this key exists
// purely for the test process, same "a real, valid-shaped key, never a
// production secret" posture as other specs that exercise real crypto.
process.env.TOKEN_ENCRYPTION_KEY = 'aa'.repeat(32);

describe('MfaService', () => {
  let service: MfaService;
  let prisma: {
    mfaRecoveryCode: { updateMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      mfaRecoveryCode: { updateMany: jest.fn() },
    };
    service = new MfaService(prisma as unknown as PrismaService);
  });

  describe('generateSecret', () => {
    it('returns a non-empty base32 secret', () => {
      const secret = service.generateSecret();
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(10);
    });

    it('returns a different secret on each call', () => {
      expect(service.generateSecret()).not.toBe(service.generateSecret());
    });
  });

  describe('buildOtpAuthUrl', () => {
    it('builds an otpauth:// URI carrying the Speedora issuer and the account email', () => {
      const secret = service.generateSecret();
      const url = service.buildOtpAuthUrl('user@example.com', secret);

      expect(url).toMatch(/^otpauth:\/\/totp\//);
      expect(url).toContain(encodeURIComponent('user@example.com'));
      expect(url).toContain('issuer=Speedora');
    });
  });

  describe('generateQrCodeDataUrl', () => {
    it('renders the otpauth URL as a PNG data URL', async () => {
      const secret = service.generateSecret();
      const otpAuthUrl = service.buildOtpAuthUrl('user@example.com', secret);

      const dataUrl = await service.generateQrCodeDataUrl(otpAuthUrl);

      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    });
  });

  describe('verifyTotpCode', () => {
    it('accepts the real current TOTP code for a secret', () => {
      const secret = service.generateSecret();
      const code = authenticator.generate(secret);

      expect(service.verifyTotpCode(secret, code)).toBe(true);
    });

    it('rejects a wrong code', () => {
      const secret = service.generateSecret();

      expect(service.verifyTotpCode(secret, '000000')).toBe(false);
    });

    it('rejects a malformed (non-numeric) code without throwing', () => {
      const secret = service.generateSecret();

      expect(service.verifyTotpCode(secret, 'not-a-code')).toBe(false);
    });
  });

  describe('encryptSecret / decryptSecret', () => {
    it('round-trips a secret through AES-256-GCM encryption', () => {
      const secret = service.generateSecret();

      const encrypted = service.encryptSecret(secret);
      expect(encrypted).not.toBe(secret);
      expect(service.decryptSecret(encrypted)).toBe(secret);
    });
  });

  describe('generateRecoveryCodes', () => {
    it('generates 10 unique XXXX-XXXX codes', () => {
      const codes = service.generateRecoveryCodes();

      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      for (const code of codes) {
        expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      }
    });
  });

  describe('hashRecoveryCode', () => {
    it('is deterministic and case-insensitive', () => {
      const a = service.hashRecoveryCode('ABCD-1234');
      const b = service.hashRecoveryCode('abcd-1234');

      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for different codes', () => {
      expect(service.hashRecoveryCode('AAAA-1111')).not.toBe(service.hashRecoveryCode('BBBB-2222'));
    });
  });

  describe('consumeRecoveryCode', () => {
    it('returns true and marks the code used when an unused match exists', async () => {
      prisma.mfaRecoveryCode.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.consumeRecoveryCode('user-1', 'ABCD-1234');

      expect(result).toBe(true);
      expect(prisma.mfaRecoveryCode.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', codeHash: service.hashRecoveryCode('ABCD-1234'), usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('returns false when the code is unknown or already used', async () => {
      prisma.mfaRecoveryCode.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.consumeRecoveryCode('user-1', 'ABCD-1234');

      expect(result).toBe(false);
    });
  });

  describe('verifyMfaCodeOrRecoveryCode', () => {
    it('accepts a valid TOTP code without touching recovery codes', async () => {
      const secret = service.generateSecret();
      const code = authenticator.generate(secret);
      const encrypted = service.encryptSecret(secret);

      const result = await service.verifyMfaCodeOrRecoveryCode('user-1', encrypted, code);

      expect(result).toBe(true);
      expect(prisma.mfaRecoveryCode.updateMany).not.toHaveBeenCalled();
    });

    it('falls back to a recovery code when the TOTP code is wrong', async () => {
      const secret = service.generateSecret();
      const encrypted = service.encryptSecret(secret);
      prisma.mfaRecoveryCode.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.verifyMfaCodeOrRecoveryCode('user-1', encrypted, 'ABCD-1234');

      expect(result).toBe(true);
      expect(prisma.mfaRecoveryCode.updateMany).toHaveBeenCalled();
    });

    it('rejects when neither a valid TOTP code nor a valid recovery code is given', async () => {
      const secret = service.generateSecret();
      const encrypted = service.encryptSecret(secret);
      prisma.mfaRecoveryCode.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.verifyMfaCodeOrRecoveryCode('user-1', encrypted, 'ABCD-1234');

      expect(result).toBe(false);
    });
  });
});
