// Render Fidelity & Composition Execution Engine - Path B (docs/ai/render-fidelity-local-
// equivalence-gate.md's own "next up" note; see docs/ai/render-fidelity-matrix.md for the full
// phase history). Exposes what Phases 3/7/8 built as proof-of-integration-only (computed and
// structured-logged on every render, never persisted) via Clip.renderPlan/renderManifest/
// renderVerification.
//
// DUPLICATED, NOT IMPORTED from @speedora/contracts - same "packages/shared never depends on
// another @speedora/* package" precedent HookPredictionOutput/SemanticEvent/NarrativeGraph etc.
// already established in this same directory (video.ts) - packages/shared has zero cross-package
// dependencies today (checked: its package.json has none), and this is not the file to be the
// first exception. The real contracts types (packages/contracts/src/render-plan.ts/
// render-manifest.ts/render-verification.ts/render-config.ts/output-profile.ts/reframe.ts) are
// the source of truth this was copied from - keep these in sync by hand if those schemas change,
// the same maintenance posture every other duplicated type in this directory already carries.

// --- EffectiveRenderConfig (Phase 1) - embedded verbatim inside RenderPlan below ---

export type ExportQualityPreset = 'maximum_quality' | 'balanced' | 'small_size';
export type ResolvedAspectRatioLabel = '9:16' | '16:9' | '1:1' | '4:5' | '4:3';
export type ResolvedResolutionTier = '1080p' | '720p';
export type RenderConfigCaptionStyle = 'DEFAULT' | 'KARAOKE' | 'BOLD_HIGHLIGHT';
export type RenderConfigWatermarkPosition =
  'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT' | 'CENTER';

export interface ResolvedQuality {
  preset: string;
  crf: number;
}

export interface RenderConfigWatermark {
  key: string;
  opacity: number;
  scale: number;
  margin: number;
  position: RenderConfigWatermarkPosition;
}

export interface RenderConfigBrandSegment {
  key: string;
  type: 'video' | 'image';
  imageDurationSeconds: number | null;
}

export interface EffectiveRenderConfig {
  version: 1;
  clipId: string;
  videoId: string;
  output: {
    qualityPreset: ExportQualityPreset | null;
    quality: ResolvedQuality | null;
    aspectRatio: ResolvedAspectRatioLabel;
    resolutionTier: ResolvedResolutionTier | null;
  };
  captions: {
    style: RenderConfigCaptionStyle;
    speakerColorCaptions: boolean;
    smartSegmentation: boolean;
    dynamicCaptions: boolean;
    captionLanguage: string | null;
    fontFamily: string | null;
  };
  visualEmphasis: {
    zoomInFraction: number | null;
    ocrHighlightEnabled: boolean;
    focusShiftEnabled: boolean;
    digitalPushEnabled: boolean;
    reactionHoldEnabled: boolean;
    pauseHoldEnabled: boolean;
    speakerAwareFocusShiftEnabled: boolean;
  };
  broll: {
    enabled: boolean;
    maxMoments: number | null;
  };
  branding: {
    watermark: RenderConfigWatermark | null;
    intro: RenderConfigBrandSegment | null;
    outro: RenderConfigBrandSegment | null;
  };
  sceneAnalysis: {
    detectSceneCuts: boolean;
    detectMotionEnergy: boolean;
    detectCameraMotion: boolean;
  };
}

// --- OutputProfile (Phase 2) - embedded verbatim inside RenderPlan/RenderManifest below ---

export type OutputResolutionPreset = '1080p' | '720p' | 'natural';

export interface OutputProfile {
  aspectRatio: ResolvedAspectRatioLabel;
  width: number;
  height: number;
  resolutionPreset: OutputResolutionPreset;
  fps: string | null;
  videoCodec: 'libx264';
  audioCodec: 'aac';
  pixelFormat: 'yuv420p';
  qualityPreset: ExportQualityPreset | null;
  qualityCrf: number | null;
  audioSampleRate: number;
  audioChannels: number;
}

// --- RenderPlan (Phase 3) ---

