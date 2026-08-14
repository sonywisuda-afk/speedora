import {
  effectiveRenderConfigSchema,
  type BuildEffectiveRenderConfigInput,
  type EffectiveRenderConfig,
  type ExportQualityPreset,
  type ResolvedAspectRatioLabel,
  type ResolvedQuality,
  type ResolvedResolutionTier,
} from '@speedora/contracts';

// Render Fidelity & Composition Execution Engine, Phase 1 - see render-config.ts's own module
// comment (packages/contracts) for the full scope-boundary reasoning. This file is a pure,
// synchronous port of the resolution logic apps/worker/src/workers/render-clip.worker.ts's own
// private resolveRenderQuality()/resolveTargetAspectRatio()/resolveResolutionTier()/
// resolveZoomInFraction()/resolveBRollOptions()/resolveSceneAnalysisFlags() helpers already
// implement - DELIBERATELY duplicated here, not imported from apps/worker (packages can never
// depend on an app - wrong dependency direction) and not yet used to REPLACE those helpers
// (that's a later, separate cutover phase, once this module's output is proven to agree with
// them - see render-clip.worker.ts's own CONFIG_RESOLVED logging for that proof). Every constant/
// threshold/default below is copied from that file's own values, not reinvented.

// Same values as render-clip.worker.ts's own EXPORT_QUALITY_PRESETS map.
const EXPORT_QUALITY_PRESETS: Record<ExportQualityPreset, ResolvedQuality> = {
  maximum_quality: { preset: 'slow', crf: 18 },
  balanced: { preset: 'fast', crf: 23 },
  small_size: { preset: 'veryfast', crf: 28 },
};

function resolveQuality(qualityPreset: ExportQualityPreset | null): ResolvedQuality | null {
  return qualityPreset ? EXPORT_QUALITY_PRESETS[qualityPreset] : null;
}

// Same 'auto' orientation heuristic/thresholds as render-clip.worker.ts's own
// AUTO_ASPECT_RATIO_LANDSCAPE_THRESHOLD/AUTO_ASPECT_RATIO_PORTRAIT_THRESHOLD.
const AUTO_ASPECT_RATIO_LANDSCAPE_THRESHOLD = 1.2;
const AUTO_ASPECT_RATIO_PORTRAIT_THRESHOLD = 1 / AUTO_ASPECT_RATIO_LANDSCAPE_THRESHOLD;

function resolveAspectRatioLabel(
  setting: 'auto' | '9:16' | '16:9' | '1:1' | '4:5' | '4:3' | null,
  sourceWidth: number,
  sourceHeight: number,
): ResolvedAspectRatioLabel {
  switch (setting) {
    case null:
    case '9:16':
      return '9:16';
    case '16:9':
      return '16:9';
    case '1:1':
      return '1:1';
    case '4:5':
      return '4:5';
    case '4:3':
      return '4:3';
    case 'auto': {
      const sourceAspect = sourceWidth / sourceHeight;
      if (sourceAspect >= AUTO_ASPECT_RATIO_LANDSCAPE_THRESHOLD) return '16:9';
      if (sourceAspect <= AUTO_ASPECT_RATIO_PORTRAIT_THRESHOLD) return '9:16';
      return '1:1';
    }
  }
}

function resolveResolutionTier(
  setting: 'auto' | '1080p' | '720p' | null,
): ResolvedResolutionTier | null {
  switch (setting) {
    case null:
      return null;
    case 'auto':
      return '1080p';
    case '1080p':
    case '720p':
      return setting;
  }
}

// The module's single entry point (ARCHITECTURE.md's JSON-contract module checklist) - pure and
// synchronous, no `deps` parameter at all (same shape as @speedora/emoji-suggester/@speedora/
// cutlist - no external call or deployment-specific value to inject).
export function buildEffectiveRenderConfig(
  input: BuildEffectiveRenderConfigInput,
): EffectiveRenderConfig {
  const {
    clipId,
    videoId,
    sourceWidth,
    sourceHeight,
    processingOptions,
    clipOverrides,
    featureFlags,
  } = input;

  const qualityPreset = processingOptions?.export.qualityPreset ?? null;
  const aspectRatio = resolveAspectRatioLabel(
    processingOptions?.export.aspectRatio ?? null,
    sourceWidth,
    sourceHeight,
  );
  const resolutionTier = resolveResolutionTier(processingOptions?.export.resolutionTier ?? null);

  const config: EffectiveRenderConfig = {
    version: 1,
    clipId,
    videoId,
    output: {
      qualityPreset,
      quality: resolveQuality(qualityPreset),
      aspectRatio,
      resolutionTier,
    },
    captions: {
      style: clipOverrides.captionStyle,
      speakerColorCaptions: clipOverrides.speakerColorCaptions,
      smartSegmentation: clipOverrides.smartSegmentation,
      dynamicCaptions: clipOverrides.dynamicCaptions,
      captionLanguage: clipOverrides.captionLanguage,
      fontFamily: clipOverrides.fontFamily,
    },
    visualEmphasis: {
      zoomInFraction: processingOptions?.smartCrop.zoomInFraction ?? null,
      ocrHighlightEnabled: featureFlags.ocrHighlightEnabled,
      focusShiftEnabled: featureFlags.focusShiftEnabled,
      digitalPushEnabled: featureFlags.digitalPushEnabled,
      reactionHoldEnabled: featureFlags.reactionHoldEnabled,
      pauseHoldEnabled: featureFlags.pauseHoldEnabled,
      speakerAwareFocusShiftEnabled: featureFlags.speakerAwareFocusShiftEnabled,
    },
    broll: {
      enabled: processingOptions?.broll.enabled ?? true,
      maxMoments: processingOptions?.broll.maxCutaways ?? null,
    },
    branding: {
      watermark: clipOverrides.watermark,
      intro: clipOverrides.intro,
      outro: clipOverrides.outro,
    },
    sceneAnalysis: {
      detectSceneCuts: processingOptions?.sceneAnalysis.detectSceneCuts ?? true,
      detectMotionEnergy: processingOptions?.sceneAnalysis.detectMotionEnergy ?? true,
      detectCameraMotion: processingOptions?.sceneAnalysis.detectCameraMotion ?? true,
    },
  };

  // Defense in depth on top of TypeScript's own static check - the module's own contract
  // boundary, same "validate before returning" convention scoreClipCandidates()/every other
  // JSON-contract module already follows.
  return effectiveRenderConfigSchema.parse(config);
}
