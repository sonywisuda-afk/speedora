import { Redis } from 'ioredis';

// Stabilization Pass Area 3 tech-debt fix: process.env.REDIS_URL used to be
// read at module-load time, which was fine for main.ts (dotenv's config() is
// its very first line, and every worker/queue module is reached only via a
// dynamic import() after that - see main.ts's own comment) but silently
// broke any dotenv-based tsx/esbuild script where config() doesn't run
// before this module gets transitively imported: esbuild/tsx hoists ES
// `import` declarations ahead of same-file code even under CJS output, so a
// same-file config()-then-import ordering doesn't actually protect you (see
// cross-feature-e2e/index.ts's bootstrap() comment for the real incident -
// it silently connected to an unrelated project's Redis container instead of
// throwing). Reading it lazily, inside createRedisConnection() instead of at
// module scope, fixes this for any caller regardless of import order - by
// the time this function actually runs, config() has necessarily already had
// its chance to run.
export function createRedisConnection(): Redis {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}
