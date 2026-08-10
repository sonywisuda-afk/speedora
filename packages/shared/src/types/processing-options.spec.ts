import {
  DEFAULT_PROCESSING_OPTIONS,
  migrateProcessingOptions,
  PROCESSING_OPTIONS_VERSION,
} from './processing-options';

describe('migrateProcessingOptions', () => {
  it('returns defaults for null/undefined', () => {
    expect(migrateProcessingOptions(null)).toEqual(DEFAULT_PROCESSING_OPTIONS);
    expect(migrateProcessingOptions(undefined)).toEqual(DEFAULT_PROCESSING_OPTIONS);
  });

  it('returns defaults for a non-object value', () => {
    expect(migrateProcessingOptions('not an object')).toEqual(DEFAULT_PROCESSING_OPTIONS);
    expect(migrateProcessingOptions(42)).toEqual(DEFAULT_PROCESSING_OPTIONS);
  });

  it('returns defaults for an unrecognized/missing version (including the pre-versioning flat shape)', () => {
    expect(migrateProcessingOptions({ clipCount: 5 })).toEqual(DEFAULT_PROCESSING_OPTIONS);
    expect(migrateProcessingOptions({ version: 999, clipGeneration: { clipCount: 5 } })).toEqual(
      DEFAULT_PROCESSING_OPTIONS,
    );
  });

  it('passes a fully-populated current-version value through with real values preserved', () => {
    const value = {
      version: PROCESSING_OPTIONS_VERSION,
      project: { name: 'My Project', tags: ['a', 'b'] },
      clipGeneration: { clipCount: 5, minClipDurationSeconds: 30, maxClipDurationSeconds: 90 },
      subtitle: { captionStyle: 'KARAOKE', speakerColorCaptions: true, fontFamily: 'Poppins' },
      export: { qualityPreset: 'maximum_quality' },
      sceneAnalysis: {
        detectSceneCuts: false,
        detectMotionEnergy: true,
        detectCameraMotion: false,
      },
      highlightFocus: { intents: ['educate'], confidenceThreshold: 60 },
      smartCrop: { zoomInFraction: 0.5 },
      brandKit: { applyBrandKit: false, templateId: 'template-1' },
      seo: { autoGeneratePlatformCopy: true, platforms: ['TIKTOK', 'YOUTUBE'] },
      publishing: {
        autoPublish: true,
        socialAccountIds: ['account-1'],
        scheduledAt: '2026-08-01T00:00:00.000Z',
      },
      thumbnail: { preferredSignals: ['faceClarity', 'emotion'] },
      broll: { enabled: false, maxCutaways: 4 },
    };

    expect(migrateProcessingOptions(value)).toEqual(value);
  });

  it('fills in a missing group from defaults rather than leaving it undefined (partial/malformed stored value)', () => {
    const partial = {
      version: PROCESSING_OPTIONS_VERSION,
      subtitle: { captionStyle: 'KARAOKE', speakerColorCaptions: true, fontFamily: 'Poppins' },
    };

    const result = migrateProcessingOptions(partial);

    expect(result.clipGeneration).toEqual(DEFAULT_PROCESSING_OPTIONS.clipGeneration);
    expect(result.sceneAnalysis).toEqual(DEFAULT_PROCESSING_OPTIONS.sceneAnalysis);
    expect(result.brandKit).toEqual(DEFAULT_PROCESSING_OPTIONS.brandKit);
    expect(result.seo).toEqual(DEFAULT_PROCESSING_OPTIONS.seo);
    expect(result.publishing).toEqual(DEFAULT_PROCESSING_OPTIONS.publishing);
    expect(result.thumbnail).toEqual(DEFAULT_PROCESSING_OPTIONS.thumbnail);
    expect(result.broll).toEqual(DEFAULT_PROCESSING_OPTIONS.broll);
    expect(result.subtitle).toEqual(partial.subtitle);
  });

  it('fills in individual missing fields within a present group from defaults', () => {
    const partial = {
      version: PROCESSING_OPTIONS_VERSION,
      clipGeneration: { clipCount: 5 },
    };

    const result = migrateProcessingOptions(partial);

    expect(result.clipGeneration).toEqual({
      clipCount: 5,
      minClipDurationSeconds: null,
      maxClipDurationSeconds: null,
    });
  });

  // AI B-roll Recommendation UI control.
  it('fills in a missing broll.maxCutaways from defaults while preserving a present broll.enabled', () => {
    const partial = {
      version: PROCESSING_OPTIONS_VERSION,
      broll: { enabled: false },
    };

    const result = migrateProcessingOptions(partial);

    expect(result.broll).toEqual({ enabled: false, maxCutaways: null });
  });
});
