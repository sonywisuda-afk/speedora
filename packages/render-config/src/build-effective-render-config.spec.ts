import type { BuildEffectiveRenderConfigInput } from '@speedora/contracts';
import { buildEffectiveRenderConfig } from './build-effective-render-config';

// Every field required by the input contract, with sensible defaults - tests override only what
// they care about, same "base fixture + overrides" convention as score-clip-candidates.spec.ts's
// own rawCandidate() helper.
function baseInput(
  overrides: Partial<BuildEffectiveRenderConfigInput> = {},
): BuildEffectiveRenderConfigInput {
  return {
    clipId: 'clip-1',
    videoId: 'video-1',
    sourceWidth: 1920,
    sourceHeight: 1080,
    processingOptions: null,
    clipOverrides: {
      captionStyle: 'DEFAULT',
      speakerColorCaptions: false,
      smartSegmentation: false,
      dynamicCaptions: false,
      captionLanguage: null,
      fontFamily: null,
      watermark: null,
      intro: null,
      outro: null,
    },
    featureFlags: {
      ocrHighlightEnabled: false,
      focusShiftEnabled: false,
      digitalPushEnabled: false,
      reactionHoldEnabled: false,
      pauseHoldEnabled: false,
      speakerAwareFocusShiftEnabled: false,
    },
    ...overrides,
  };
}

