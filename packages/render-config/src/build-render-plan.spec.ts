import type {
  BuildEffectiveRenderConfigInput,
  BuildOutputProfileInput,
  BuildRenderPlanInput,
  EffectiveRenderConfig,
  OutputProfile,
} from '@speedora/contracts';
import { buildEffectiveRenderConfig } from './build-effective-render-config';
import { buildOutputProfile } from './build-output-profile';
import { buildRenderPlan } from './build-render-plan';

// Same "chain the real upstream functions rather than hand-roll a fixture" approach Phase 2's own
// spec already established - RenderPlan embeds these verbatim, so building them for real (not
// stubbing) is what actually proves embedding works.
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

function outputProfile(overrides: Partial<BuildOutputProfileInput> = {}): OutputProfile {
  return buildOutputProfile({
    effectiveRenderConfig: effectiveRenderConfig(),
    sourceMedia: {
      width: 1920,
      height: 1080,
      frameRate: '30000/1001',
      audioSampleRate: 44100,
      audioChannels: 2,
    },
    ...overrides,
  });
}

// Every field required by BuildRenderPlanInput, with sensible "nothing decided" defaults - tests
// override only what they care about, same convention as Phase 1/2's own spec files.
function baseInput(overrides: Partial<BuildRenderPlanInput> = {}): BuildRenderPlanInput {
  return {
    clipId: 'clip-1',
    videoId: 'video-1',
    effectiveRenderConfig: effectiveRenderConfig(),
    outputProfile: outputProfile(),
    requestedStartTime: 10,
    requestedEndTime: 40,
    trimApplied: false,
    removedSeconds: 0,
    reactionHoldInstants: [],
    reactionHoldDurationSeconds: 0,
    cropPath: null,
    reframeHints: [],
    broll: [],
    ...overrides,
  };
}

