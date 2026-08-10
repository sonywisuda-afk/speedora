import type { CropDimensions } from '@speedora/contracts';

// Output Resolution/Quality audit, Phase 1 (foundation) - caps a clip's OUTPUT resolution to a
// named quality tier's SHORT-side ceiling, without ever upscaling past what
// computeCropDimensions() (crop-path.ts) already produced from the real source. "Short side" (not
// width/height directly) is the orientation-independent way to express "1080p"/"720p" here - for
// a 9:16 crop the short side is width, for 16:9 it's height, and for 1:1 both sides ARE the short
// side, so one ceiling value produces the exact canonical size for every aspect ratio (e.g.
// '1080p' -> 1080x1920 / 1920x1080 / 1080x1080 - the three target profiles named in the audit).
//
// Deliberately geometry-only, same as crop-path.ts - no notion of ProcessingOptions' own
// 'auto'/'1080p'/'720p'/null vocabulary belongs here; translating a user-facing quality choice
// into this tier is the caller's job (see render-clip.worker.ts's resolveResolutionTier()).
export const RESOLUTION_TIER_SHORT_SIDE_CEILING: Record<'1080p' | '720p', number> = {
  '1080p': 1080,
  '720p': 720,
};

function roundToEven(value: number): number {
  return Math.round(value / 2) * 2;
}

// `tier` null means "no cap" - the pipeline's exact behavior before this function existed,
// returning `crop` unchanged (Phase 1's default, preserving every existing render's output
// resolution byte-for-byte). A non-null tier only ever SHRINKS `crop`, never grows it - a crop
// already at or under the ceiling on its own short side (e.g. a 720p source asked for the
// '1080p' tier) is returned unchanged rather than upscaled, satisfying the audit's "don't fake a
// higher resolution than the source can support" rule for free, as a side effect of the same
// "cap, don't force" shape that makes the common case a no-op. The long side is scaled by the
// exact same factor as the short side, so the aspect ratio `crop` already established is
// preserved exactly (mirroring computeCropDimensions' own scaling-not-stretching contract).
export function resolveOutputResolution(
  crop: CropDimensions,
  tier: '1080p' | '720p' | null,
): CropDimensions {
  if (!tier) return crop;

  const ceiling = RESOLUTION_TIER_SHORT_SIDE_CEILING[tier];
  const shortSide = Math.min(crop.width, crop.height);
  if (shortSide <= ceiling) return crop;

  const scale = ceiling / shortSide;
  return {
    width: roundToEven(crop.width * scale),
    height: roundToEven(crop.height * scale),
  };
}
