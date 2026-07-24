import * as path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../../../../.env'), quiet: true });

// The real work lives in run.ts and is imported dynamically, only after the
// config() call above has actually run. A plain top-level `import` of run.ts
// here would get hoisted ahead of config() by esbuild/tsx's CJS transform
// (ES `import` declarations hoist even under CJS output - only genuine
// `require()`/dynamic `import()` calls execute in real textual order). This
// is exactly the ordering that used to silently break
// apps/worker/src/redis.ts's `process.env.REDIS_URL` read (it connected to
// the wrong local Redis - the default-fallback port, which happens to be a
// different project's container requiring auth - instead of this repo's own
// dev redis, and hung retrying forever with no visible error) - redis.ts now
// reads REDIS_URL lazily inside createRedisConnection() instead of at module
// scope, so it's no longer order-sensitive (see its own comment). This
// dynamic-import split stays regardless, as defense-in-depth for any other
// transitively-imported module that still reads an env var eagerly at module
// scope (e.g. apps/worker/src/prisma.ts's `export const prisma =
// createPrismaClient()` call). Keep this file free of any other import.
async function bootstrap(): Promise<void> {
  const { main } = await import('./run');
  await main();
}

bootstrap();
