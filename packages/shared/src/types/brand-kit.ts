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
