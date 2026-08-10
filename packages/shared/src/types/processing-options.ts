import { CaptionStyle, type ThumbnailSignal } from './video';
import type { FontFamily } from './brand-kit';
import type { SocialPlatform } from './social';

// Pre-Processing Settings roadmap - the settings screen shown between
// file/URL selection and the actual upload/import call (see
// apps/web/components/processing-settings/). Every field here has a real
// effect somewhere in the pipeline (see packages/clip-scoring's
// scoreClipCandidates, apps/worker's detect-clips/render-clip workers,
// packages/reframe's buildCropPath, and ffmpeg.ts's renderClip) -
// deliberately narrower than the full spec this roadmap started from, which
// also described several sections with no backend behind them yet (audio
// processing filters, video enhancement, alternate OCR/Face/Object/Fusion
// model selection, live GPU/cloud cost estimation). Those are surfaced in
// the UI as a "Coming Soon" card, not modeled here, so this type never
// grows a field with no wired effect.
//
// Versioned (Phase 2, user-requested) - `version` plus one nested group per
// settings-screen section, so a future phase (brandKit/thumbnail/seo/
// publishing/preflight are all still on the roadmap) can add a new group or
// change an existing one without any reader having to guess an unversioned
// shape's history. See migrateProcessingOptions() below for the read-side
// contract: every read of a DB-stored value goes through it rather than a
// bare cast, the same way every other JSON-blob field in this codebase gets
// narrowed at its read boundary (see docs/prisma.md).
export const PROCESSING_OPTIONS_VERSION = 1 as const;

