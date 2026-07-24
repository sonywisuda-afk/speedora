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
