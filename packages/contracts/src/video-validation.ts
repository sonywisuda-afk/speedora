import { z } from 'zod';

// Quality Validation roadmap (Fase 0 design, Phase 2) - the subset of
// probe-video.worker.ts's full ffprobe read that evaluateVideoQuality()
// actually reads. Deliberately narrower than @speedora/shared's full Video
// shape (which also carries codec/audioBitrate/etc. no current rule needs)
// - same "module's own input contract only demands what it uses" reasoning
// as clip-scoring's own segment schema.
export const videoQualityMetadataSchema = z.object({
  width: z.number().nullable(),
  height: z.number().nullable(),
  fps: z.number().nullable(),
  videoBitrate: z.number().nullable(),
  audioChannels: z.number().nullable(),
  durationSeconds: z.number().nullable(),
});

export type VideoQualityMetadata = z.infer<typeof videoQualityMetadataSchema>;

export const validationFindingSchema = z.object({
  // Stable id (kebab-case, e.g. 'low-resolution') - a future dashboard
  // groups/filters by this, not by parsing the human-readable message.
  id: z.string(),
  message: z.string(),
});

export type ValidationFinding = z.infer<typeof validationFindingSchema>;

// errors is always [] from evaluateVideoQuality() today - every Error-tier
// condition (no video/audio stream, corrupted file, zero duration) is
// caught by probe-video.worker.ts's own hard-fail checks BEFORE this module
// ever runs (a video with one of those never reaches PENDING_SETTINGS to
// have a report evaluated at all). Kept in the shape anyway so a future
// Error-tier rule genuinely evaluated post-probe (not yet needed) doesn't
// require a contract change. info is always [] in Phase 2 - the Fase 0
// design deliberately routes Info-tier (time/storage/AI-credit estimates)
// through the Pre-Processing Settings roadmap's own separate Phase 4
// estimate feature instead of duplicating it here.
export const validationReportSchema = z.object({
  errors: z.array(validationFindingSchema),
  warnings: z.array(validationFindingSchema),
  info: z.array(validationFindingSchema),
});

export type ValidationReport = z.infer<typeof validationReportSchema>;
