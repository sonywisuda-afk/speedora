import type {
  BuildEffectiveRenderConfigInput,
  EffectiveRenderConfig,
  SourceMediaCharacteristics,
} from '@speedora/contracts';
import { computeCropDimensions, resolveOutputResolution } from '@speedora/reframe';
import { buildEffectiveRenderConfig } from './build-effective-render-config';
import { buildOutputProfile } from './build-output-profile';

const ASPECT_RATIO_NUMBER = {
  '9:16': 9 / 16,
  '16:9': 16 / 9,
  '1:1': 1,
  '4:5': 4 / 5,
  '4:3': 4 / 3,
} as const;

// Builds a real, schema-valid EffectiveRenderConfig via Phase 1's own buildEffectiveRenderConfig()
// - same "chain the real upstream function rather than hand-roll a fixture" approach the real
// adapter (render-clip.worker.ts) will use, and directly what section 13's regression test asks
// for: existing render configuration -> buildOutputProfile() -> expected current output
// dimensions.
function effectiveRenderConfig(
  overrides: Partial<BuildEffectiveRenderConfigInput> = {},
): EffectiveRenderConfig {
  return buildEffectiveRenderConfig({
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
  });
}

function sourceMedia(
  overrides: Partial<SourceMediaCharacteristics> = {},
): SourceMediaCharacteristics {
  return {
    width: 1920,
    height: 1080,
    frameRate: '30000/1001',
    audioSampleRate: 44100,
    audioChannels: 2,
    ...overrides,
  };
}