export interface CropWindow {
  t: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrHighlightBox {
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderPlanBrollOverlay {
  keyword: string;
  startTime: number;
  endTime: number;
}

export interface RenderPlan {
  version: 1;
  clipId: string;
  videoId: string;
  effectiveRenderConfig: EffectiveRenderConfig;
  outputProfile: OutputProfile;
  timeline: {
    requestedStartTime: number;
    requestedEndTime: number;
    requestedDurationSeconds: number;
    effectiveDurationSeconds: number;
  };
  holds: {
    reactionHoldInstants: number[];
    reactionHoldDurationSeconds: number;
  };
  framing: {
    // null means a static (non-time-varying) center crop was used for the whole clip.
    cropPath: CropWindow[] | null;
    reframeHints: OcrHighlightBox[];
  };
  overlays: {
    broll: RenderPlanBrollOverlay[];
    // Presence-only booleans - see packages/contracts/src/render-plan.ts's own field comment.
    watermark: boolean;
    intro: boolean;
    outro: boolean;
  };
  transitions: {
    crossfadeSeconds: number;
  };
}

// --- RenderManifest (Phase 7) ---

export interface RenderManifestExecution {
  passes: string[];
  trimApplied: boolean;
  reactionHoldCount: number;
  reactionHoldDurationSeconds: number;
  introApplied: boolean;
  outroApplied: boolean;
}

export interface RenderManifestFile {
  outputKey: string;
  sizeBytes: number;
  checksumMd5: string;
}

export interface RenderManifest {
  version: 1;
  clipId: string;
  videoId: string;
  execution: RenderManifestExecution;
  // What the delivered file SHOULD look like, given OutputProfile and the passes that actually
  // ran - a declaration, not (on its own) a verified fact. See RenderVerificationResult below for
  // the reconciliation against a real ffprobe of the actual file.
  expectedOutput: OutputProfile;
  file: RenderManifestFile;
}

// --- RenderVerificationResult (Phase 8) ---

export interface RenderVerificationField {
  expected: string | number | null;
  actual: string | number | null;
  matches: boolean;
}

export interface RenderVerificationResult {
  version: 1;
  clipId: string;
  videoId: string;
  fields: {
    width: RenderVerificationField;
    height: RenderVerificationField;
    fps: RenderVerificationField;
    videoCodec: RenderVerificationField;
    audioCodec: RenderVerificationField;
    audioChannels: RenderVerificationField;
    audioSampleRate: RenderVerificationField;
  };
  // true only when every field above matches. pixelFormat and duration are deliberately excluded
  // from this whole shape - see packages/contracts/src/render-verification.ts's own module
  // comment for why (also documented: docs/ai/render-fidelity-local-equivalence-gate.md's own
  // fps-drift finding shows `passed: false` can be a real, accepted verification OUTCOME, not an
  // error - see that doc for the difference between this field being null vs. containing a
  // present-but-failed result).
  passed: boolean;
}

// --- The DTO itself ---

// Read-only, per-clip view of what a render actually decided/did/verified - a factual/
// deterministic record, not an AI prediction, so (unlike ClipIntelligenceDto's fields) none of
// these three are gated by a feature flag; the same posture Clip.renderedDurationSeconds already
// has.
export interface ClipRenderFidelityDto {
  clipId: string;
  // Null when this Clip row predates the migration that added Clip.renderPlan, or when the clip
  // never successfully rendered (outputUrl also null in both cases) - buildRenderPlan() is pure
  // and always succeeds once execution reaches the point it's built, no separate failure mode of
  // its own.
  renderPlan: RenderPlan | null;
  // Same null-semantics as renderPlan above - buildRenderManifest() is equally pure/always-
  // succeeds once reached.
  renderManifest: RenderManifest | null;
  // Additionally null when the post-render ffprobe probe itself failed, or
  // compareRenderManifestToProbe() itself threw - both best-effort, non-fatal to the render/
  // upload (see ProbedVideoMetadata's own null-on-probe-failure convention). A present object
  // whose own `passed` is false is a real verification outcome, not the same as this field being
  // null - see RenderVerificationResult's own field comment above.
  renderVerification: RenderVerificationResult | null;
}
