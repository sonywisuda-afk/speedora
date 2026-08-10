import { CaptionStyle } from '@speedora/database';
import { FONT_FAMILIES } from '@speedora/contracts';
import {
  PROCESSING_OPTIONS_VERSION,
  SocialPlatform,
  THUMBNAIL_SIGNALS,
  type ProcessingOptions,
  type ThumbnailSignal,
} from '@speedora/shared';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { toSharedCaptionStyle } from '../../videos/transcript-segment.util';

const CLIP_COUNT_VALUES = [1, 2, 3, 5, 10, 20, 'unlimited'] as const;
const EXPORT_QUALITY_PRESETS = ['maximum_quality', 'balanced', 'small_size'] as const;
// Output Resolution/Quality audit, Phase 1 (foundation) - see @speedora/shared's
// ProcessingOptions.export.aspectRatio/resolutionTier comments for what each value means.
// '4:5'/'4:3' added Phase 4 (explicit-only pins, not part of 'auto's own heuristic).
const EXPORT_ASPECT_RATIOS = ['auto', '9:16', '16:9', '1:1', '4:5', '4:3'] as const;
const EXPORT_RESOLUTION_TIERS = ['auto', '1080p', '720p'] as const;
const MAX_ZOOM_IN_FRACTION_LIMIT = 0.6;
// A generous upper bound over broll.ts's own MAX_BROLL_MOMENTS default (2) - more than this
// starts to feel like a slideshow rather than a talking-head clip with the occasional B-roll
// accent (see broll.ts's own MAX_BROLL_MOMENTS comment), so the UI/API shouldn't allow it at all.
const MAX_BROLL_CUTAWAYS_LIMIT = 5;

class ProjectOptionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

class ClipGenerationOptionsDto {
  @IsOptional()
  @IsIn(CLIP_COUNT_VALUES)
  clipCount?: number | 'unlimited' | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  minClipDurationSeconds?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  maxClipDurationSeconds?: number | null;
}

class SubtitleOptionsDto {
  @IsEnum(CaptionStyle)
  captionStyle!: CaptionStyle;

  @IsBoolean()
  speakerColorCaptions!: boolean;

  @IsOptional()
  @IsIn(FONT_FAMILIES)
  fontFamily?: string | null;
}

class ExportOptionsDto {
  @IsOptional()
  @IsIn(EXPORT_QUALITY_PRESETS)
  qualityPreset?: (typeof EXPORT_QUALITY_PRESETS)[number] | null;

  // Output Resolution/Quality audit, Phase 1 (foundation) - accepted/validated here even though
  // ProcessingSettings.tsx has no UI for either field yet (this phase is backend-only, see the
  // audit doc's own phasing) - a preset/API caller can already set them, and the render pipeline
  // already honors them (see render-clip.worker.ts).
  @IsOptional()
  @IsIn(EXPORT_ASPECT_RATIOS)
  aspectRatio?: (typeof EXPORT_ASPECT_RATIOS)[number] | null;

  @IsOptional()
  @IsIn(EXPORT_RESOLUTION_TIERS)
  resolutionTier?: (typeof EXPORT_RESOLUTION_TIERS)[number] | null;
}

// Phase 2 - see @speedora/shared's ProcessingOptions.sceneAnalysis comment.
class SceneAnalysisOptionsDto {
  @IsBoolean()
  detectSceneCuts!: boolean;

  @IsBoolean()
  detectMotionEnergy!: boolean;

  @IsBoolean()
  detectCameraMotion!: boolean;
}

// Phase 2 - `intents` isn't validated against CLIP_INTENTS here on purpose:
// @speedora/contracts' CLIP_INTENTS is the module that owns that vocabulary,
// and this DTO layer deliberately doesn't take a dependency on it (same
// "don't import contracts into a DB-facing type" posture the shared type
// itself documents) - an unrecognized intent is simply never matched by
// score-clip-candidates.ts's preferredIntents bump, not a validation error.
class HighlightFocusOptionsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  intents?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  confidenceThreshold?: number | null;
}

class SmartCropOptionsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_ZOOM_IN_FRACTION_LIMIT)
  zoomInFraction?: number | null;
}

// Phase 3 - `templateId` isn't ownership-checked here on purpose: this DTO
// layer is pure shape validation (no DB access), same posture as every
// other field in this file. Ownership (does this template belong to the
// requester?) is checked where the template is actually resolved -
// detect-clips.worker.ts - falling back to the live Brand Kit rather than
// rejecting the upload, same "optional signal, never fail the job" posture
// watermark/intro/outro downloads already have (a stale id from a deleted
// template between settings-screen-load and job-run is the only realistic
// way this happens, since the settings screen only ever lists the
// requester's own templates).
class BrandKitOptionsDto {
  @IsOptional()
  @IsBoolean()
  applyBrandKit?: boolean;

  @IsOptional()
  @IsString()
  templateId?: string | null;
}

// Phase 3 - reuses the existing @speedora/shared SocialPlatform enum
// directly (unlike highlightFocus.intents, this vocabulary already belongs
// to packages/shared, not packages/contracts, so there's no cross-package
// duplication concern here). No new generator fields (title/pinned
// comment/separate CTA) - ClipPlatformCopy itself only has caption/
// hashtags/description, so this DTO doesn't invent fields the generator
// can't actually produce.
class SeoOptionsDto {
  @IsOptional()
  @IsBoolean()
  autoGeneratePlatformCopy?: boolean;

  @IsOptional()
  @IsArray()
  @IsEnum(SocialPlatform, { each: true })
  platforms?: SocialPlatform[];
}

// Phase 3 - a pure orchestration declaration: every field maps directly
// onto ClipsService.publish()'s own PublishClipDto (socialAccountId,
// scheduledAt), pluralized since this applies to a whole video's clips at
// once. `socialAccountIds` isn't ownership-checked here on purpose - same
// posture as brandKit.templateId above (this DTO layer is pure shape
// validation, no DB access); a foreign/deleted account id is skipped with a
// logged warning at the point it's actually used - render-clip.worker.ts's
// triggerAutoPublish(). No campaignId/recurringScheduleId - deliberately
// the smaller, declarative slice of PublishClipDto for this first pass.
class PublishingOptionsDto {
  @IsOptional()
  @IsBoolean()
  autoPublish?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  socialAccountIds?: string[];

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string | null;
}

// Phase 3 - a pure preference declaration, not a new selector:
// `preferredSignals` is validated against the SAME THUMBNAIL_SIGNALS
// vocabulary @speedora/thumbnail-selection already scores against. An
// invalid/unrecognized entry is rejected here at submission time (unlike
// highlightFocus.intents, whose vocabulary packages/shared deliberately
// doesn't import) - this DTO already had to import THUMBNAIL_SIGNALS
// anyway (it's a packages/shared export, not packages/contracts), so real
// validation costs nothing extra.
class ThumbnailOptionsDto {
  @IsOptional()
  @IsArray()
  @IsIn(THUMBNAIL_SIGNALS, { each: true })
  preferredSignals?: ThumbnailSignal[];
}

// AI B-roll Recommendation - see @speedora/shared's ProcessingOptions.broll comment for why this
// isn't numbered like the sections above (it's item 8 of a separate, later gap-analysis list, not
// part of the original 24-section spec).
class BRollOptionsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_BROLL_CUTAWAYS_LIMIT)
  maxCutaways?: number | null;
}

