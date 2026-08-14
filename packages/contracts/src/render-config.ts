import { z } from 'zod';

// Render Fidelity & Composition Execution Engine, Phase 1 (EffectiveRenderConfig) - see
// docs/ai/render-fidelity-matrix.md for the Phase 0 audit this is built on top of. That audit's
// headline finding: no unified render-config object exists today - each setting group is
// resolved by its own independent resolveX() helper in render-clip.worker.ts, threaded as a
// loose parameter into whichever ffmpeg.ts call needs it. EffectiveRenderConfig is the ONE
// object those settings should eventually all flow through instead.
//
// SCOPE BOUNDARY (deliberate, not an oversight):
// - Only covers settings resolvable from {ProcessingOptions, per-clip overrides already carried
//   in RenderClipJobData, ops-level feature flags, source width/height} - no ffprobe subprocess
//   call, no DB access, no BullMQ, matching the JSON-contract module pattern (ARCHITECTURE.md).
//   sourceWidth/sourceHeight are accepted as plain numbers (not probed here) because
//   resolveTargetAspectRatio's 'auto' branch genuinely needs them - this is still "source media
//   characteristics" per the mission brief's own EffectiveRenderConfig formula, just handed in
//   as data rather than fetched.
// - Concrete OUTPUT PIXEL width/height (after crop + scale-up policy) is explicitly NOT here -
//   that needs computeCropDimensions()/resolveOutputResolution() from @speedora/reframe, which is
//   a bigger, more output-specific computation earmarked for its own OutputProfile module
//   (Phase 2). This object carries the RESOLVED SETTINGS (aspect ratio label, resolution tier,
//   quality preset) that Phase 2 will consume alongside real source dimensions.
// - Clip generation settings (clipCount, min/maxClipDurationSeconds) are explicitly OUT of scope
//   - those apply to the detect-clips stage, not render-clip, and the mission brief itself
//   describes them as belonging to a separate ClipGenerationConfig contract (Clip Count &
//   Duration Precision Engine, mission section 29), not this one.
// - Render-graph/AI-decision output (primarySubjectSamples, editingSuggestions, OCR highlight
//   boxes, hookPrediction, ...) is explicitly NOT here either - those don't exist until AFTER the
//   source is downloaded and the render graph runs, which is downstream of where this object gets
//   built. Preserving those decisions is RenderPlan's job (Phase 3), not this one's.
// - Narrowed input shapes for `processingOptions`/`clipOverrides` deliberately do NOT import
//   @speedora/shared's real ProcessingOptions/RenderClipJobData types (same "keep the input shape
//   as narrow as the module actually needs, don't reuse a full DB-shaped type" rule
//   ARCHITECTURE.md's checklist item 1 states, and the same string-literal-duplication precedent
//   its own "Subtitles" worked example already established for CaptionStyle) - the real
//   ProcessingOptions has clipGeneration/highlightFocus/subtitle/brandKit/thumbnail/seo/publishing
//   groups this module has no business reading at all.

export const exportQualityPresetSchema = z.enum(['maximum_quality', 'balanced', 'small_size']);
export type ExportQualityPreset = z.infer<typeof exportQualityPresetSchema>;

export const resolvedQualitySchema = z.object({
  preset: z.string(),
  crf: z.number(),
});
export type ResolvedQuality = z.infer<typeof resolvedQualitySchema>;

export const resolvedAspectRatioLabelSchema = z.enum(['9:16', '16:9', '1:1', '4:5', '4:3']);
export type ResolvedAspectRatioLabel = z.infer<typeof resolvedAspectRatioLabelSchema>;

export const resolvedResolutionTierSchema = z.enum(['1080p', '720p']);
export type ResolvedResolutionTier = z.infer<typeof resolvedResolutionTierSchema>;

export const renderConfigCaptionStyleSchema = z.enum(['DEFAULT', 'KARAOKE', 'BOLD_HIGHLIGHT']);
export type RenderConfigCaptionStyle = z.infer<typeof renderConfigCaptionStyleSchema>;

