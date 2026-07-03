// Only variables with no safe fallback are listed here - FFMPEG_PATH
// already defaults to "ffmpeg" (assumed on PATH) in ffmpeg.ts and doesn't
// need to be required. A missing DATABASE_URL/REDIS_URL/OPENAI_API_KEY/
// STORAGE_* would otherwise fail confusingly deep inside a connection
// attempt or API call instead of failing loudly at boot.
//
// SENTRY_DSN is deliberately NOT in this list - it's optional (see
// sentry.ts's initSentry()), fine to leave unset in local dev, and
// Sentry.init() with an empty dsn just disables the SDK rather than
// throwing.
//
// GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET/TOKEN_ENCRYPTION_KEY/
// API_BASE_URL (Fase 6b) are also read by publish-clip.worker.ts via
// @viral-clip-app/social's YouTubeOAuthClient/resolveAccessToken/
// token-encryption - same optional-at-boot treatment as apps/api (see
// CLAUDE.md's Fase 6a/6b sections): a publish-clip job just fails (and gets
// reported to Sentry like any other job error) if they're unset, rather
// than the whole worker refusing to start for everyone who hasn't set up
// Google Cloud OAuth yet.
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'OPENAI_API_KEY',
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
] as const;

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. Check .env against .env.example.`,
    );
  }
}
