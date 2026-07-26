import type { ImportFailureCategory } from '@speedora/contracts';

// Deliberate exception to this codebase's usual "many small named Error
// subclasses" convention (see apps/worker/src/jobTimeout.ts's
// JobTimeoutError, packages/social/src/errors.ts's OAuthNotConfiguredError):
// one concrete class carrying a `category` field instead, so retry-decisioning
// (isRetryableCategory) and metrics/health reporting can switch on one value
// rather than an instanceof chain. See ARCHITECTURE.md's worked-example entry
// for this module.
const RETRYABLE_CATEGORIES: ReadonlySet<ImportFailureCategory> = new Set([
  'network',
  'rate_limited',
  'timeout',
  'internal',
]);

export function isRetryableCategory(category: ImportFailureCategory): boolean {
  return RETRYABLE_CATEGORIES.has(category);
}

export interface VideoImportErrorOptions {
  category: ImportFailureCategory;
  engineName: string;
  // Defaults from isRetryableCategory(category) - only pass this explicitly
  // to override the category's usual retry behavior for a specific case.
  retryable?: boolean;
  exitCode?: number | null;
  stderrExcerpt?: string;
  cause?: unknown;
}

export class VideoImportError extends Error {
  readonly category: ImportFailureCategory;
  readonly engineName: string;
  readonly retryable: boolean;
  readonly exitCode?: number | null;
  readonly stderrExcerpt?: string;
  readonly cause?: unknown;
  // Set by retry.ts's withRetry right before a final (non-retried) throw -
  // how many retries had already happened before this failure. Left
  // undefined for an error that never passed through withRetry at all (e.g.
  // a pre-flight domain-validation error).
  retries?: number;

  constructor(message: string, options: VideoImportErrorOptions) {
    super(message);
    this.name = 'VideoImportError';
    this.category = options.category;
    this.engineName = options.engineName;
    this.retryable = options.retryable ?? isRetryableCategory(options.category);
    this.exitCode = options.exitCode;
    this.stderrExcerpt = options.stderrExcerpt;
    this.cause = options.cause;
  }
}