export const renderConfigWatermarkPositionSchema = z.enum([
  'TOP_LEFT',
  'TOP_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_RIGHT',
  'CENTER',
]);
export type RenderConfigWatermarkPosition = z.infer<typeof renderConfigWatermarkPositionSchema>;

export const renderConfigWatermarkSchema = z.object({
  key: z.string(),
  opacity: z.number(),
  scale: z.number(),
  margin: z.number(),
  position: renderConfigWatermarkPositionSchema,
});
export type RenderConfigWatermark = z.infer<typeof renderConfigWatermarkSchema>;

export const renderConfigBrandSegmentSchema = z.object({
  key: z.string(),
  type: z.enum(['video', 'image']),
  imageDurationSeconds: z.number().nullable(),
});
export type RenderConfigBrandSegment = z.infer<typeof renderConfigBrandSegmentSchema>;

// Narrowed mirror of ProcessingOptions' export/smartCrop/broll/sceneAnalysis groups only - see
// this file's own module comment for why clipGeneration/highlightFocus/subtitle/brandKit/
// thumbnail/seo/publishing are deliberately excluded. `null` (the whole object, not just a field)
// matches the real ProcessingOptions' own "may not exist at all for a video predating the
// settings feature" case - every existing resolveX() helper in render-clip.worker.ts already
// treats a null processingOptions as "every default applies", reproduced identically here.
export const renderConfigProcessingOptionsSchema = z.object({
  export: z.object({
    qualityPreset: exportQualityPresetSchema.nullable(),
    aspectRatio: z.enum(['auto', '9:16', '16:9', '1:1', '4:5', '4:3']).nullable(),
    resolutionTier: z.enum(['auto', '1080p', '720p']).nullable(),
  }),
  smartCrop: z.object({
    zoomInFraction: z.number().nullable(),
  }),
  broll: z.object({
    enabled: z.boolean(),
    maxCutaways: z.number().nullable(),
  }),
  sceneAnalysis: z.object({
    detectSceneCuts: z.boolean(),
    detectMotionEnergy: z.boolean(),
    detectCameraMotion: z.boolean(),
  }),
});
export type RenderConfigProcessingOptions = z.infer<typeof renderConfigProcessingOptionsSchema>;

// Mirrors the subset of RenderClipJobData that's a per-clip override rather than a video-level
// ProcessingOptions setting (captionStyle/speakerColorCaptions/smartSegmentation/dynamicCaptions/
// captionLanguage/fontFamily/watermark/intro/outro all already reach the render-clip queue
// payload directly today per docs/ai/render-fidelity-matrix.md's own audit - REACHES_QUEUE, not
// PERSISTED_NOT_QUEUED). Threading them through this schema too (rather than leaving them to be
// read ad hoc from job data downstream) is what makes EffectiveRenderConfig genuinely "the one
// object the renderer consumes" instead of a partial one that still needs supplementing.
export const renderConfigClipOverridesSchema = z.object({
  captionStyle: renderConfigCaptionStyleSchema,
  speakerColorCaptions: z.boolean(),
  smartSegmentation: z.boolean(),
  dynamicCaptions: z.boolean(),
  captionLanguage: z.string().nullable(),
  fontFamily: z.string().nullable(),
  watermark: renderConfigWatermarkSchema.nullable(),
  intro: renderConfigBrandSegmentSchema.nullable(),
  outro: renderConfigBrandSegmentSchema.nullable(),
});
export type RenderConfigClipOverrides = z.infer<typeof renderConfigClipOverridesSchema>;

