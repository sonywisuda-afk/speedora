import { resolveOutputResolution } from './resolution-policy';

describe('resolveOutputResolution', () => {
  it('returns the crop unchanged when tier is null (no cap - exact pre-Phase-1 behavior)', () => {
    const crop = { width: 1215, height: 2160 };

    expect(resolveOutputResolution(crop, null)).toEqual(crop);
  });

  it('caps a 4K-derived 9:16 crop down to 1080x1920 under the 1080p tier', () => {
    // 3840x2160 (16:9) cropped to 9:16 -> 1215x2160 (see crop-path.spec.ts's own 4K-style case).
    const crop = { width: 1215, height: 2160 };

    expect(resolveOutputResolution(crop, '1080p')).toEqual({ width: 1080, height: 1920 });
  });

  it('caps a 16:9 crop down to 1920x1080 under the 1080p tier', () => {
    const crop = { width: 2880, height: 1620 }; // a 16:9 crop from an even larger source

    expect(resolveOutputResolution(crop, '1080p')).toEqual({ width: 1920, height: 1080 });
  });

  it('caps a 1:1 crop down to 1080x1080 under the 1080p tier (both sides ARE the short side)', () => {
    const crop = { width: 2160, height: 2160 };

    expect(resolveOutputResolution(crop, '1080p')).toEqual({ width: 1080, height: 1080 });
  });

  it('caps down to 720x1280 under the 720p tier', () => {
    const crop = { width: 1080, height: 1920 };

    expect(resolveOutputResolution(crop, '720p')).toEqual({ width: 720, height: 1280 });
  });

  it('never upscales a crop already at or under the tier ceiling (a 720p source asked for 1080p)', () => {
    const crop = { width: 720, height: 1280 };

    expect(resolveOutputResolution(crop, '1080p')).toEqual(crop);
  });

  it('returns the crop unchanged when its short side exactly matches the ceiling (no-op cap)', () => {
    const crop = { width: 1080, height: 1920 };

    expect(resolveOutputResolution(crop, '1080p')).toEqual(crop);
  });

  it('always returns even dimensions after scaling down', () => {
    const crop = { width: 1281, height: 2277 }; // odd short side once scaled

    const result = resolveOutputResolution(crop, '1080p');

    expect(result.width % 2).toBe(0);
    expect(result.height % 2).toBe(0);
  });
});