describe('buildOutputProfile', () => {
  describe('aspect ratio (all 5 explicit pins)', () => {
    it.each(['9:16', '16:9', '1:1', '4:5', '4:3'] as const)(
      'carries the resolved %s label straight through from EffectiveRenderConfig.output.aspectRatio',
      (aspectRatio) => {
        const config = effectiveRenderConfig({
          processingOptions: processingOptionsFixture({ export: { aspectRatio } }),
        });

        const profile = buildOutputProfile({
          effectiveRenderConfig: config,
          sourceMedia: sourceMedia(),
        });

        expect(profile.aspectRatio).toBe(aspectRatio);
      },
    );
  });

  describe('resolution tier: 1080p / 720p / natural', () => {
    it("resolves 'natural' (resolutionPreset) and preserves the existing crop-only behavior when resolutionTier is null", () => {
      const config = effectiveRenderConfig({ processingOptions: null });
      const media = sourceMedia({ width: 1920, height: 1080 });

      const profile = buildOutputProfile({ effectiveRenderConfig: config, sourceMedia: media });

      // Regression proof (section 13) - the SAME real computeCropDimensions() call the existing
      // pipeline already makes, with no resolveOutputResolution() normalization on top (tier
      // null), reproducing today's exact existing output dimensions.
      const expectedCrop = computeCropDimensions(1920, 1080, 9 / 16);
      expect(profile.resolutionPreset).toBe('natural');
      expect(profile.width).toBe(expectedCrop.width);
      expect(profile.height).toBe(expectedCrop.height);
    });

    it("resolves resolutionPreset '1080p' and scales up a natural crop below the tier ceiling", () => {
      const config = effectiveRenderConfig({
        processingOptions: processingOptionsFixture({ export: { resolutionTier: '1080p' } }),
      });
      const media = sourceMedia({ width: 1920, height: 1080 });

      const profile = buildOutputProfile({ effectiveRenderConfig: config, sourceMedia: media });

      expect(profile.resolutionPreset).toBe('1080p');
      expect(profile.width).toBe(1080);
      expect(profile.height).toBe(1920);
    });

    it("resolves resolutionPreset '720p'", () => {
      const config = effectiveRenderConfig({
        processingOptions: processingOptionsFixture({ export: { resolutionTier: '720p' } }),
      });
      const media = sourceMedia({ width: 1920, height: 1080 });

      const profile = buildOutputProfile({ effectiveRenderConfig: config, sourceMedia: media });

      expect(profile.resolutionPreset).toBe('720p');
      expect(profile.width).toBe(720);
      expect(profile.height).toBe(1280);
    });
  });

  describe('source examples, matching the real packages/reframe resolution logic exactly', () => {
    it.each([
      ['1920x1080 landscape, natural', 1920, 1080, null, '9:16'],
      ['1080x1920 portrait, natural', 1080, 1920, null, '9:16'],
      ['3840x2160 4K, 1080p tier', 3840, 2160, '1080p', '9:16'],
      ['720x1280 already-small portrait, natural', 720, 1280, null, '9:16'],
      ['a square source, natural, 1:1 target', 1000, 1000, null, '1:1'],
    ] as const)(
      '%s: OutputProfile dimensions match computeCropDimensions()+resolveOutputResolution() directly',
      (_label, width, height, resolutionTier, aspectRatio) => {
        const config = effectiveRenderConfig({
          processingOptions: processingOptionsFixture({ export: { aspectRatio, resolutionTier } }),
        });
        const media = sourceMedia({ width, height });

        const profile = buildOutputProfile({ effectiveRenderConfig: config, sourceMedia: media });

        const ratio = ASPECT_RATIO_NUMBER[aspectRatio];
        const expectedCrop = computeCropDimensions(width, height, ratio);
        const expected = resolveOutputResolution(expectedCrop, ratio, resolutionTier);
        expect({ width: profile.width, height: profile.height }).toEqual(expected);
      },
    );
  });

  describe('fps - preserved as the canonical profile value, never silently converted', () => {
    it.each(['24', '25', '30', '60', '30000/1001', '60000/1001'])(
      'preserves a resolved source frame rate of %s verbatim, with no floor/forced conversion',
      (frameRate) => {
        const config = effectiveRenderConfig();
        const media = sourceMedia({ frameRate });

        const profile = buildOutputProfile({ effectiveRenderConfig: config, sourceMedia: media });

        expect(profile.fps).toBe(frameRate);
      },
    );

    it('never silently converts 60 to 30 (the exact bug the Render Fidelity Matrix fixed elsewhere in this pipeline)', () => {
      const config = effectiveRenderConfig();
      const media = sourceMedia({ frameRate: '60' });

      const profile = buildOutputProfile({ effectiveRenderConfig: config, sourceMedia: media });

      expect(profile.fps).toBe('60');
      expect(profile.fps).not.toBe('30');
    });

    it('never silently converts 30 to 24', () => {
      const config = effectiveRenderConfig();
      const media = sourceMedia({ frameRate: '30' });

      const profile = buildOutputProfile({ effectiveRenderConfig: config, sourceMedia: media });

      expect(profile.fps).toBe('30');
      expect(profile.fps).not.toBe('24');
    });

    it('passes null through unchanged when the source frame rate could not be resolved', () => {
      const config = effectiveRenderConfig();
      const media = sourceMedia({ frameRate: null });

      const profile = buildOutputProfile({ effectiveRenderConfig: config, sourceMedia: media });

      expect(profile.fps).toBeNull();
    });
  });

  describe('codec / pixel format - one canonical, fixed representation', () => {
    it('always resolves libx264 / aac / yuv420p', () => {
      const profile = buildOutputProfile({
        effectiveRenderConfig: effectiveRenderConfig(),
        sourceMedia: sourceMedia(),
      });

      expect(profile.videoCodec).toBe('libx264');
      expect(profile.audioCodec).toBe('aac');
      expect(profile.pixelFormat).toBe('yuv420p');
    });
  });

  describe('quality - carried through unchanged, never redesigned', () => {
    it.each([
      ['maximum_quality', 18],
      ['balanced', 23],
      ['small_size', 28],
    ] as const)(
      'carries %s through as qualityPreset with its existing CRF value %d unchanged',
      (qualityPreset, crf) => {
        const config = effectiveRenderConfig({
          processingOptions: processingOptionsFixture({ export: { qualityPreset } }),
        });

        const profile = buildOutputProfile({
          effectiveRenderConfig: config,
          sourceMedia: sourceMedia(),
        });

        expect(profile.qualityPreset).toBe(qualityPreset);
        expect(profile.qualityCrf).toBe(crf);
      },
    );

    it('resolves null/null when no quality preset is configured (unchanged existing default)', () => {
      const config = effectiveRenderConfig({ processingOptions: null });

      const profile = buildOutputProfile({
        effectiveRenderConfig: config,
        sourceMedia: sourceMedia(),
      });

      expect(profile.qualityPreset).toBeNull();
      expect(profile.qualityCrf).toBeNull();
    });
  });

  describe('audio - passed through unchanged, never silently upmixed', () => {
    it('preserves a mono source as mono (never converts 1 -> 2)', () => {
      const profile = buildOutputProfile({
        effectiveRenderConfig: effectiveRenderConfig(),
        sourceMedia: sourceMedia({ audioChannels: 1 }),
      });

      expect(profile.audioChannels).toBe(1);
    });

    it('preserves a stereo source as stereo', () => {
      const profile = buildOutputProfile({
        effectiveRenderConfig: effectiveRenderConfig(),
        sourceMedia: sourceMedia({ audioChannels: 2 }),
      });

      expect(profile.audioChannels).toBe(2);
    });

    it('carries the given audioSampleRate straight through unchanged', () => {
      const profile = buildOutputProfile({
        effectiveRenderConfig: effectiveRenderConfig(),
        sourceMedia: sourceMedia({ audioSampleRate: 48000 }),
      });

      expect(profile.audioSampleRate).toBe(48000);
    });
  });

  describe('architectural boundary - no AI decisions, no clip-generation config, no verification', () => {
    it('produces an object with exactly the OutputProfile shape - no extra fields leaked through', () => {
      const profile = buildOutputProfile({
        effectiveRenderConfig: effectiveRenderConfig(),
        sourceMedia: sourceMedia(),
      });

      expect(Object.keys(profile).sort()).toEqual(
        [
          'aspectRatio',
          'audioChannels',
          'audioCodec',
          'audioSampleRate',
          'fps',
          'height',
          'pixelFormat',
          'qualityCrf',
          'qualityPreset',
          'resolutionPreset',
          'videoCodec',
          'width',
        ].sort(),
      );
    });
  });
});

// Same shape/fixture-builder convention as build-effective-render-config.spec.ts's own
// processingOptionsFixture().
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
