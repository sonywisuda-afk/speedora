import type { CropDimensions } from '@speedora/contracts';

// Output Resolution/Quality audit, Phase 1 (foundation) - normalizes a clip's OUTPUT resolution
// to a named quality tier's canonical SHORT side, without width/height directly - for a 9:16 crop
// the short side is width, for 16:9 it's height, and for 1:1 both sides ARE the short side, so one
// ceiling value produces the exact canonical size for every aspect ratio (e.g. '1080p' ->
// 1080x1920 / 1920x1080 / 1080x1080 - the three target profiles named in the audit).
//
// Deliberately geometry-only, same as crop-path.ts - no notion of ProcessingOptions' own
// 'auto'/'1080p'/'720p'/null vocabulary belongs here; translating a user-facing quality choice
// into this tier is the caller's job (see render-clip.worker.ts's resolveResolutionTier()).
export const RESOLUTION_TIER_SHORT_SIDE_CEILING: Record<'1080p' | '720p', number> = {
  '1080p': 1080,
  '720p': 720,
};

// Phase 2 - resolved via AskUserQuestion after real-ffmpeg verification (Phase 2's own
// integration spec) found that pure crop-only reframing produces a real, native crop FAR below
// any canonical delivery size for the overwhelmingly common case: a typical 1920x1080 landscape
// source cropped to 9:16 keeps the source's full 1080 height and narrows width to
// round(1080 * 9/16) = 608px - not 1080x1920. Speedora's crop step alone (computeCropDimensions,
// crop-path.ts) never scales anything, by design (it only ever removes pixels); reaching a real
// social-video-quality canonical size for a source that isn't already tall/portrait/4K requires
// scaling the crop UP, the same "reframe" behavior every comparable product (OpusClip included)
// already does. The chosen policy: scale up to the tier's canonical size whenever the natural
// crop is at least this many pixels on its own short side; below that, scaling up would introduce
// visible upscale artifacts from too little real source detail, so the natural (smaller, but
// genuinely native-resolution) crop is delivered instead rather than a blurry interpolation - the
// same "don't fake a higher resolution than the source can support" rule as before, now guarding
// the scale-UP direction too, not only scale-DOWN.
export const MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP = 480;

function roundToEven(value: number): number {
  return Math.round(value / 2) * 2;
}

// Computes the tier's exact canonical size for a given true aspect ratio - shared by both the
// scale-up and scale-down branches below. Always rounds exactly once, directly from
// targetAspectRatio (NOT from crop's own already-rounded width/height ratio) - see this
// function's own Phase 2 regression test (resolution-policy.spec.ts) for why re-deriving the
// ratio from an already-rounded crop compounds a second rounding step and can land a couple
// pixels off the canonical size (a real 4K source landed at 1080x1918, not 1080x1920, the first
// time this was verified against real ffmpeg before this fix).
function canonicalSizeForRatio(ceiling: number, targetAspectRatio: number): CropDimensions {
  if (targetAspectRatio <= 1) {
    return { width: ceiling, height: roundToEven(ceiling / targetAspectRatio) };
  }
  return { height: ceiling, width: roundToEven(ceiling * targetAspectRatio) };
}

// `tier` null means "no normalization at all" - the pipeline's exact behavior before this
// function existed, returning `crop` unchanged (Phase 1's default, preserving every existing
// render's output resolution byte-for-byte - see render-clip.worker.ts's resolveResolutionTier()
// for how 'auto'/explicit tiers vs. null are told apart).
//
// A non-null tier normalizes `crop` to the tier's canonical size in EITHER direction:
// - Natural short side > ceiling: scaled DOWN (Phase 1's original behavior - always safe, no
//   floor needed, downscaling never introduces upscale artifacts).
// - Natural short side < ceiling and >= MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP: scaled UP to the
//   canonical size (Phase 2 - see that constant's own comment for why this exists and its floor).
// - Natural short side < MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP: returned unchanged - too little real
//   source detail to scale up without visible artifacts, so the smaller native crop wins over a
//   blurry interpolation.
// - Natural short side already exactly the ceiling: returned unchanged (nothing to do).
export function resolveOutputResolution(
  crop: CropDimensions,
  targetAspectRatio: number,
  tier: '1080p' | '720p' | null,
): CropDimensions {
  if (!tier) return crop;

  const ceiling = RESOLUTION_TIER_SHORT_SIDE_CEILING[tier];
  const shortSide = Math.min(crop.width, crop.height);
  if (shortSide === ceiling) return crop;
  if (shortSide < ceiling && shortSide < MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP) return crop;

  return canonicalSizeForRatio(ceiling, targetAspectRatio);
}