describe('buildRenderPlan', () => {
  // 1. minimal plan
  it('builds a valid minimal plan when nothing beyond the requested span was decided', () => {
    const plan = buildRenderPlan(baseInput());

    expect(plan.version).toBe(1);
    expect(plan.clipId).toBe('clip-1');
    expect(plan.videoId).toBe('video-1');
    expect(plan.holds).toEqual({ reactionHoldInstants: [], reactionHoldDurationSeconds: 0 });
    expect(plan.framing).toEqual({ cropPath: null, reframeHints: [] });
    expect(plan.overlays).toEqual({
      broll: [],
      watermark: false,
      intro: false,
      outro: false,
    });
  });

  // 2. complete plan
  it('builds a complete plan with every section populated', () => {
    const config = effectiveRenderConfig({
      clipOverrides: {
        captionStyle: 'KARAOKE',
        speakerColorCaptions: true,
        smartSegmentation: false,
        dynamicCaptions: false,
        captionLanguage: null,
        fontFamily: 'Poppins',
        watermark: {
          key: 'brand/watermark.png',
          opacity: 0.8,
          scale: 0.15,
          margin: 0.03,
          position: 'BOTTOM_RIGHT',
        },
        intro: { key: 'brand/intro.mp4', type: 'video', imageDurationSeconds: null },
        outro: { key: 'brand/outro.png', type: 'image', imageDurationSeconds: 3 },
      },
    });
    const plan = buildRenderPlan(
      baseInput({
        effectiveRenderConfig: config,
        trimApplied: true,
        removedSeconds: 2.5,
        reactionHoldInstants: [5.2, 12.8],
        reactionHoldDurationSeconds: 1.0,
        cropPath: [{ t: 0, x: 0, y: 0, width: 608, height: 1080 }],
        reframeHints: [{ start: 1, end: 3, x: 10, y: 20, width: 100, height: 40 }],
        broll: [{ keyword: 'rocket', startTime: 4, endTime: 6.5 }],
      }),
    );

    expect(plan.holds.reactionHoldInstants).toEqual([5.2, 12.8]);
    expect(plan.framing.cropPath).toEqual([{ t: 0, x: 0, y: 0, width: 608, height: 1080 }]);
    expect(plan.overlays.broll).toEqual([{ keyword: 'rocket', startTime: 4, endTime: 6.5 }]);
    expect(plan.overlays.watermark).toBe(true);
    expect(plan.overlays.intro).toBe(true);
    expect(plan.overlays.outro).toBe(true);
  });

  // 3. requested vs effective duration
  describe('timeline: requestedDurationSeconds vs. effectiveDurationSeconds', () => {
    it('resolves both to the same value when nothing changed the duration', () => {
      const plan = buildRenderPlan(baseInput({ requestedStartTime: 10, requestedEndTime: 40 }));

      expect(plan.timeline.requestedDurationSeconds).toBe(30);
      expect(plan.timeline.effectiveDurationSeconds).toBe(30);
    });

    it('shrinks effectiveDurationSeconds by removedSeconds only when trimApplied is true', () => {
      const plan = buildRenderPlan(
        baseInput({
          requestedStartTime: 0,
          requestedEndTime: 30,
          trimApplied: true,
          removedSeconds: 5,
        }),
      );

      expect(plan.timeline.requestedDurationSeconds).toBe(30);
      expect(plan.timeline.effectiveDurationSeconds).toBe(25);
    });

    it('ignores removedSeconds when trimApplied is false (the trim pass never actually ran)', () => {
      const plan = buildRenderPlan(
        baseInput({
          requestedStartTime: 0,
          requestedEndTime: 30,
          trimApplied: false,
          removedSeconds: 5,
        }),
      );

      expect(plan.timeline.effectiveDurationSeconds).toBe(30);
    });
  });

  // 4. reaction hold duration + 5. multiple reaction hold instants
  describe('reaction holds grow effectiveDurationSeconds', () => {
    it('grows effectiveDurationSeconds by reactionHoldDurationSeconds (example from the design: 30.0s + 1.2s = 31.2s)', () => {
      const plan = buildRenderPlan(
        baseInput({
          requestedStartTime: 0,
          requestedEndTime: 30,
          reactionHoldInstants: [12],
          reactionHoldDurationSeconds: 1.2,
        }),
      );

      expect(plan.timeline.requestedDurationSeconds).toBe(30);
      expect(plan.timeline.effectiveDurationSeconds).toBeCloseTo(31.2);
    });

    it('captures multiple reaction hold instants and their combined duration', () => {
      const plan = buildRenderPlan(
        baseInput({
          reactionHoldInstants: [2.5, 8.1, 15.75],
          reactionHoldDurationSeconds: 1.5,
        }),
      );

      expect(plan.holds.reactionHoldInstants).toEqual([2.5, 8.1, 15.75]);
      expect(plan.holds.reactionHoldDurationSeconds).toBe(1.5);
    });

    it('combines cuts shrinking and holds growing the duration in the same plan', () => {
      const plan = buildRenderPlan(
        baseInput({
          requestedStartTime: 0,
          requestedEndTime: 30,
          trimApplied: true,
          removedSeconds: 3,
          reactionHoldDurationSeconds: 0.5,
        }),
      );

      expect(plan.timeline.effectiveDurationSeconds).toBeCloseTo(27.5);
    });
  });

  // 6. crop path preservation + 7. null crop path
  describe('framing.cropPath', () => {
    it('preserves a real, already-computed crop path verbatim', () => {
      const cropPath = [
        { t: 0, x: 0, y: 0, width: 608, height: 1080 },
        { t: 1.5, x: 40, y: 0, width: 608, height: 1080 },
      ];
      const plan = buildRenderPlan(baseInput({ cropPath }));

      expect(plan.framing.cropPath).toEqual(cropPath);
    });

    it('preserves null (a static center crop was used) rather than inventing an empty array', () => {
      const plan = buildRenderPlan(baseInput({ cropPath: null }));

      expect(plan.framing.cropPath).toBeNull();
    });
  });

  // 8. OCR reframe hints
  it('preserves OCR reframe hints (reframeHints) verbatim', () => {
    const reframeHints = [
      { start: 0.5, end: 2, x: 10, y: 20, width: 200, height: 60 },
      { start: 5, end: 6.2, x: 15, y: 25, width: 180, height: 50 },
    ];
    const plan = buildRenderPlan(baseInput({ reframeHints }));

    expect(plan.framing.reframeHints).toEqual(reframeHints);
  });

  // 9. B-roll keyword preservation + 10. multiple B-roll overlays
  describe('overlays.broll', () => {
    it("preserves a single overlay's keyword/startTime/endTime", () => {
      const plan = buildRenderPlan(
        baseInput({ broll: [{ keyword: 'spaceship', startTime: 3, endTime: 5.5 }] }),
      );

      expect(plan.overlays.broll).toEqual([{ keyword: 'spaceship', startTime: 3, endTime: 5.5 }]);
    });

    it('preserves multiple B-roll overlays in order', () => {
      const broll = [
        { keyword: 'rocket', startTime: 1, endTime: 3.5 },
        { keyword: 'moon', startTime: 8, endTime: 10.5 },
        { keyword: 'stars', startTime: 15, endTime: 17.5 },
      ];
      const plan = buildRenderPlan(baseInput({ broll }));

      expect(plan.overlays.broll).toEqual(broll);
    });

    it('never leaks an ephemeral scratch filePath into the plan, even if the input carried one', () => {
      // Simulates the real adapter's widened BRollOverlay shape (filePath + keyword) - only
      // {keyword, startTime, endTime} should ever survive into the plan.
      const brollWithFilePath = [
        { keyword: 'rocket', startTime: 1, endTime: 3.5, filePath: '/tmp/speedora/broll-1.mov' },
      ] as unknown as BuildRenderPlanInput['broll'];
      const plan = buildRenderPlan(baseInput({ broll: brollWithFilePath }));

      expect(plan.overlays.broll).toEqual([{ keyword: 'rocket', startTime: 1, endTime: 3.5 }]);
      expect(JSON.stringify(plan.overlays.broll)).not.toContain('filePath');
    });
  });

  // 11. watermark, 12. intro, 13. outro
  describe('overlays.watermark / intro / outro - presence-only, derived from effectiveRenderConfig.branding', () => {
    it('resolves all three to false when none are configured', () => {
      const plan = buildRenderPlan(baseInput());

      expect(plan.overlays).toMatchObject({ watermark: false, intro: false, outro: false });
    });

    it('resolves watermark: true only when effectiveRenderConfig.branding.watermark is configured', () => {
      const config = effectiveRenderConfig({
        clipOverrides: {
          captionStyle: 'DEFAULT',
          speakerColorCaptions: false,
          smartSegmentation: false,
          dynamicCaptions: false,
          captionLanguage: null,
          fontFamily: null,
          watermark: {
            key: 'brand/watermark.png',
            opacity: 0.8,
            scale: 0.15,
            margin: 0.03,
            position: 'BOTTOM_RIGHT',
          },
          intro: null,
          outro: null,
        },
      });
      const plan = buildRenderPlan(baseInput({ effectiveRenderConfig: config }));

      expect(plan.overlays).toMatchObject({ watermark: true, intro: false, outro: false });
    });

    it('resolves intro: true only when effectiveRenderConfig.branding.intro is configured', () => {
      const config = effectiveRenderConfig({
        clipOverrides: {
          captionStyle: 'DEFAULT',
          speakerColorCaptions: false,
          smartSegmentation: false,
          dynamicCaptions: false,
          captionLanguage: null,
          fontFamily: null,
          watermark: null,
          intro: { key: 'brand/intro.mp4', type: 'video', imageDurationSeconds: null },
          outro: null,
        },
      });
      const plan = buildRenderPlan(baseInput({ effectiveRenderConfig: config }));

      expect(plan.overlays).toMatchObject({ watermark: false, intro: true, outro: false });
    });

    it('resolves outro: true only when effectiveRenderConfig.branding.outro is configured', () => {
      const config = effectiveRenderConfig({
        clipOverrides: {
          captionStyle: 'DEFAULT',
          speakerColorCaptions: false,
          smartSegmentation: false,
          dynamicCaptions: false,
          captionLanguage: null,
          fontFamily: null,
          watermark: null,
          intro: null,
          outro: { key: 'brand/outro.png', type: 'image', imageDurationSeconds: 3 },
        },
      });
      const plan = buildRenderPlan(baseInput({ effectiveRenderConfig: config }));

      expect(plan.overlays).toMatchObject({ watermark: false, intro: false, outro: true });
    });
  });

  // 14. crossfade
  it('always echoes the fixed 0.15s crossfade policy, unconditionally', () => {
    const plan = buildRenderPlan(baseInput());

    expect(plan.transitions).toEqual({ crossfadeSeconds: 0.15 });
  });

  // 15. EffectiveRenderConfig embedding
  it('embeds the exact given EffectiveRenderConfig verbatim, never rebuilding it', () => {
    const config = effectiveRenderConfig({
      processingOptions: null,
      clipOverrides: {
        captionStyle: 'BOLD_HIGHLIGHT',
        speakerColorCaptions: true,
        smartSegmentation: false,
        dynamicCaptions: false,
        captionLanguage: 'fr',
        fontFamily: 'Oswald',
        watermark: null,
        intro: null,
        outro: null,
      },
    });
    const plan = buildRenderPlan(baseInput({ effectiveRenderConfig: config }));

    // toEqual (deep equality), not toBe - buildRenderPlan()'s own defense-in-depth
    // renderPlanSchema.parse() call legitimately constructs a new object graph (Zod's own
    // documented behavior), so reference identity isn't preserved even though nothing was
    // rebuilt/re-derived.
    expect(plan.effectiveRenderConfig).toEqual(config);
  });

  // 16. OutputProfile embedding
  it('embeds the exact given OutputProfile verbatim, never re-deriving width/height/fps', () => {
    const profile = outputProfile({
      sourceMedia: {
        width: 3840,
        height: 2160,
        frameRate: '60',
        audioSampleRate: 48000,
        audioChannels: 1,
      },
    });
    const plan = buildRenderPlan(baseInput({ outputProfile: profile }));

    // Same toEqual-not-toBe reasoning as the EffectiveRenderConfig embedding test above.
    expect(plan.outputProfile).toEqual(profile);
  });

  // 17. schema validation
  it('produces an object that satisfies its own schema shape - exactly the expected top-level keys', () => {
    const plan = buildRenderPlan(baseInput());

    expect(Object.keys(plan).sort()).toEqual(
      [
        'version',
        'clipId',
        'videoId',
        'effectiveRenderConfig',
        'outputProfile',
        'timeline',
        'holds',
        'framing',
        'overlays',
        'transitions',
      ].sort(),
    );
  });

  // 18. deterministic output
  it('is deterministic: the same input produces a deep-equal plan every call', () => {
    const input = baseInput({
      trimApplied: true,
      removedSeconds: 2,
      reactionHoldInstants: [5],
      reactionHoldDurationSeconds: 0.5,
      cropPath: [{ t: 0, x: 0, y: 0, width: 608, height: 1080 }],
      reframeHints: [{ start: 1, end: 2, x: 5, y: 5, width: 50, height: 50 }],
      broll: [{ keyword: 'rocket', startTime: 3, endTime: 5.5 }],
    });

    const first = buildRenderPlan(input);
    const second = buildRenderPlan(input);

    expect(first).toEqual(second);
  });
});