// Group ownership index (user-requested, Phase 2) - each group has exactly
// one module that's authoritative for interpreting it: that module reads
// the group directly off Video.processingOptions/ProcessingPreset.config
// (via migrateProcessingOptions()) and is the only place its fields'
// meaning is defined. Every other module treats the group as opaque
// pass-through data. This is what keeps a future group addition (Phase 3's
// brandKit/thumbnail/seo/publishing) from turning into cross-module
// coupling - a new group gets a new owner, not a new reason for an existing
// owner to change.
//
//   project         -> apps/web (display metadata only, no backend owner)
//   clipGeneration  -> packages/clip-scoring (score-clip-candidates.ts)
//   subtitle        -> apps/worker/detect-clips.worker.ts
//   export          -> apps/worker/render-clip.worker.ts + ffmpeg.ts (the renderer)
//   sceneAnalysis   -> apps/worker/render-graph (nodes/scene.ts)
//   highlightFocus  -> packages/clip-scoring (score-clip-candidates.ts)
//   smartCrop       -> packages/reframe (crop-path.ts)
//   brandKit        -> apps/api/brand-kit (BrandKitTemplate + templateToBrandKitFields())
//   seo             -> apps/api/clips (ClipsService.generatePlatformCopy() + ClipPlatformCopy)
//   publishing      -> apps/api/clips (ClipsService.publish() + PublishRecord)
//   thumbnail       -> apps/worker/render-graph (nodes/thumbnail-selection.ts)
//
// Read vs. write rule (user-requested, to prevent ownership drift as more
// contributors touch this type): any module may READ any group off an
// already-resolved ProcessingOptions - e.g. the renderer reading `export`,
// clip-scoring reading `highlightFocus`, apps/api reading `project` for
// display, are all fine, and expected. Only a group's listed owner may
// change that group's SEMANTICS - add/rename/remove a field, change what a
// value means, change its validation. A non-owner needing a new field on
// someone else's group is a sign the group boundary is wrong, not a reason
// to patch around it - raise it with that group's owner instead.
//
// Every group the original 24-section spec's "surface an existing
// capability" items needed now has an owner above - Quality Validation is
// Phase 3's one remaining item, deliberately last since it needs a real
// upload-flow/probe change, not just another group here.
export interface ProcessingOptions {
  version: 1;
  // Owner: apps/web. Section 1 (Project Information) - display metadata
  // only, no pipeline effect. Free-form (not a Project/Folder/Campaign FK)
  // for this first phase - see the roadmap's Phase 3 for wiring this into
  // the real Project/Folder/Campaign pickers.
  project: {
    name: string | null;
    tags: string[];
  };
  // Owner: packages/clip-scoring. Section 6 (Clip Generation) - overrides
  // @speedora/clip-scoring's own MAX_CANDIDATES/MIN_CLIP_SECONDS/
  // MAX_CLIP_SECONDS constants when set; 'unlimited' maps to a high (not
  // literally infinite) cap. Fields left null fall back to the module's
  // own defaults.
  clipGeneration: {
    clipCount: number | 'unlimited' | null;
    minClipDurationSeconds: number | null;
    maxClipDurationSeconds: number | null;
  };
  // Owner: apps/worker/detect-clips.worker.ts. Section 9 (Subtitle) -
  // applied as the default on every clip this video produces (that
  // worker's initial auto-render), same 3 fields a SubtitlePreset already
  // bulk-sets. Deliberately no "disable captions" toggle - CaptionStyle has
  // no "none" value and no per-clip flag skips caption burn-in anywhere in
  // the pipeline today, so a switch like that would be decorative.
  subtitle: {
    captionStyle: CaptionStyle;
    speakerColorCaptions: boolean;
    fontFamily: FontFamily | null;
  };
  // Owner: apps/worker/render-clip.worker.ts + ffmpeg.ts (the renderer).
  // Section 14 (Export Settings) - maps to real ffmpeg -crf/-preset values
  // (see ffmpeg.ts's renderClip). null means the pipeline's existing
  // implicit ffmpeg defaults (unchanged from before this option existed).
  //
  // aspectRatio/resolutionTier (Output Resolution/Quality audit, Phase 1 - foundation) - null on
  // BOTH means the pipeline's exact pre-Phase-1 behavior (always a 9:16 crop, uncapped
  // resolution) - this is a backend-only foundation phase, not yet exposed in
  // ProcessingSettings.tsx (see the audit doc's own phasing), so every existing/default video
  // keeps rendering byte-for-byte identically. 'auto' is a real, distinct choice from null for
  // both fields (not a synonym) - see render-clip.worker.ts's resolveTargetAspectRatio()/
  // resolveResolutionTier() for what each one actually resolves to.
  export: {
    qualityPreset: 'maximum_quality' | 'balanced' | 'small_size' | null;
    // '9:16'/'16:9'/'1:1'/'4:5'/'4:3' pin the crop to that ratio outright; 'auto' picks one from
    // the source's own orientation (see resolveTargetAspectRatio()) - deliberately only ever
    // resolves to 9:16/16:9/1:1, never 4:5/4:3 (Output Resolution/Quality audit, Phase 4 - '4:5'/
    // '4:3' are explicit-only choices, not part of the orientation heuristic's 3-way vocabulary);
    // null keeps the fixed 9:16 every clip has always rendered at.
    aspectRatio: 'auto' | '9:16' | '16:9' | '1:1' | '4:5' | '4:3' | null;
    // '1080p'/'720p' cap the rendered output's short side (see @speedora/reframe's
    // resolveOutputResolution()); 'auto' applies the '1080p' cap (a sane ceiling that never
    // upscales past the source, satisfying the audit's "1080p should be the default
    // high-quality output, but never fake it from a smaller source" rule); null keeps today's
    // uncapped behavior (output resolution follows the source with no ceiling at all).
    resolutionTier: 'auto' | '1080p' | '720p' | null;
  };
  // Owner: apps/worker/render-graph (nodes/scene.ts). Section 11 (Scene
  // Analysis), Phase 2 - each flag gates whether the matching render-graph
  // node does its real detection work at all rather than just labelling
  // already-computed data differently. True (run it) by default for all
  // three, matching every pre-Phase-2 render exactly.
  sceneAnalysis: {
    detectSceneCuts: boolean;
    detectMotionEnergy: boolean;
    detectCameraMotion: boolean;
  };
  // Owner: packages/clip-scoring. Section 7 (Highlight Detection), Phase 2
  // - `intents` is a preferred subset of @speedora/clip-scoring's own
  // CLIP_INTENTS (kept as a plain string[] here, not a strict enum import,
  // to avoid packages/shared depending on packages/contracts - see this
  // codebase's existing "mirror the shape, don't import it" convention for
  // every other contracts-shaped field in this file); empty means no
  // preference. `confidenceThreshold` (0-100) is a real pre-cap minimum on
  // the LLM's own viralityScore, not a fabricated new signal.
  highlightFocus: {
    intents: string[];
    confidenceThreshold: number | null;
  };
  // Owner: packages/reframe (crop-path.ts). Section 10 (Smart Crop), Phase
  // 2 - `zoomInFraction` overrides packages/reframe's own
  // MAX_ZOOM_IN_FRACTION constant (0-0.6, null uses the pipeline's default
  // 0.3). Deliberately no crop STRATEGY picker (Face Priority/Speaker
  // Priority/Center/Manual) - only one crop algorithm exists in this
  // codebase (see the roadmap plan's own assessment), so a strategy
  // dropdown would be decorative.
  smartCrop: {
    zoomInFraction: number | null;
  };
  // Owner: apps/api/brand-kit. Section 17 (Brand Assets), Phase 3 -
  // `applyBrandKit` maps onto every new Clip.applyBrandKit this video
  // produces (previously always the schema default `true` - this is the
  // first way to opt a whole video's clips out up front, rather than a
  // manual per-clip PATCH after the fact). `templateId` names an existing
  // BrandKitTemplate whose fields should be used as this video's EFFECTIVE
  // Brand Kit instead of the live User/Workspace one - a real alternative
  // to "apply" (the existing endpoint), not a duplicate of it: choosing a
  // template here never mutates anyone's live Brand Kit, it only affects
  // this video's own clips. null means "use the live Brand Kit," today's
  // unchanged behavior. A stale/deleted/not-owned templateId at render time
  // falls back to the live Brand Kit rather than failing the job - see
  // detect-clips.worker.ts, same "optional signal, never fail the render"
  // posture watermark/intro/outro downloads already have.
  brandKit: {
    applyBrandKit: boolean;
    templateId: string | null;
  };
  // Owner: apps/api/clips. Section 16 (SEO Generation), Phase 3 - reuses
  // the existing per-clip, per-platform title/description/hashtag
  // generator (Publishing Expansion Phase 7B, `ClipsService
  // .generatePlatformCopy()` / `ClipPlatformCopy`) rather than building a
  // new generator - no new "Pinned Comment"/separate-CTA fields here since
  // ClipPlatformCopy itself has no such fields to generate into. When
  // `autoGeneratePlatformCopy` is true, render-clip.worker.ts triggers that
  // same generation automatically for each platform in `platforms` right
  // after a clip finishes rendering, instead of requiring a manual
  // POST /clips/:id/platform-copy per platform afterward - same rate-limit/
  // hookText guards as the manual endpoint, best-effort (never fails the
  // render). False/empty by default - this spends a real LLM call per
  // platform per clip, so it's opt-in, not automatic.
  seo: {
    autoGeneratePlatformCopy: boolean;
    platforms: SocialPlatform[];
  };
  // Owner: apps/api/clips. Section 18 (Publishing), Phase 3 - a pure
  // orchestration declaration, not a new publish implementation: every
  // field here maps directly onto ClipsService.publish()'s own
  // PublishClipDto (socialAccountId, scheduledAt), just pluralized since
  // this applies to every clip a whole video produces rather than one
  // clip at a time. When `autoPublish` is true, render-clip.worker.ts's
  // triggerAutoPublish() creates one PublishRecord per clip per account
  // (same shape ClipsService.publish() creates) and either enqueues it on
  // the existing PUBLISH_CLIP queue with the existing PUBLISH_RETRY_OPTIONS
  // (immediate) or leaves it SCHEDULED for the existing schedule-publish-clip
  // poller to pick up (future scheduledAt) - no new retry/scheduling/
  // platform-API logic anywhere in this path. `scheduledAt` already in the
  // past by the time a (possibly long) render finishes falls back to
  // publishing immediately rather than silently dropping it. No
  // campaignId/recurringScheduleId here - deliberately the smaller,
  // declarative slice of PublishClipDto for this first pass. False/empty by
  // default - this posts to a real connected social account, so it's
  // opt-in, not automatic.
  publishing: {
    autoPublish: boolean;
    socialAccountIds: string[];
    scheduledAt: string | null;
  };
  // Owner: apps/worker/render-graph (nodes/thumbnail-selection.ts). Section
  // 15 (Thumbnail Generation), Phase 3 - a pure preference declaration, not
  // a new selector: `preferredSignals` is a subset of the SAME
  // THUMBNAIL_SIGNALS vocabulary @speedora/thumbnail-selection's own
  // `selectThumbnailTimestamp(input, weights?)` already accepts as its
  // (already-existing, already-optional) `weights` override - the render
  // graph's thumbnailSelectionNode just never passed one before this. Each
  // preferred signal's DEFAULT_THUMBNAIL_WEIGHTS entry is boosted (not
  // replaced) rather than the other signals being zeroed out, so a
  // preference shifts which instant wins without disabling every other
  // signal's contribution. Empty (the default) passes no override at all -
  // identical behavior to every pre-Phase-3 render. No Level 1 (which CLIP
  // becomes the video's cover) control here - that stays
  // highlightScore/highlightRank-driven, per the thumbnail-selection
  // module's own documented Level 1/Level 2 policy boundary, which this
  // roadmap does not touch.
  thumbnail: {
    preferredSignals: ThumbnailSignal[];
  };
  // Owner: apps/worker/broll.ts (AI B-roll Recommendation) - NOT part of
  // the original 24-section spec every other group above traces back to;
  // this is item 8 of a separate, later gap-analysis list against
  // reference platforms (see docs/ai/broll-recommendation.md). `enabled`
  // (true by default, matching every pre-existing render - B-roll has
  // always run unconditionally until this control existed) skips
  // findBRollMoments()/buildBRollOverlays() entirely rather than running
  // the search and discarding results. `maxCutaways` overrides
  // broll.ts's own MAX_BROLL_MOMENTS constant (2) when set; null keeps
  // that default - same "null means pipeline default" convention as
  // clipGeneration.clipCount/smartCrop.zoomInFraction.
  broll: {
    enabled: boolean;
    maxCutaways: number | null;
  };
}

