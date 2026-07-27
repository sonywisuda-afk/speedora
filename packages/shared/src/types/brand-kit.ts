// Sprint 03d (Export Center roadmap) - the client-facing shape for a user's
// Brand Kit. logoUrl is a `/brand-kit/logo` endpoint path, never the raw
// storage key - same convention as every other resource. Null fields mean
// "not set yet", not an error - Brand Report degrades to default styling.
export interface BrandKitDto {
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  // Brand Kit roadmap (P3a) - one of FONT_FAMILIES's curated keys, or null
  // if unset (Brand Report/render-enqueue both fall back to build-ass.ts's
  // own default, Inter).
  fontFamily: string | null;
  // Watermark roadmap (P3c) - watermarkUrl is a `/brand-kit/watermark`
  // endpoint path, same "never the raw storage key" convention as logoUrl.
  // opacity/scale/margin are 0-1 fractions (scale/margin are fractions of
  // the OUTPUT video's width, resolution-independent by construction);
  // null fields mean "not set yet" - render-enqueue time falls back to
  // ClipsService.resolveWatermark's own code-level defaults.
  watermarkUrl: string | null;
  watermarkOpacity: number | null;
  watermarkScale: number | null;
  watermarkMargin: number | null;
  watermarkPosition: WatermarkPosition | null;
  // Intro roadmap (P3d) - introUrl is a `/brand-kit/intro` endpoint path,
  // same "never the raw storage key" convention as logoUrl/watermarkUrl.
  // introType tells the client (and the render pipeline) whether to treat
  // it as a video or a still image - null only when introUrl itself is
  // null. introImageDurationSeconds only matters when introType is
  // 'image' (a still has no inherent duration); null means the code-level
  // default (3s) applies. A video intro's own duration is never exposed
  // here - it's re-derived fresh per render (see apps/worker's
  // concatIntro()).
  introUrl: string | null;
  introType: IntroType | null;
  introImageDurationSeconds: number | null;
  // Outro roadmap (P3e) - same shape as intro* above, applied at the end of
  // the render instead of the start. Reuses IntroType ('video' | 'image') -
  // no new type vocabulary needed, the distinction is identical either way.
  outroUrl: string | null;
  outroType: IntroType | null;
  outroImageDurationSeconds: number | null;
}

// Template Presets roadmap (P3f) - the client-facing shape for a saved
// Brand Kit snapshot. Deliberately does NOT expose the template's own raw
// asset keys/URLs (logo/watermark/intro/outro) the way BrandKitDto exposes
// the CURRENTLY ACTIVE kit's assets via `/brand-kit/logo` etc. - there is no
// per-template asset-serving endpoint (only the active Brand Kit's assets
// are ever streamed), so a raw key here wouldn't be usable as an <img src>
// anyway. The switcher list only needs to summarize what a template
// contains (has*/*Position/*Type) well enough to pick between saved
// templates, not preview their images - same "Campaign's named-entity list,
// no live preview" precedent this sub-phase's plan called out.
export interface BrandKitTemplateDto {
  id: string;
  name: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  fontFamily: string | null;
  hasLogo: boolean;
  hasWatermark: boolean;
  watermarkPosition: WatermarkPosition | null;
  hasIntro: boolean;
  introType: IntroType | null;
  hasOutro: boolean;
  outroType: IntroType | null;
  createdAt: string;
}

// Brand Kit roadmap (P3a) - apps/web's own copy of packages/contracts's
// curated FONT_FAMILIES list, same "this package has no dependency on
// packages/contracts" duplication convention CaptionStyle/CAPTION_STYLES
// (video.ts) already use for the frontend - keep in sync with
// packages/contracts/src/subtitles.ts and apps/worker/Dockerfile by hand.
export const FONT_FAMILIES = [
  'Inter',
  'Poppins',
  'Montserrat',
  'Roboto',
  'Oswald',
  'Nunito',
  'Open Sans',
  'Lato',
] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

// Watermark roadmap (P3c) - a small closed anchor set for ffmpeg's overlay
// position, single copy (unlike FONT_FAMILIES, no packages/contracts
// duplicate needed - nothing here needs Zod runtime validation the way
// build-ass.ts needed for fonts; apps/api validates via class-validator's
// @IsIn() importing straight from this package, apps/worker's ffmpeg.ts
// just uses this as a plain TS type).
export const WATERMARK_POSITIONS = [
  'TOP_LEFT',
  'TOP_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_RIGHT',
  'CENTER',
] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

// Intro roadmap (P3d) - same "small closed set, single copy" shape as
// WATERMARK_POSITIONS above. Mirrors StockAsset's own 'video' | 'image'
// distinction (B-roll), not a new vocabulary.
export const INTRO_TYPES = ['video', 'image'] as const;
export type IntroType = (typeof INTRO_TYPES)[number];

// Intro roadmap (P3d) - shared between apps/api's UpdateBrandKitDto (bounds
// introImageDurationSeconds) and apps/worker's concatIntro() (bounds a video
// intro's own real length, and the fallback when introImageDurationSeconds
// is null) - one constant, not two independently-tuned copies.
export const MAX_INTRO_DURATION_SECONDS = 10;
export const DEFAULT_INTRO_IMAGE_DURATION_SECONDS = 3;

