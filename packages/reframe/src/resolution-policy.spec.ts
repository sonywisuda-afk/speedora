import { computeCropDimensions } from './crop-path';
import { MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP, resolveOutputResolution } from './resolution-policy';

describe('resolveOutputResolution', () => {
  it('returns the crop unchanged when tier is null (no normalization at all - exact pre-Phase-1 behavior)', () => {
    const crop = { width: 1215, height: 2160 };

    expect(resolveOutputResolution(crop, 9 / 16, null)).toEqual(crop);
  });

  it('returns the crop unchanged when its short side already exactly equals the ceiling', () => {
    const crop = { width: 1080, height: 1920 };

    expect(resolveOutputResolution(crop, 9 / 16, '1080p')).toEqual(crop);
  });

  describe('scaling DOWN (natural crop bigger than the tier - Phase 1, unchanged by Phase 2)', () => {
    it('caps a 4K-derived 9:16 crop down to exactly 1080x1920 under the 1080p tier', () => {
      const crop = { width: 1215, height: 2160 };

      expect(resolveOutputResolution(crop, 9 / 16, '1080p')).toEqual({
        width: 1080,
        height: 1920,
      });
    });

    it('caps a 16:9 crop down to exactly 1920x1080 under the 1080p tier', () => {
      const crop = { width: 2880, height: 1620 }; // a 16:9 crop from an even larger source

      expect(resolveOutputResolution(crop, 16 / 9, '1080p')).toEqual({
        width: 1920,
        height: 1080,
      });
    });

    it('caps a 1:1 crop down to exactly 1080x1080 under the 1080p tier (both sides ARE the short side)', () => {
      const crop = { width: 2160, height: 2160 };

      expect(resolveOutputResolution(crop, 1, '1080p')).toEqual({ width: 1080, height: 1080 });
    });

    it('caps down to exactly 720x1280 under the 720p tier', () => {
      const crop = { width: 1080, height: 1920 };

      expect(resolveOutputResolution(crop, 9 / 16, '720p')).toEqual({ width: 720, height: 1280 });
    });

    // Phase 2 regression test - locks in a real drift caught by
    // ffmpeg.output-profile.integration.spec.ts against a real encode: rescaling
    // computeCropDimensions()'s own ALREADY-ROUNDED output (instead of recomputing from the true
    // ratio) used to land on 1080x1918 here, not the canonical 1080x1920, because
    // computeCropDimensions() itself had already rounded 1215 up to 1216 before this function ever
    // saw it. Chaining the two REAL functions together (not hand-picked "clean" crop numbers, as
    // every other test in this file uses) is exactly what proves the fix.
    it('hits the exact canonical 1080x1920 when chained after computeCropDimensions() for a real 4K source (double-rounding regression)', () => {
      const naturalCrop = computeCropDimensions(3840, 2160, 9 / 16);
      expect(naturalCrop).toEqual({ width: 1216, height: 2160 }); // computeCropDimensions' own rounding

      const result = resolveOutputResolution(naturalCrop, 9 / 16, '1080p');

      expect(result).toEqual({ width: 1080, height: 1920 });
    });
  });

  // Phase 2 (resolved via AskUserQuestion after real-ffmpeg verification) - a pure crop-only
  // pipeline was found to deliver FAR below any canonical size for the single most common real
  // conversion (a typical 1920x1080 landscape source cropped to 9:16 -> a 608px-wide crop, not
  // 1080x1920 - see MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP's own comment for the full story). Scaling
  // up to the tier's canonical size is now real behavior, not just a cap.
  describe('scaling UP (natural crop smaller than the tier, at/above the floor)', () => {
    it('scales a 1920x1080-derived 9:16 crop UP to exactly 1080x1920 under the 1080p tier', () => {
      // computeCropDimensions(1920, 1080, 9/16) -> {608, 1080} - the real, previously-unverified
      // "too narrow" case this whole redesign exists to fix.
      const naturalCrop = computeCropDimensions(1920, 1080, 9 / 16);
      expect(naturalCrop).toEqual({ width: 608, height: 1080 });

      const result = resolveOutputResolution(naturalCrop, 9 / 16, '1080p');

      expect(result).toEqual({ width: 1080, height: 1920 });
    });

    it('scales a portrait-source-derived 16:9 crop UP to exactly 1920x1080 under the 1080p tier', () => {
      // computeCropDimensions(1080, 1920, 16/9) -> {1080, 608} - the mirror-image case: a portrait
      // source asked for landscape output.
      const naturalCrop = computeCropDimensions(1080, 1920, 16 / 9);
      expect(naturalCrop).toEqual({ width: 1080, height: 608 });

      const result = resolveOutputResolution(naturalCrop, 16 / 9, '1080p');

      expect(result).toEqual({ width: 1920, height: 1080 });
    });

    it('scales up to exactly 720x1280 under the 720p tier when the natural crop is below 720 but at/above the floor', () => {
      const crop = { width: 500, height: 889 }; // short side 500 >= floor (480), < 720 ceiling

      expect(resolveOutputResolution(crop, 9 / 16, '720p')).toEqual({ width: 720, height: 1280 });
    });

    it('scales up exactly at the floor boundary (short side === MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP)', () => {
      const crop = { width: MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP, height: 853 };

      const result = resolveOutputResolution(crop, 9 / 16, '1080p');

      expect(result).toEqual({ width: 1080, height: 1920 });
    });
  });

  describe('the floor - refusing to upscale a crop with too little real source detail', () => {
    it('leaves a crop below the floor unchanged rather than upscaling it into a blurry mess', () => {
      const crop = { width: MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP - 1, height: 850 };

      expect(resolveOutputResolution(crop, 9 / 16, '1080p')).toEqual(crop);
    });

    it('leaves an extremely small crop unchanged even under the smaller 720p tier', () => {
      const crop = { width: 200, height: 356 };

      expect(resolveOutputResolution(crop, 9 / 16, '720p')).toEqual(crop);
    });
  });

  it('never upscales a crop already at or under the tier ceiling but exactly matching it (no-op)', () => {
    const crop = { width: 720, height: 1280 };

    expect(resolveOutputResolution(crop, 9 / 16, '720p')).toEqual(crop);
  });

  it('always returns even dimensions, even for an unusual (non-9:16/16:9/1:1) ratio', () => {
    const crop = { width: 500, height: 1351 }; // short side 500, well above floor

    const result = resolveOutputResolution(crop, 0.37, '1080p');

    expect(result.width % 2).toBe(0);
    expect(result.height % 2).toBe(0);
  });
});