export const DEFAULT_PROCESSING_OPTIONS: ProcessingOptions = {
  version: PROCESSING_OPTIONS_VERSION,
  project: { name: null, tags: [] },
  clipGeneration: {
    clipCount: null,
    minClipDurationSeconds: null,
    maxClipDurationSeconds: null,
  },
  subtitle: {
    captionStyle: CaptionStyle.DEFAULT,
    speakerColorCaptions: false,
    fontFamily: null,
  },
  export: { qualityPreset: null, aspectRatio: null, resolutionTier: null },
  sceneAnalysis: {
    detectSceneCuts: true,
    detectMotionEnergy: true,
    detectCameraMotion: true,
  },
  highlightFocus: { intents: [], confidenceThreshold: null },
  smartCrop: { zoomInFraction: null },
  brandKit: { applyBrandKit: true, templateId: null },
  seo: { autoGeneratePlatformCopy: false, platforms: [] },
  publishing: { autoPublish: false, socialAccountIds: [], scheduledAt: null },
  thumbnail: { preferredSignals: [] },
  broll: { enabled: true, maxCutaways: null },
};

// Every DB-stored ProcessingOptions value (Video.processingOptions,
// ProcessingPreset.config) reads through this instead of a bare cast - the
// "small investment" the versioning above exists to pay for. `raw` is
// `unknown` because it always arrives as Prisma's opaque JsonValue.
//
// Today there is exactly one real version (1), and pre-Phase-2's brief
// unversioned/flat shape never reached a real user (this roadmap shipped
// and was restructured within the same working session, before any
// production row existed) - so the only defined migration is "no
// recognized version -> fall back to defaults" rather than a lossy
// field-by-field remap of that flat shape. A future version bump adds a
// real `if (version === N) return migrateVNToLatest(raw)` step here,
// without any caller needing to change.
//
// Merges per-group even once the version matches, rather than trusting the
// raw object's shape wholesale - a partial/malformed stored value (a group
// a future migration step forgot to backfill, a manually-edited DB row)
// gets every missing field filled from the default instead of leaving a
// caller's `processingOptions.someGroup.someField` read to throw on
// `undefined`. One group added at a future version bump is one more line
// here, not a new failure mode for every existing reader.
export function migrateProcessingOptions(raw: unknown): ProcessingOptions {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_PROCESSING_OPTIONS;
  }
  const version = (raw as { version?: unknown }).version;
  if (version !== PROCESSING_OPTIONS_VERSION) {
    return DEFAULT_PROCESSING_OPTIONS;
  }
  const value = raw as Partial<ProcessingOptions>;
  return {
    version: PROCESSING_OPTIONS_VERSION,
    project: { ...DEFAULT_PROCESSING_OPTIONS.project, ...value.project },
    clipGeneration: { ...DEFAULT_PROCESSING_OPTIONS.clipGeneration, ...value.clipGeneration },
    subtitle: { ...DEFAULT_PROCESSING_OPTIONS.subtitle, ...value.subtitle },
    export: { ...DEFAULT_PROCESSING_OPTIONS.export, ...value.export },
    sceneAnalysis: { ...DEFAULT_PROCESSING_OPTIONS.sceneAnalysis, ...value.sceneAnalysis },
    highlightFocus: { ...DEFAULT_PROCESSING_OPTIONS.highlightFocus, ...value.highlightFocus },
    smartCrop: { ...DEFAULT_PROCESSING_OPTIONS.smartCrop, ...value.smartCrop },
    brandKit: { ...DEFAULT_PROCESSING_OPTIONS.brandKit, ...value.brandKit },
    seo: { ...DEFAULT_PROCESSING_OPTIONS.seo, ...value.seo },
    publishing: { ...DEFAULT_PROCESSING_OPTIONS.publishing, ...value.publishing },
    thumbnail: { ...DEFAULT_PROCESSING_OPTIONS.thumbnail, ...value.thumbnail },
    broll: { ...DEFAULT_PROCESSING_OPTIONS.broll, ...value.broll },
  };
}