// Validates @speedora/shared's ProcessingOptions shape - every field here
// maps to a real, wired pipeline parameter (see that type's own comment for
// which ones); nothing here is decorative. `version` is deliberately NOT a
// client-supplied field - toProcessingOptions() below always stamps the
// current PROCESSING_OPTIONS_VERSION on the way out, since a submitted
// request always describes the CURRENT shape (see migrateProcessingOptions()
// for how an older stored value is handled on the way back in).
export class ProcessingOptionsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ProjectOptionsDto)
  project?: ProjectOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ClipGenerationOptionsDto)
  clipGeneration?: ClipGenerationOptionsDto;

  @ValidateNested()
  @Type(() => SubtitleOptionsDto)
  subtitle!: SubtitleOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExportOptionsDto)
  export?: ExportOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SceneAnalysisOptionsDto)
  sceneAnalysis?: SceneAnalysisOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => HighlightFocusOptionsDto)
  highlightFocus?: HighlightFocusOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SmartCropOptionsDto)
  smartCrop?: SmartCropOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BrandKitOptionsDto)
  brandKit?: BrandKitOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SeoOptionsDto)
  seo?: SeoOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PublishingOptionsDto)
  publishing?: PublishingOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ThumbnailOptionsDto)
  thumbnail?: ThumbnailOptionsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BRollOptionsDto)
  broll?: BRollOptionsDto;
}

// A validated ProcessingOptionsDto has every field the class-validator
// decorators above already checked, just with class-transformer's usual
// "omitted stays undefined, not null/default" plainToInstance behavior -
// this normalizes it into @speedora/shared's own current-version
// ProcessingOptions shape (every field a present, possibly-null key, every
// group present), the same "omitted means use the pipeline's own default"
// contract every worker adapter reading Video.processingOptions already
// relies on.
export function toProcessingOptions(dto: ProcessingOptionsDto): ProcessingOptions {
  return {
    version: PROCESSING_OPTIONS_VERSION,
    project: {
      name: dto.project?.name ?? null,
      tags: dto.project?.tags ?? [],
    },
    clipGeneration: {
      clipCount: dto.clipGeneration?.clipCount ?? null,
      minClipDurationSeconds: dto.clipGeneration?.minClipDurationSeconds ?? null,
      maxClipDurationSeconds: dto.clipGeneration?.maxClipDurationSeconds ?? null,
    },
    subtitle: {
      captionStyle: toSharedCaptionStyle(dto.subtitle.captionStyle),
      speakerColorCaptions: dto.subtitle.speakerColorCaptions,
      fontFamily: (dto.subtitle.fontFamily ?? null) as ProcessingOptions['subtitle']['fontFamily'],
    },
    export: {
      qualityPreset: dto.export?.qualityPreset ?? null,
      aspectRatio: dto.export?.aspectRatio ?? null,
      resolutionTier: dto.export?.resolutionTier ?? null,
    },
    sceneAnalysis: {
      detectSceneCuts: dto.sceneAnalysis?.detectSceneCuts ?? true,
      detectMotionEnergy: dto.sceneAnalysis?.detectMotionEnergy ?? true,
      detectCameraMotion: dto.sceneAnalysis?.detectCameraMotion ?? true,
    },
    highlightFocus: {
      intents: dto.highlightFocus?.intents ?? [],
      confidenceThreshold: dto.highlightFocus?.confidenceThreshold ?? null,
    },
    smartCrop: { zoomInFraction: dto.smartCrop?.zoomInFraction ?? null },
    brandKit: {
      applyBrandKit: dto.brandKit?.applyBrandKit ?? true,
      templateId: dto.brandKit?.templateId ?? null,
    },
    seo: {
      autoGeneratePlatformCopy: dto.seo?.autoGeneratePlatformCopy ?? false,
      platforms: dto.seo?.platforms ?? [],
    },
    publishing: {
      autoPublish: dto.publishing?.autoPublish ?? false,
      socialAccountIds: dto.publishing?.socialAccountIds ?? [],
      scheduledAt: dto.publishing?.scheduledAt ?? null,
    },
    thumbnail: { preferredSignals: dto.thumbnail?.preferredSignals ?? [] },
    broll: {
      enabled: dto.broll?.enabled ?? true,
      maxCutaways: dto.broll?.maxCutaways ?? null,
    },
  };
}