// The 6 Visual Emphasis Engine ops-level env-var kill switches (VISUAL_EMPHASIS_*_ENABLED) -
// per the Phase 0 audit, these have "no per-clip toggle" by explicit design and are read
// directly by the worker via isXEnabled() functions today. Resolving them ONCE, here, into plain
// booleans is what satisfies the mission brief's "the renderer must NOT independently read...
// environment variables" requirement - every isXEnabled() call happens in the ADAPTER (once,
// when building this config), never inside a downstream ffmpeg-facing function.
export const renderConfigFeatureFlagsSchema = z.object({
  ocrHighlightEnabled: z.boolean(),
  focusShiftEnabled: z.boolean(),
  digitalPushEnabled: z.boolean(),
  reactionHoldEnabled: z.boolean(),
  pauseHoldEnabled: z.boolean(),
  speakerAwareFocusShiftEnabled: z.boolean(),
});
export type RenderConfigFeatureFlags = z.infer<typeof renderConfigFeatureFlagsSchema>;

export const buildEffectiveRenderConfigInputSchema = z.object({
  clipId: z.string(),
  videoId: z.string(),
  // Plain numbers, not probed by this module - see this file's own module comment.
  sourceWidth: z.number().positive(),
  sourceHeight: z.number().positive(),
  processingOptions: renderConfigProcessingOptionsSchema.nullable(),
  clipOverrides: renderConfigClipOverridesSchema,
  featureFlags: renderConfigFeatureFlagsSchema,
});
export type BuildEffectiveRenderConfigInput = z.infer<typeof buildEffectiveRenderConfigInputSchema>;

export const effectiveRenderConfigSchema = z.object({
  // Bumped only on a real breaking shape change - same convention as ProcessingOptions' own
  // `version` field (packages/shared) - so a future consumer can migrate a persisted/logged
  // config the same way migrateProcessingOptions() already does.
  version: z.literal(1),
  clipId: z.string(),
  videoId: z.string(),
  output: z.object({
    qualityPreset: exportQualityPresetSchema.nullable(),
    // The resolved {preset, crf} ffmpeg pair - null exactly when qualityPreset is null (no
    // setting configured), mirroring resolveRenderQuality()'s own null-means-ffmpeg-default
    // convention.
    quality: resolvedQualitySchema.nullable(),
    // Always resolved to a concrete label (never 'auto'/null) - same guarantee
    // resolveTargetAspectRatio() already provides today.
    aspectRatio: resolvedAspectRatioLabelSchema,
    // null means "no resolution-tier policy configured" (resolveResolutionTier()'s own
    // behavior) - NOT the same as a resolved '1080p'/'720p' tier.
    resolutionTier: resolvedResolutionTierSchema.nullable(),
  }),
  captions: z.object({
    style: renderConfigCaptionStyleSchema,
    speakerColorCaptions: z.boolean(),
    smartSegmentation: z.boolean(),
    dynamicCaptions: z.boolean(),
    captionLanguage: z.string().nullable(),
    fontFamily: z.string().nullable(),
  }),
  visualEmphasis: z.object({
    // null means "use @speedora/reframe's own MAX_ZOOM_IN_FRACTION constant" - same
    // resolveZoomInFraction() convention, preserved here as null rather than undefined since
    // this is a serializable config object, not a function parameter.
    zoomInFraction: z.number().nullable(),
    ocrHighlightEnabled: z.boolean(),
    focusShiftEnabled: z.boolean(),
    digitalPushEnabled: z.boolean(),
    reactionHoldEnabled: z.boolean(),
    pauseHoldEnabled: z.boolean(),
    speakerAwareFocusShiftEnabled: z.boolean(),
  }),
  broll: z.object({
    enabled: z.boolean(),
    // null means "use findBRollMoments()'s own MAX_BROLL_MOMENTS default" - same
    // resolveBRollOptions() undefined-as-omit convention, represented as null here for the same
    // serializability reason as zoomInFraction above.
    maxMoments: z.number().nullable(),
  }),
  branding: z.object({
    watermark: renderConfigWatermarkSchema.nullable(),
    intro: renderConfigBrandSegmentSchema.nullable(),
    outro: renderConfigBrandSegmentSchema.nullable(),
  }),
  sceneAnalysis: z.object({
    detectSceneCuts: z.boolean(),
    detectMotionEnergy: z.boolean(),
    detectCameraMotion: z.boolean(),
  }),
});
export type EffectiveRenderConfig = z.infer<typeof effectiveRenderConfigSchema>;