export interface ProcessingPresetDto {
  id: string;
  name: string;
  config: ProcessingOptions;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingPresetListDto {
  presets: ProcessingPresetDto[];
}

// Section 3 (Processing Preset) - a small, fixed, non-persisted set of
// system presets, same "curated constant, not user data" shape as
// BUILT_IN_SUBTITLE_PRESETS. 'AI Auto' is DEFAULT_PROCESSING_OPTIONS itself
// (every field left to the pipeline's own default/heuristic) rather than a
// fabricated "AI-recommended" value - there is no recommendation engine
// wired up yet (see the roadmap's Phase 4).
export interface BuiltInProcessingPreset {
  key: string;
  name: string;
  description: string;
  config: ProcessingOptions;
}

export const BUILT_IN_PROCESSING_PRESETS: BuiltInProcessingPreset[] = [
  {
    key: 'ultra_fast',
    name: 'Ultra Fast',
    description: 'Fewer, shorter clips and a smaller export - quickest to render.',
    config: {
      ...DEFAULT_PROCESSING_OPTIONS,
      clipGeneration: {
        ...DEFAULT_PROCESSING_OPTIONS.clipGeneration,
        clipCount: 1,
        maxClipDurationSeconds: 60,
      },
      export: { ...DEFAULT_PROCESSING_OPTIONS.export, qualityPreset: 'small_size' },
    },
  },
  {
    key: 'balanced',
    name: 'Balanced',
    description: "Speedora's normal defaults - a good fit for most videos.",
    config: { ...DEFAULT_PROCESSING_OPTIONS },
  },
  {
    key: 'professional',
    name: 'Professional',
    description: 'More candidate clips and a higher-quality export.',
    config: {
      ...DEFAULT_PROCESSING_OPTIONS,
      clipGeneration: { ...DEFAULT_PROCESSING_OPTIONS.clipGeneration, clipCount: 5 },
      export: { ...DEFAULT_PROCESSING_OPTIONS.export, qualityPreset: 'maximum_quality' },
    },
  },
  {
    key: 'studio_quality',
    name: 'Studio Quality',
    description: 'Maximum candidate clips and the highest-quality export.',
    config: {
      ...DEFAULT_PROCESSING_OPTIONS,
      clipGeneration: { ...DEFAULT_PROCESSING_OPTIONS.clipGeneration, clipCount: 'unlimited' },
      export: { ...DEFAULT_PROCESSING_OPTIONS.export, qualityPreset: 'maximum_quality' },
    },
  },
  {
    key: 'ai_auto',
    name: 'AI Auto',
    description: "Let Speedora's own pipeline defaults decide.",
    config: { ...DEFAULT_PROCESSING_OPTIONS },
  },
];