// Workspace-level Brand Kit roadmap (P3g) - the flat set of raw brand*
// columns shared identically by both User and Workspace (see schema.prisma's
// Workspace model comment) - the shape every render-side resolve site reads
// from, whichever row it came from.
export interface BrandKitFields {
  brandLogoUrl: string | null;
  brandPrimaryColor: string | null;
  brandSecondaryColor: string | null;
  brandFontFamily: string | null;
  brandWatermarkUrl: string | null;
  brandWatermarkOpacity: number | null;
  brandWatermarkScale: number | null;
  brandWatermarkMargin: number | null;
  brandWatermarkPosition: string | null;
  brandIntroUrl: string | null;
  brandIntroType: string | null;
  brandIntroImageDurationSeconds: number | null;
  brandOutroUrl: string | null;
  brandOutroType: string | null;
  brandOutroImageDurationSeconds: number | null;
}

// Pre-Processing Settings roadmap (Phase 3) - the flat set of raw fields a
// BrandKitTemplate row carries (see packages/database's schema.prisma) -
// same shape apps/api's BrandKitService.applyTemplate() already reads to
// copy a template onto a live BrandKitFields row, duplicated here as an
// explicit interface (not just an inline object type) so
// templateToBrandKitFields() below has one real, reusable source of the
// field-name mapping instead of two independently-hand-written copies.
export interface BrandKitTemplateFields {
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  fontFamily: string | null;
  watermarkUrl: string | null;
  watermarkOpacity: number | null;
  watermarkScale: number | null;
  watermarkMargin: number | null;
  watermarkPosition: string | null;
  introUrl: string | null;
  introType: string | null;
  introImageDurationSeconds: number | null;
  outroUrl: string | null;
  outroType: string | null;
  outroImageDurationSeconds: number | null;
}

// Pre-Processing Settings roadmap (Phase 3) - maps a BrandKitTemplate's own
// field names onto BrandKitFields' `brand`-prefixed ones, the same mapping
// BrandKitService.applyTemplate() already performs when copying a template
// onto a live User/Workspace row. Used instead by
// apps/worker/detect-clips.worker.ts to resolve a template's fields as the
// EFFECTIVE Brand Kit for one video's clips without mutating anyone's live
// Brand Kit as a side effect of processing that video - "apply" (the
// existing endpoint) and "use for this video only" (this function) are
// deliberately two different operations sharing one field mapping.
export function templateToBrandKitFields(template: BrandKitTemplateFields): BrandKitFields {
  return {
    brandLogoUrl: template.logoUrl,
    brandPrimaryColor: template.primaryColor,
    brandSecondaryColor: template.secondaryColor,
    brandFontFamily: template.fontFamily,
    brandWatermarkUrl: template.watermarkUrl,
    brandWatermarkOpacity: template.watermarkOpacity,
    brandWatermarkScale: template.watermarkScale,
    brandWatermarkMargin: template.watermarkMargin,
    brandWatermarkPosition: template.watermarkPosition,
    brandIntroUrl: template.introUrl,
    brandIntroType: template.introType,
    brandIntroImageDurationSeconds: template.introImageDurationSeconds,
    brandOutroUrl: template.outroUrl,
    brandOutroType: template.outroType,
    brandOutroImageDurationSeconds: template.outroImageDurationSeconds,
  };
}

// Workspace-level Brand Kit roadmap (P3g) - merges a video's workspace
// Brand Kit fields over its owner's personal ones, per FIELD (not an
// all-or-nothing "use workspace OR owner" switch): a team can set just a
// shared logo/colors while everyone's own font/watermark preferences still
// apply wherever the team hasn't defined one. Safe to merge independently
// field-by-field even for the paired intro/outro url+type columns, because
// BrandKitService.saveIntro/saveOutro/removeIntro/removeOutro always write
// both fields of a pair together on the same row - url and type are never
// null on one but set on the other, so `?? ` picks the same source (either
// both from workspace, or both from owner) for each pair.
//
// `workspace` is null when the video's workspace IS the owner's personal
// one - every call site skips the Workspace fetch entirely in that case
// (same "don't fetch when not needed" posture every other Brand Kit
// resolve function already has), so this is a pure pass-through of `owner`.
export function mergeBrandKitFields(
  workspace: BrandKitFields | null,
  owner: BrandKitFields,
): BrandKitFields {
  if (!workspace) return owner;
  return {
    brandLogoUrl: workspace.brandLogoUrl ?? owner.brandLogoUrl,
    brandPrimaryColor: workspace.brandPrimaryColor ?? owner.brandPrimaryColor,
    brandSecondaryColor: workspace.brandSecondaryColor ?? owner.brandSecondaryColor,
    brandFontFamily: workspace.brandFontFamily ?? owner.brandFontFamily,
    brandWatermarkUrl: workspace.brandWatermarkUrl ?? owner.brandWatermarkUrl,
    brandWatermarkOpacity: workspace.brandWatermarkOpacity ?? owner.brandWatermarkOpacity,
    brandWatermarkScale: workspace.brandWatermarkScale ?? owner.brandWatermarkScale,
    brandWatermarkMargin: workspace.brandWatermarkMargin ?? owner.brandWatermarkMargin,
    brandWatermarkPosition: workspace.brandWatermarkPosition ?? owner.brandWatermarkPosition,
    brandIntroUrl: workspace.brandIntroUrl ?? owner.brandIntroUrl,
    brandIntroType: workspace.brandIntroType ?? owner.brandIntroType,
    brandIntroImageDurationSeconds:
      workspace.brandIntroImageDurationSeconds ?? owner.brandIntroImageDurationSeconds,
    brandOutroUrl: workspace.brandOutroUrl ?? owner.brandOutroUrl,
    brandOutroType: workspace.brandOutroType ?? owner.brandOutroType,
    brandOutroImageDurationSeconds:
      workspace.brandOutroImageDurationSeconds ?? owner.brandOutroImageDurationSeconds,
  };
}
