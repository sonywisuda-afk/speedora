import * as Sentry from '@sentry/node';

// SENTRY_DSN is optional (see env.ts) - Sentry.init() with an empty/
// undefined dsn just disables the SDK (captureException calls become
// no-ops) rather than throwing, so this is safe to call unconditionally
// in every environment including local dev without a DSN configured.
export function initSentry(): void {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    // Explicit, not just relying on the SDK default: job payloads/errors
    // caught here must never carry transcript text, API keys, or other
    // request data into Sentry (see the videoId/clipId-only tags added at
    // each worker's captureException call site).
    sendDefaultPii: false,
  });
}
