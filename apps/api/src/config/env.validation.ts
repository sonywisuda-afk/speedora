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
