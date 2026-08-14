import type { RenderPlan } from '@speedora/contracts';
import {
  buildEffectiveRenderConfig,
  buildOutputProfile,
  buildRenderPlan,
} from '@speedora/render-config';
import type { CompilerResolvedInputs } from './render-plan-compiler';
import { compileRenderPlan } from './render-plan-compiler';

// Same "chain the real upstream functions rather than hand-roll a fixture" approach Phase 1-3's
// own spec files already established - proves the compiler against a REAL RenderPlan, not a
// stubbed one.
function renderPlan(overrides: Partial<Parameters<typeof buildRenderPlan>[0]> = {}): RenderPlan {
  const effectiveRenderConfig = buildEffectiveRenderConfig({
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
  });
  const outputProfile = buildOutputProfile({
    effectiveRenderConfig,
    sourceMedia: {
      width: 1920,
      height: 1080,
      frameRate: '30000/1001',
      audioSampleRate: 44100,
      audioChannels: 2,
    },
  });
  return buildRenderPlan({
    clipId: 'clip-1',
    videoId: 'video-1',
    effectiveRenderConfig,
    outputProfile,
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
  });
}

function resolvedInputs(overrides: Partial<CompilerResolvedInputs> = {}): CompilerResolvedInputs {
  return {
    sourcePath: '/tmp/speedora/source-1.mp4',
    outputPath: '/tmp/speedora/output-1.mp4',
    trimmedPath: '',
    reactionHoldPath: '',
    introConcatPath: '',
    outroConcatPath: '',
    subtitlesPath: null,
    watermarkPath: null,
    introPath: null,
    outroPath: null,
    brollOverlayPaths: [],
    cuts: [],
    sourceAudioChannels: null,
    reframe: {
      outputWidth: 608,
      outputHeight: 1080,
      width: 608,
      height: 1080,
      x: 0,
      y: 0,
      sendCmdPath: null,
    },
    ...overrides,
  };
}

