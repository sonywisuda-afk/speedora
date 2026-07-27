import { Injectable, Logger } from '@nestjs/common';
import type { CaptchaProvider } from './captcha-provider.interface';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileVerifyResponse {
  success: boolean;
  [key: string]: unknown;
}

// Authentication Foundation Sprint 4 (Attack Protection) - the first (and
// currently only) CaptchaProvider implementation. Chosen over reCAPTCHA
// v3/hCaptcha: Speedora already uses Cloudflare (R2 in production), and
// Turnstile's plain pass/fail check doesn't duplicate this sprint's own
// risk-scoring engine the way reCAPTCHA v3's built-in 0.0-1.0 score would.
// Node 24's global fetch is used directly - no new HTTP client dependency.
@Injectable()
export class TurnstileCaptchaProvider implements CaptchaProvider {
  private readonly logger = new Logger(TurnstileCaptchaProvider.name);

  async verify(token: string, remoteIp: string | undefined): Promise<boolean> {
    const secretKey = process.env.TURNSTILE_SECRET_KEY;
    // Same SMTP_HOST-unset graceful-degradation posture as MailService -
    // local dev never needs a real Turnstile account to keep login working.
    if (!secretKey) {
      this.logger.warn('TURNSTILE_SECRET_KEY is not configured - skipping CAPTCHA verification');
      return true;
    }

    try {
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: secretKey, response: token, remoteip: remoteIp }),
      });
      const data = (await res.json()) as TurnstileVerifyResponse;
      return data.success === true;
    } catch (error) {
      // Fail CLOSED here (unlike the unset-key branch above) - once
      // Turnstile is actually configured and required, a transient
      // Cloudflare/network failure shouldn't silently let an unverified
      // request through.
      this.logger.error(`Turnstile verification request failed: ${error}`);
      return false;
    }
  }
}
