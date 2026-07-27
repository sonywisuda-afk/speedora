import { Injectable } from '@nestjs/common';
import { decryptToken, encryptToken } from '@speedora/social';
import * as crypto from 'node:crypto';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';

// Tahap 2 Step 2 Sprint 1 (MFA Foundation) - narrower than otplib's default
// window (which some authenticator libraries leave wide open). +/-1 step
// (+/-30s) tolerates normal device clock drift without meaningfully
// widening the code-guessing surface.
authenticator.options = { window: 1 };

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomRecoveryCode(): string {
  const bytes = crypto.randomBytes(8);
  let raw = '';
  for (const byte of bytes) {
    raw += RECOVERY_CODE_ALPHABET[byte % RECOVERY_CODE_ALPHABET.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

// Tahap 2 Step 2 Sprint 1 (MFA Foundation) - TOTP/recovery-code primitives,
// split out of AuthService same as LoginBackoffService/TurnstileCaptchaProvider
// were (a genuinely separate concern, not auth's core session/credential
// logic). Uses otplib (RFC 6238, battle-tested) instead of hand-rolled
// HMAC/base32 code, and @speedora/social's existing encryptToken/
// decryptToken (AES-256-GCM via TOKEN_ENCRYPTION_KEY) for the secret at
// rest - unlike every other token in this app's auth code, a TOTP secret
// must be decryptable to check a future code against it, so it can't be a
// one-way hash like every other stored token here.
@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  buildOtpAuthUrl(email: string, secret: string): string {
    return authenticator.keyuri(email, 'Speedora', secret);
  }

  async generateQrCodeDataUrl(otpAuthUrl: string): Promise<string> {
    return QRCode.toDataURL(otpAuthUrl);
  }

  verifyTotpCode(secret: string, code: string): boolean {
    try {
      return authenticator.check(code, secret);
    } catch {
      // otplib throws on a malformed (non-numeric/wrong-length) token
      // rather than returning false - treat that identically to "wrong
      // code" so callers never need a separate try/catch of their own.
      return false;
    }
  }

  encryptSecret(secret: string): string {
    return encryptToken(secret);
  }

  decryptSecret(encrypted: string): string {
    return decryptToken(encrypted);
  }

  generateRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);
  }

  hashRecoveryCode(code: string): string {
    return crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
  }

  // Atomic claim, same "updateMany + count check" pattern as
  // AuthService.revokeSessionById - a code can never be consumed twice even
  // under concurrent requests.
  async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const codeHash = this.hashRecoveryCode(code);
    const { count } = await this.prisma.mfaRecoveryCode.updateMany({
      where: { userId, codeHash, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count > 0;
  }

  // Tries a TOTP code first, falls back to an unused recovery code -
  // the uniform "prove you still control a second factor" gate used by
  // disable/regenerate. Works for OAuth-only accounts too (User.password
  // can be null since Tahap 2 Step 1), unlike a "require current password"
  // check.
  async verifyMfaCodeOrRecoveryCode(
    userId: string,
    encryptedSecret: string,
    code: string,
  ): Promise<boolean> {
    if (this.verifyTotpCode(this.decryptSecret(encryptedSecret), code)) {
      return true;
    }
    return this.consumeRecoveryCode(userId, code);
  }
}