describe('buildEffectiveRenderConfig', () => {
  it('stamps version 1 and passes clipId/videoId through unchanged', () => {
    const config = buildEffectiveRenderConfig(baseInput({ clipId: 'clip-9', videoId: 'video-9' }));

    expect(config.version).toBe(1);
    expect(config.clipId).toBe('clip-9');
    expect(config.videoId).toBe('video-9');
  });

  describe('output.quality / output.qualityPreset', () => {
    it('resolves null/null when processingOptions is null (unchanged prior default)', () => {
      const config = buildEffectiveRenderConfig(baseInput({ processingOptions: null }));

      expect(config.output.qualityPreset).toBeNull();
      expect(config.output.quality).toBeNull();
    });

    it.each([
      ['maximum_quality', { preset: 'slow', crf: 18 }],
      ['balanced', { preset: 'fast', crf: 23 }],
      ['small_size', { preset: 'veryfast', crf: 28 }],
    ] as const)(
      'resolves %s to %j (matching render-clip.worker.ts EXPORT_QUALITY_PRESETS)',
      (qualityPreset, expected) => {
        const config = buildEffectiveRenderConfig(
          baseInput({
            processingOptions: processingOptionsFixture({ export: { qualityPreset } }),
          }),
        );

        expect(config.output.qualityPreset).toBe(qualityPreset);
        expect(config.output.quality).toEqual(expected);
      },
    );
  });

  describe('output.aspectRatio', () => {
    it('defaults to 9:16 when processingOptions is null', () => {
      const config = buildEffectiveRenderConfig(baseInput({ processingOptions: null }));
      expect(config.output.aspectRatio).toBe('9:16');
    });

    it.each(['9:16', '16:9', '1:1', '4:5', '4:3'] as const)(
      'resolves the explicit pin %s regardless of source dimensions',
      (aspectRatio) => {
        const config = buildEffectiveRenderConfig(
          baseInput({
            sourceWidth: 100,
            sourceHeight: 100,
            processingOptions: processingOptionsFixture({ export: { aspectRatio } }),
          }),
        );
        expect(config.output.aspectRatio).toBe(aspectRatio);
      },
    );

    it("resolves 'auto' to 16:9 for a clearly landscape source", () => {
      const config = buildEffectiveRenderConfig(
        baseInput({
          sourceWidth: 1920,
          sourceHeight: 1080,
          processingOptions: processingOptionsFixture({ export: { aspectRatio: 'auto' } }),
        }),
      );
      expect(config.output.aspectRatio).toBe('16:9');
    });

    it("resolves 'auto' to 9:16 for a clearly portrait source", () => {
      const config = buildEffectiveRenderConfig(
        baseInput({
          sourceWidth: 1080,
          sourceHeight: 1920,
          processingOptions: processingOptionsFixture({ export: { aspectRatio: 'auto' } }),
        }),
      );
      expect(config.output.aspectRatio).toBe('9:16');
    });

    it("resolves 'auto' to 1:1 for a near-square source", () => {
      const config = buildEffectiveRenderConfig(
        baseInput({
          sourceWidth: 1000,
          sourceHeight: 1000,
          processingOptions: processingOptionsFixture({ export: { aspectRatio: 'auto' } }),
        }),
      );
      expect(config.output.aspectRatio).toBe('1:1');
    });
  });

  describe('output.resolutionTier', () => {
    it('resolves null when processingOptions is null (no normalization policy)', () => {
      const config = buildEffectiveRenderConfig(baseInput({ processingOptions: null }));
      expect(config.output.resolutionTier).toBeNull();
    });

    it("resolves 'auto' to '1080p'", () => {
      const config = buildEffectiveRenderConfig(
        baseInput({
          processingOptions: processingOptionsFixture({ export: { resolutionTier: 'auto' } }),
        }),
      );
      expect(config.output.resolutionTier).toBe('1080p');
    });

    it.each(['1080p', '720p'] as const)('resolves the explicit tier %s unchanged', (tier) => {
      const config = buildEffectiveRenderConfig(
        baseInput({
          processingOptions: processingOptionsFixture({ export: { resolutionTier: tier } }),
        }),
      );
      expect(config.output.resolutionTier).toBe(tier);
    });
  });

  describe('captions', () => {
    it('passes every clipOverrides caption field through unchanged', () => {
      const config = buildEffectiveRenderConfig(
        baseInput({
          clipOverrides: {
            captionStyle: 'KARAOKE',
            speakerColorCaptions: true,
            smartSegmentation: true,
            dynamicCaptions: true,
            captionLanguage: 'es',
            fontFamily: 'Poppins',
            watermark: null,
            intro: null,
            outro: null,
          },
        }),
      );

      expect(config.captions).toEqual({
        style: 'KARAOKE',
        speakerColorCaptions: true,
        smartSegmentation: true,
        dynamicCaptions: true,
        captionLanguage: 'es',
        fontFamily: 'Poppins',
      });
    });
  });

  describe('visualEmphasis', () => {
    it('resolves zoomInFraction to null when processingOptions is null', () => {
      const config = buildEffectiveRenderConfig(baseInput({ processingOptions: null }));
      expect(config.visualEmphasis.zoomInFraction).toBeNull();
    });

    it('passes a configured zoomInFraction through unchanged', () => {
      const config = buildEffectiveRenderConfig(
        baseInput({
          processingOptions: processingOptionsFixture({ smartCrop: { zoomInFraction: 0.35 } }),
        }),
      );
      expect(config.visualEmphasis.zoomInFraction).toBe(0.35);
    });

    it('resolves every ops-level feature flag from the adapter-supplied featureFlags input, never re-reading env vars itself', () => {
      const config = buildEffectiveRenderConfig(
        baseInput({
          featureFlags: {
            ocrHighlightEnabled: true,
            focusShiftEnabled: true,
            digitalPushEnabled: true,
            reactionHoldEnabled: true,
            pauseHoldEnabled: true,
            speakerAwareFocusShiftEnabled: true,
          },
        }),
      );

      expect(config.visualEmphasis).toMatchObject({
        ocrHighlightEnabled: true,
        focusShiftEnabled: true,
        digitalPushEnabled: true,
        reactionHoldEnabled: true,
        pauseHoldEnabled: true,
        speakerAwareFocusShiftEnabled: true,
      });
    });
  });

  describe('broll', () => {
    it('defaults to enabled: true, maxMoments: null when processingOptions is null', () => {
      const config = buildEffectiveRenderConfig(baseInput({ processingOptions: null }));
      expect(config.broll).toEqual({ enabled: true, maxMoments: null });
    });

    it('resolves enabled: false and a configured maxCutaways', () => {
      const config = buildEffectiveRenderConfig(
        baseInput({
          processingOptions: processingOptionsFixture({
            broll: { enabled: false, maxCutaways: 3 },
          }),
        }),
      );
      expect(config.broll).toEqual({ enabled: false, maxMoments: 3 });
    });
  });

  describe('branding', () => {
    it('passes null watermark/intro/outro through unchanged', () => {
      const config = buildEffectiveRenderConfig(baseInput());
      expect(config.branding).toEqual({ watermark: null, intro: null, outro: null });
    });

    it('passes a fully-configured watermark/intro/outro through unchanged', () => {
      const watermark = {
        key: 'brand/watermark.png',
        opacity: 0.8,
        scale: 0.15,
        margin: 0.03,
        position: 'BOTTOM_RIGHT' as const,
      };
      const intro = { key: 'brand/intro.mp4', type: 'video' as const, imageDurationSeconds: null };
      const outro = { key: 'brand/outro.png', type: 'image' as const, imageDurationSeconds: 3 };

      const config = buildEffectiveRenderConfig(
        baseInput({
          clipOverrides: {
            captionStyle: 'DEFAULT',
            speakerColorCaptions: false,
            smartSegmentation: false,
            dynamicCaptions: false,
            captionLanguage: null,
            fontFamily: null,
            watermark,
            intro,
            outro,
          },
        }),
      );

      expect(config.branding).toEqual({ watermark, intro, outro });
    });
  });

  describe('sceneAnalysis', () => {
    it('defaults every flag to true when processingOptions is null', () => {
      const config = buildEffectiveRenderConfig(baseInput({ processingOptions: null }));
      expect(config.sceneAnalysis).toEqual({
        detectSceneCuts: true,
        detectMotionEnergy: true,
        detectCameraMotion: true,
      });
    });

    it('resolves each flag independently when explicitly disabled', () => {
      const config = buildEffectiveRenderConfig(
        baseInput({
          processingOptions: processingOptionsFixture({
            sceneAnalysis: {
              detectSceneCuts: false,
              detectMotionEnergy: true,
              detectCameraMotion: false,
            },
          }),
        }),
      );
      expect(config.sceneAnalysis).toEqual({
        detectSceneCuts: false,
        detectMotionEnergy: true,
        detectCameraMotion: false,
      });
    });
  });
});

