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
