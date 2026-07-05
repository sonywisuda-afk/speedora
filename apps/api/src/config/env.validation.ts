import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, validateSync } from 'class-validator';

// Only variables with no safe fallback are required here - things like
// WEB_ORIGIN/API_PORT/JWT_EXPIRES_IN already default sensibly in the code
// that reads them and don't need to be listed. A missing DATABASE_URL,
// REDIS_URL, JWT_SECRET, or STORAGE_* would otherwise fail confusingly deep
// inside a connection attempt (or, for JWT_SECRET, silently sign tokens
// with `undefined` as the secret) instead of failing loudly at boot.
class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_ENDPOINT!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_REGION!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_BUCKET!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_ACCESS_KEY_ID!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_SECRET_ACCESS_KEY!: string;

  // Optional on purpose - fine to leave unset in local dev (see
  // sentry.ts's initSentry(), which no-ops without a dsn).
  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  // Optional on purpose, same as SENTRY_DSN above - the rest of the app
  // has to keep working for everyone who hasn't set up a Google Cloud
  // OAuth client yet. Missing config only becomes a real (503) error at
  // the point someone actually tries to connect a YouTube account - see
  // social/youtube-oauth.client.ts's requireOAuth2Client().
  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_SECRET?: string;

  // Optional on purpose, same reasoning - unlike the two above, there's no
  // safe default at all (it's an encryption key), so a missing value fails
  // loudly at the point a token is actually encrypted/decrypted rather
  // than silently falling back to a hardcoded key - see
  // social/token-encryption.util.ts's getKey().
  @IsOptional()
  @IsString()
  TOKEN_ENCRYPTION_KEY?: string;

  // Optional on purpose, same posture as the OAuth vars above - see
  // MailService.sendPasswordResetEmail(), which logs the reset link
  // instead of sending when SMTP_HOST is unset rather than failing boot.
  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsString()
  SMTP_PORT?: string;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM?: string;

  // Optional on purpose, same posture as the OAuth vars above - the rest of
  // the app (including the free Groq transcription path) has to keep
  // working for everyone who hasn't set up a Midtrans account yet. Missing
  // config only becomes a real (503) error at the point someone actually
  // tries to check out premium (OpenAI Whisper) transcription - see
  // payments/payments.service.ts's requireSnapClient().
  @IsOptional()
  @IsString()
  MIDTRANS_SERVER_KEY?: string;

  @IsOptional()
  @IsString()
  MIDTRANS_CLIENT_KEY?: string;

  // 'true' selects Midtrans's production API host instead of sandbox - read
  // as a plain string (not boolean) like every other env var here, parsed
  // where it's used (see payments.service.ts). Absent/anything else
  // defaults to sandbox, the safer default.
  @IsOptional()
  @IsString()
  MIDTRANS_IS_PRODUCTION?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const missing = errors.map((error) => error.property).join(', ');
    throw new Error(
      `Missing or invalid required environment variable(s): ${missing}. Check .env against .env.example.`,
    );
  }

  return validated;
}
