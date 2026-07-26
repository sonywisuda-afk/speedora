import * as os from 'node:os';
import * as path from 'node:path';
import type { VideoImportEngineConfig } from './types';

const DEFAULT_ALLOWED_DOMAINS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalIntEnv(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Requires an explicit `env` argument (never reads process.env on its own),
// so a package-level caller can't accidentally read env before dotenv has
// loaded - same dotenv-load-order rule packages/storage's getClient()/
// bucket() and apps/worker's redis.ts follow. The adapter (import-youtube
// .worker.ts) always calls this with process.env directly.
export function loadVideoImportEngineConfig(env: NodeJS.ProcessEnv): VideoImportEngineConfig {
  const maxRetries = parseIntEnv(env.VIDEO_IMPORT_MAX_RETRIES, 2);

  return {
    binaryPath: env.YTDLP_PATH ?? 'yt-dlp',
    ffmpegPath: env.FFMPEG_PATH ?? null,
    // Matches the old youtube.ts's YTDLP_TIMEOUT_MS default (60 minutes) -
    // generous for a large source on a slow connection, still bounding the
    // worst case.
    timeoutMs: parseIntEnv(env.VIDEO_IMPORT_TIMEOUT_MS, 60 * 60 * 1000),
    retryPolicy: {
      // maxAttempts counts the first try too, so "2 retries" (the default)
      // means up to 3 attempts total.
      maxAttempts: maxRetries + 1,
      baseDelayMs: parseIntEnv(env.VIDEO_IMPORT_BACKOFF_BASE_MS, 2000),
      factor: parseIntEnv(env.VIDEO_IMPORT_BACKOFF_FACTOR, 2),
      maxDelayMs: parseIntEnv(env.VIDEO_IMPORT_BACKOFF_MAX_MS, 30 * 1000),
    },
    cookiesFile: env.YTDLP_COOKIES_FILE ?? null,
    proxyUrl: env.YTDLP_PROXY_URL ?? null,
    // Whitespace-split only - no support for an argument containing a space
    // (e.g. can't pass '--extractor-args' 'youtube:foo=bar baz' this way).
    // Same "honest simplicity" tradeoff as the rest of this codebase's
    // env-driven config; documented in .env.example.
    extraArgs: env.YTDLP_EXTRA_ARGS ? env.YTDLP_EXTRA_ARGS.split(/\s+/).filter(Boolean) : [],
    allowedDomains: env.YTDLP_ALLOWED_DOMAINS
      ? env.YTDLP_ALLOWED_DOMAINS.split(',')
          .map((domain) => domain.trim())
          .filter(Boolean)
      : DEFAULT_ALLOWED_DOMAINS,
    scratchDir: env.VIDEO_IMPORT_SCRATCH_DIR ?? path.join(os.tmpdir(), 'speedora', 'video-import'),
    minVersion: env.YTDLP_MIN_VERSION ?? null,
    maxFileSizeBytes: parseOptionalIntEnv(env.VIDEO_IMPORT_MAX_FILE_SIZE_BYTES),
    killGraceMs: parseIntEnv(env.VIDEO_IMPORT_KILL_GRACE_MS, 5000),
  };
}
