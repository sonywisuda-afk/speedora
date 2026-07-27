// Authentication Foundation Sprint 4 (Attack Protection) - AuthService/
// AuthController depend on this interface only, never a concrete provider
// class, via the CAPTCHA_PROVIDER DI token below. Swapping providers later
// (e.g. Turnstile -> hCaptcha) means registering a different class against
// this same token in auth.module.ts - zero changes to auth or risk-scoring
// logic.
export interface CaptchaProvider {
  verify(token: string, remoteIp: string | undefined): Promise<boolean>;
}

export const CAPTCHA_PROVIDER = Symbol('CAPTCHA_PROVIDER');
