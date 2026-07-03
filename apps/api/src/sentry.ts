import * as Sentry from '@sentry/node';

// SENTRY_DSN is optional (see config/env.validation.ts) - Sentry.init() with
// an empty/undefined dsn just disables the SDK (captureException calls
// become no-ops) rather than throwing, so this is safe to call
// unconditionally in every environment including local dev without a DSN
// configured. Called from main.ts after NestFactory.create() - by then
// ConfigModule has already loaded .env into process.env.
export function initSentry(): void {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    // Explicit, not just relying on the SDK default: request/response data
    // must never carry auth cookies, JWTs, or other request bodies into
    // Sentry (see SentryExceptionFilter, which only ever sends the caught
    // exception itself, never req/res objects).
    sendDefaultPii: false,
  });
}