describe('compileRenderPlan', () => {
  // 1. empty/minimal plan + 2. renderClip only
  it('compiles a minimal plan to exactly one renderClip pass when nothing else was decided', () => {
    const plan = compileRenderPlan(renderPlan(), resolvedInputs());

    expect(plan.clipId).toBe('clip-1');
    expect(plan.videoId).toBe('video-1');
    expect(plan.passes).toHaveLength(1);
    expect(plan.passes[0].pass).toBe('renderClip');
  });

  it('renderClip always runs first, using the requested time range and resolved source/output paths', () => {
    const plan = compileRenderPlan(
      renderPlan({ requestedStartTime: 5, requestedEndTime: 35 }),
      resolvedInputs({ sourcePath: '/tmp/source.mp4', outputPath: '/tmp/output.mp4' }),
    );

    const renderClipPass = plan.passes[0];
    if (renderClipPass.pass !== 'renderClip') throw new Error('expected renderClip pass');
    expect(renderClipPass.args).toMatchObject({
      inputPath: '/tmp/source.mp4',
      outputPath: '/tmp/output.mp4',
      startTime: 5,
      endTime: 35,
    });
  });

  // 3. cuts
  describe('trimCutRanges - cuts', () => {
    it('includes trimCutRanges with the real cut ranges and correct totalOutputDuration when cuts exist', () => {
      const cuts = [{ start: 5, end: 8 }];
      const plan = compileRenderPlan(
        renderPlan({ requestedStartTime: 0, requestedEndTime: 30 }),
        resolvedInputs({ cuts, outputPath: '/tmp/output.mp4', trimmedPath: '/tmp/trimmed.mp4' }),
      );

      const trimPass = plan.passes.find((p) => p.pass === 'trimCutRanges');
      expect(trimPass).toBeDefined();
      if (trimPass?.pass !== 'trimCutRanges') throw new Error('expected trimCutRanges pass');
      const [inputPath, outputPath, argCuts, totalOutputDuration] = trimPass.args;
      expect(inputPath).toBe('/tmp/output.mp4');
      expect(outputPath).toBe('/tmp/trimmed.mp4');
      expect(argCuts).toEqual(cuts);
      expect(totalOutputDuration).toBe(27); // 30 - 3
    });

    it('skips (omits) trimCutRanges entirely when there are no cuts', () => {
      const plan = compileRenderPlan(renderPlan(), resolvedInputs({ cuts: [] }));

      expect(plan.passes.some((p) => p.pass === 'trimCutRanges')).toBe(false);
    });
  });

  // 4. reaction holds
  describe('applyReactionHolds - reaction holds', () => {
    it('includes applyReactionHolds with the real hold instants when RenderPlan.holds has entries', () => {
      const plan = compileRenderPlan(
        renderPlan({ reactionHoldInstants: [5.2, 12.8], reactionHoldDurationSeconds: 1.0 }),
        resolvedInputs({ outputPath: '/tmp/output.mp4', reactionHoldPath: '/tmp/hold.mp4' }),
      );

      const holdPass = plan.passes.find((p) => p.pass === 'applyReactionHolds');
      expect(holdPass).toBeDefined();
      if (holdPass?.pass !== 'applyReactionHolds')
        throw new Error('expected applyReactionHolds pass');
      const [inputPath, outputPath, holdInstants] = holdPass.args;
      expect(inputPath).toBe('/tmp/output.mp4');
      expect(outputPath).toBe('/tmp/hold.mp4');
      expect(holdInstants).toEqual([5.2, 12.8]);
    });

    it('skips (omits) applyReactionHolds entirely when there are no hold instants (matches its own throw-if-empty contract)', () => {
      const plan = compileRenderPlan(
        renderPlan({ reactionHoldInstants: [], reactionHoldDurationSeconds: 0 }),
        resolvedInputs(),
      );

      expect(plan.passes.some((p) => p.pass === 'applyReactionHolds')).toBe(false);
    });

    it('chains a cuts pass into the reaction-hold pass input when both are present', () => {
      const plan = compileRenderPlan(
        renderPlan({ reactionHoldInstants: [5], reactionHoldDurationSeconds: 0.5 }),
        resolvedInputs({
          cuts: [{ start: 1, end: 2 }],
          trimmedPath: '/tmp/trimmed.mp4',
          reactionHoldPath: '/tmp/hold.mp4',
        }),
      );

      const holdPass = plan.passes.find((p) => p.pass === 'applyReactionHolds');
      if (holdPass?.pass !== 'applyReactionHolds')
        throw new Error('expected applyReactionHolds pass');
      expect(holdPass.args[0]).toBe('/tmp/trimmed.mp4');
    });
  });

  // 5. intro, 6. outro, 7. intro + outro
  describe('concatBrandSegment - intro/outro', () => {
    function withIntroOutro(introConfigured: boolean, outroConfigured: boolean) {
      return renderPlan({
        effectiveRenderConfig: buildEffectiveRenderConfig({
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
            intro: introConfigured
              ? { key: 'brand/intro.mp4', type: 'video', imageDurationSeconds: null }
              : null,
            outro: outroConfigured
              ? { key: 'brand/outro.png', type: 'image', imageDurationSeconds: 3 }
              : null,
          },
          featureFlags: {
            ocrHighlightEnabled: false,
            focusShiftEnabled: false,
            digitalPushEnabled: false,
            reactionHoldEnabled: false,
            pauseHoldEnabled: false,
            speakerAwareFocusShiftEnabled: false,
          },
        }),
      });
    }

    it('includes a concatBrandSegment(start) pass when intro is configured and introPath is resolved', () => {
      const plan = compileRenderPlan(
        withIntroOutro(true, false),
        resolvedInputs({
          outputPath: '/tmp/output.mp4',
          introPath: '/tmp/intro.mp4',
          introConcatPath: '/tmp/with-intro.mp4',
        }),
      );

      const introPass = plan.passes.find(
        (p) => p.pass === 'concatBrandSegment' && p.position === 'start',
      );
      expect(introPass).toBeDefined();
      if (introPass?.pass !== 'concatBrandSegment') throw new Error('expected concatBrandSegment');
      const [position, clipPath, segment, , , outputPath] = introPass.args;
      expect(position).toBe('start');
      expect(clipPath).toBe('/tmp/output.mp4');
      expect(segment).toEqual({
        filePath: '/tmp/intro.mp4',
        type: 'video',
        imageDurationSeconds: null,
      });
      expect(outputPath).toBe('/tmp/with-intro.mp4');
    });

    it('includes a concatBrandSegment(end) pass when outro is configured and outroPath is resolved', () => {
      const plan = compileRenderPlan(
        withIntroOutro(false, true),
        resolvedInputs({
          outputPath: '/tmp/output.mp4',
          outroPath: '/tmp/outro.png',
          outroConcatPath: '/tmp/with-outro.mp4',
        }),
      );

      const outroPass = plan.passes.find(
        (p) => p.pass === 'concatBrandSegment' && p.position === 'end',
      );
      expect(outroPass).toBeDefined();
      if (outroPass?.pass !== 'concatBrandSegment') throw new Error('expected concatBrandSegment');
      const [position, , segment] = outroPass.args;
      expect(position).toBe('end');
      expect(segment).toEqual({
        filePath: '/tmp/outro.png',
        type: 'image',
        imageDurationSeconds: 3,
      });
    });

    it('includes both concatBrandSegment passes, intro before outro, chaining intro output into outro input, when both are configured', () => {
      const plan = compileRenderPlan(
        withIntroOutro(true, true),
        resolvedInputs({
          outputPath: '/tmp/output.mp4',
          introPath: '/tmp/intro.mp4',
          introConcatPath: '/tmp/with-intro.mp4',
          outroPath: '/tmp/outro.png',
          outroConcatPath: '/tmp/with-outro.mp4',
        }),
      );

      const brandPasses = plan.passes.filter((p) => p.pass === 'concatBrandSegment');
      expect(brandPasses).toHaveLength(2);
      expect(brandPasses[0].pass === 'concatBrandSegment' && brandPasses[0].position).toBe('start');
      expect(brandPasses[1].pass === 'concatBrandSegment' && brandPasses[1].position).toBe('end');

      const outroPass = brandPasses[1];
      if (outroPass.pass !== 'concatBrandSegment') throw new Error('expected concatBrandSegment');
      // Outro's clipPath is the intro pass's own output, not the original renderClip output -
      // proves correct chaining, not both branding passes reading the same stale input.
      expect(outroPass.args[1]).toBe('/tmp/with-intro.mp4');
    });

    it('skips both concatBrandSegment passes when neither is configured', () => {
      const plan = compileRenderPlan(renderPlan(), resolvedInputs());

      expect(plan.passes.some((p) => p.pass === 'concatBrandSegment')).toBe(false);
    });
  });

  // 8. B-roll
  describe('B-roll propagation into the renderClip pass', () => {
    it('joins RenderPlan.overlays.broll with resolvedPaths.brollOverlayPaths by (keyword, startTime)', () => {
      const plan = compileRenderPlan(
        renderPlan({ broll: [{ keyword: 'rocket', startTime: 3, endTime: 5.5 }] }),
        resolvedInputs({
          brollOverlayPaths: [
            { keyword: 'rocket', startTime: 3, filePath: '/tmp/broll-final.mov' },
          ],
        }),
      );

      const renderClipPass = plan.passes[0];
      if (renderClipPass.pass !== 'renderClip') throw new Error('expected renderClip pass');
      expect(renderClipPass.args.broll).toEqual([
        { filePath: '/tmp/broll-final.mov', startTime: 3, endTime: 5.5 },
      ]);
    });

    it('skips a B-roll moment with no matching resolved path rather than throwing', () => {
      const plan = compileRenderPlan(
        renderPlan({ broll: [{ keyword: 'rocket', startTime: 3, endTime: 5.5 }] }),
        resolvedInputs({ brollOverlayPaths: [] }),
      );

      const renderClipPass = plan.passes[0];
      if (renderClipPass.pass !== 'renderClip') throw new Error('expected renderClip pass');
      expect(renderClipPass.args.broll).toEqual([]);
    });
  });

  // 9. complete plan
  it('compiles a complete plan covering every pass in the correct order', () => {
    const config = buildEffectiveRenderConfig({
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
      featureFlags: {
        ocrHighlightEnabled: false,
        focusShiftEnabled: false,
        digitalPushEnabled: false,
        reactionHoldEnabled: false,
        pauseHoldEnabled: false,
        speakerAwareFocusShiftEnabled: false,
      },
    });
    const plan = compileRenderPlan(
      renderPlan({
        effectiveRenderConfig: config,
        reactionHoldInstants: [12],
        reactionHoldDurationSeconds: 0.5,
        broll: [{ keyword: 'rocket', startTime: 3, endTime: 5.5 }],
      }),
      resolvedInputs({
        cuts: [{ start: 1, end: 2 }],
        watermarkPath: '/tmp/watermark.png',
        introPath: '/tmp/intro.mp4',
        outroPath: '/tmp/outro.png',
        brollOverlayPaths: [{ keyword: 'rocket', startTime: 3, filePath: '/tmp/broll-final.mov' }],
      }),
    );

    expect(plan.passes.map((p) => p.pass)).toEqual([
      'renderClip',
      'trimCutRanges',
      'applyReactionHolds',
      'concatBrandSegment',
      'concatBrandSegment',
    ]);
  });

  // 10. pass ordering
  it('never produces an out-of-order sequence (branding before cuts, holds before renderClip, outro before intro)', () => {
    const config = buildEffectiveRenderConfig({
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
        intro: { key: 'brand/intro.mp4', type: 'video', imageDurationSeconds: null },
        outro: { key: 'brand/outro.png', type: 'image', imageDurationSeconds: 3 },
      },
      featureFlags: {
        ocrHighlightEnabled: false,
        focusShiftEnabled: false,
        digitalPushEnabled: false,
        reactionHoldEnabled: false,
        pauseHoldEnabled: false,
        speakerAwareFocusShiftEnabled: false,
      },
    });
    const plan = compileRenderPlan(
      renderPlan({
        effectiveRenderConfig: config,
        reactionHoldInstants: [5],
        reactionHoldDurationSeconds: 0.5,
      }),
      resolvedInputs({
        cuts: [{ start: 1, end: 2 }],
        introPath: '/tmp/intro.mp4',
        outroPath: '/tmp/outro.png',
      }),
    );

    const passNames = plan.passes.map((p) =>
      p.pass === 'concatBrandSegment' ? `${p.pass}:${p.position}` : p.pass,
    );
    expect(passNames).toEqual([
      'renderClip',
      'trimCutRanges',
      'applyReactionHolds',
      'concatBrandSegment:start',
      'concatBrandSegment:end',
    ]);
  });

  // 11. path propagation
  it('propagates the real resolved paths through to the correct pass arguments, not placeholders', () => {
    const plan = compileRenderPlan(
      renderPlan({ reactionHoldInstants: [5], reactionHoldDurationSeconds: 0.5 }),
      resolvedInputs({
        cuts: [{ start: 1, end: 2 }],
        sourcePath: '/tmp/src.mp4',
        outputPath: '/tmp/out.mp4',
        trimmedPath: '/tmp/trim.mp4',
        reactionHoldPath: '/tmp/hold.mp4',
      }),
    );

    const [renderClipPass, trimPass, holdPass] = plan.passes;
    if (renderClipPass.pass !== 'renderClip') throw new Error('expected renderClip');
    if (trimPass.pass !== 'trimCutRanges') throw new Error('expected trimCutRanges');
    if (holdPass.pass !== 'applyReactionHolds') throw new Error('expected applyReactionHolds');
    expect(renderClipPass.args.inputPath).toBe('/tmp/src.mp4');
    expect(renderClipPass.args.outputPath).toBe('/tmp/out.mp4');
    expect(trimPass.args[0]).toBe('/tmp/out.mp4');
    expect(trimPass.args[1]).toBe('/tmp/trim.mp4');
    expect(holdPass.args[0]).toBe('/tmp/trim.mp4');
    expect(holdPass.args[1]).toBe('/tmp/hold.mp4');
  });

  // 12. deterministic output
  it('is deterministic: the same RenderPlan + resolvedPaths produce a deep-equal plan every call', () => {
    const plan1Input = renderPlan({
      reactionHoldInstants: [5],
      reactionHoldDurationSeconds: 0.5,
      broll: [{ keyword: 'rocket', startTime: 3, endTime: 5.5 }],
    });
    const resolvedInput = resolvedInputs({
      cuts: [{ start: 1, end: 2 }],
      brollOverlayPaths: [{ keyword: 'rocket', startTime: 3, filePath: '/tmp/broll.mov' }],
    });

    const first = compileRenderPlan(plan1Input, resolvedInput);
    const second = compileRenderPlan(plan1Input, resolvedInput);

    expect(first).toEqual(second);
  });

  // 13. skipped optional passes (broader confirmation across all 4 optional passes at once)
  it('omits every optional pass when RenderPlan shows nothing decided beyond the requested span', () => {
    const plan = compileRenderPlan(renderPlan(), resolvedInputs());

    expect(plan.passes).toEqual([expect.objectContaining({ pass: 'renderClip' })]);
  });

  // 14. exact relevant argument propagation - quality/fps/audioChannels threaded from OutputProfile
  it('threads quality/fps/audioChannels from the embedded OutputProfile into every relevant pass', () => {
    const config = buildEffectiveRenderConfig({
      clipId: 'clip-1',
      videoId: 'video-1',
      sourceWidth: 1920,
      sourceHeight: 1080,
      processingOptions: {
        export: { qualityPreset: 'maximum_quality', aspectRatio: null, resolutionTier: null },
        smartCrop: { zoomInFraction: null },
        broll: { enabled: true, maxCutaways: null },
        sceneAnalysis: {
          detectSceneCuts: true,
          detectMotionEnergy: true,
          detectCameraMotion: true,
        },
      },
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
    });
    const outputProfile = buildOutputProfile({
      effectiveRenderConfig: config,
      sourceMedia: {
        width: 1920,
        height: 1080,
        frameRate: '60',
        audioSampleRate: 44100,
        audioChannels: 1,
      },
    });
    const plan = compileRenderPlan(
      renderPlan({
        effectiveRenderConfig: config,
        outputProfile,
        reactionHoldInstants: [5],
        reactionHoldDurationSeconds: 0.5,
      }),
      resolvedInputs({ cuts: [{ start: 1, end: 2 }] }),
    );

    const [renderClipPass, trimPass, holdPass] = plan.passes;
    if (renderClipPass.pass !== 'renderClip') throw new Error('expected renderClip');
    if (trimPass.pass !== 'trimCutRanges') throw new Error('expected trimCutRanges');
    if (holdPass.pass !== 'applyReactionHolds') throw new Error('expected applyReactionHolds');

    expect(renderClipPass.args.quality).toEqual({ preset: 'slow', crf: 18 });
    expect(trimPass.args[4]).toEqual({ preset: 'slow', crf: 18 }); // quality
    expect(trimPass.args[5]).toBe('60'); // frameRate
    expect(trimPass.args[6]).toBe(1); // audioChannels
    expect(holdPass.args[4]).toEqual({ preset: 'slow', crf: 18 }); // quality
    expect(holdPass.args[5]).toBe(1); // audioChannels
  });

  it('resolves quality to null when no qualityPreset is configured (unchanged existing default)', () => {
    const plan = compileRenderPlan(renderPlan(), resolvedInputs());

    const renderClipPass = plan.passes[0];
    if (renderClipPass.pass !== 'renderClip') throw new Error('expected renderClip');
    expect(renderClipPass.args.quality).toBeNull();
  });
});
