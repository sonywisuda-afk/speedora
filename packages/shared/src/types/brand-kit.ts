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