// Builds a full renderConfigProcessingOptionsSchema-shaped object, with every group at its own
// "nothing configured" default, overridden per-test via a shallow per-group merge - same
// "complete fixture, override what you care about" shape as baseInput() above.
function processingOptionsFixture(
  overrides: Partial<{
    export: Partial<{
      qualityPreset: 'maximum_quality' | 'balanced' | 'small_size' | null;
      aspectRatio: 'auto' | '9:16' | '16:9' | '1:1' | '4:5' | '4:3' | null;
      resolutionTier: 'auto' | '1080p' | '720p' | null;
    }>;
    smartCrop: Partial<{ zoomInFraction: number | null }>;
    broll: Partial<{ enabled: boolean; maxCutaways: number | null }>;
    sceneAnalysis: Partial<{
      detectSceneCuts: boolean;
      detectMotionEnergy: boolean;
      detectCameraMotion: boolean;
    }>;
  }> = {},
) {
  return {
    export: {
      qualityPreset: null,
      aspectRatio: null,
      resolutionTier: null,
      ...overrides.export,
    },
    smartCrop: { zoomInFraction: null, ...overrides.smartCrop },
    broll: { enabled: true, maxCutaways: null, ...overrides.broll },
    sceneAnalysis: {
      detectSceneCuts: true,
      detectMotionEnergy: true,
      detectCameraMotion: true,
      ...overrides.sceneAnalysis,
    },
  };
}
