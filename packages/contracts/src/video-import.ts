import { z } from 'zod';

// Categorizes every way a VideoImportEngine download can fail - drives both
// retry-decisioning (packages/video-import-engine's VideoImportError.retryable)
// and the videoImport metrics/health surface (GET /metrics, see
// packages/shared's video-import-metrics.ts). Kept narrow and code-shaped
// (not a free-text string) so a dashboard/alert can group on it reliably.
export const importFailureCategorySchema = z.enum([
  'network',
  'extractor',
  'unavailable',
  'private',
  'age_restricted',
  'rate_limited',
  'unsupported',
  'timeout',
  'cancelled',
  'storage',
  'internal',
  // Download Reliability Framework additions - all four default non-retryable
  // (see packages/video-import-engine/src/errors.ts's RETRYABLE_CATEGORIES),
  // since each represents either an operator-fixable environment problem
  // (disk/permission) or a site/URL-level condition a retry can't change
  // (geo_restricted/authentication/invalid_url).
  'disk',
  'permission',
  'geo_restricted',
  'authentication',
  'invalid_url',
]);

export type ImportFailureCategory = z.infer<typeof importFailureCategorySchema>;

export const videoImportInputSchema = z.object({
  url: z.string().url(),
});

export type VideoImportInput = z.infer<typeof videoImportInputSchema>;

// Matches getYoutubeVideoTitle's exact current behavior (apps/worker's old
// youtube.ts) - a null title is a legitimate, expected outcome (missing
// binary, private/deleted video), not an error.
export const videoImportMetadataSchema = z.object({
  title: z.string().nullable(),
});

export type VideoImportMetadata = z.infer<typeof videoImportMetadataSchema>;

export const videoImportResultSchema = z.object({
  outputPath: z.string(),
  metadata: videoImportMetadataSchema,
  durationMs: z.number(),
  retries: z.number(),
  engineName: z.string(),
  engineVersion: z.string().nullable(),
});

export type VideoImportResult = z.infer<typeof videoImportResultSchema>;
