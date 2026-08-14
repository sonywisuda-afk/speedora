const renderClipMock = jest.fn();
const trimCutRangesMock = jest.fn();
const applyReactionHoldsMock = jest.fn();
const concatBrandSegmentMock = jest.fn();

jest.mock('./ffmpeg', () => ({
  renderClip: (...args: unknown[]) => renderClipMock(...args),
  trimCutRanges: (...args: unknown[]) => trimCutRangesMock(...args),
  applyReactionHolds: (...args: unknown[]) => applyReactionHoldsMock(...args),
  concatBrandSegment: (...args: unknown[]) => concatBrandSegmentMock(...args),
  REACTION_HOLD_EXTENSION_SECONDS: 0.5,
}));

import { executeCompiledRenderPlan, isRenderExecutionCompilerEnabled } from './execute-render-plan';
import {
  buildEffectiveRenderConfig,
  buildOutputProfile,
  buildRenderPlan,
} from '@speedora/render-config';
import { compileRenderPlan } from './render-plan-compiler';
import type { CompiledPass, FfmpegExecutionPlan } from './render-plan-compiler';

const renderClipArgs = (overrides: Partial<Record<string, unknown>> = {}) => ({
  inputPath: 'source.mp4',
  startTime: 0,
  endTime: 10,
  subtitlesPath: null,
  outputPath: 'output.mp4',
  reframe: null,
  broll: [],
  watermark: null,
  quality: null,
  sourceAudioChannels: null,
  ...overrides,
});

function plan(passes: CompiledPass[]): FfmpegExecutionPlan {
  return { clipId: 'clip-1', videoId: 'video-1', passes };
}

describe('isRenderExecutionCompilerEnabled', () => {
  const original = process.env.RENDER_EXECUTION_COMPILER_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.RENDER_EXECUTION_COMPILER_ENABLED;
    else process.env.RENDER_EXECUTION_COMPILER_ENABLED = original;
  });

  it('defaults to false when unset', () => {
    delete process.env.RENDER_EXECUTION_COMPILER_ENABLED;
    expect(isRenderExecutionCompilerEnabled()).toBe(false);
  });

  it('is false for anything other than the literal string "true"', () => {
    process.env.RENDER_EXECUTION_COMPILER_ENABLED = '1';
    expect(isRenderExecutionCompilerEnabled()).toBe(false);
    process.env.RENDER_EXECUTION_COMPILER_ENABLED = 'TRUE';
    expect(isRenderExecutionCompilerEnabled()).toBe(false);
  });

  it('is true only for the literal string "true"', () => {
    process.env.RENDER_EXECUTION_COMPILER_ENABLED = 'true';
    expect(isRenderExecutionCompilerEnabled()).toBe(true);
  });
});

describe('executeCompiledRenderPlan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    renderClipMock.mockResolvedValue(undefined);
    trimCutRangesMock.mockResolvedValue(undefined);
    applyReactionHoldsMock.mockResolvedValue(undefined);
    concatBrandSegmentMock.mockResolvedValue(undefined);
  });

  it('runs renderClip only for a minimal plan, renderedPath === finalOutputPath', async () => {
    const outcome = await executeCompiledRenderPlan(
      plan([{ pass: 'renderClip', args: renderClipArgs() }]),
    );
    expect(renderClipMock).toHaveBeenCalledWith(renderClipArgs());
    expect(outcome).toEqual({
      renderedPath: 'output.mp4',
      finalOutputPath: 'output.mp4',
      trimApplied: false,
      reactionHoldInstants: [],
      reactionHoldDurationSeconds: 0,
    });
  });

  it('propagates an unhandled renderClip failure (REQUIRED pass, no try/catch)', async () => {
    renderClipMock.mockRejectedValue(new Error('ffmpeg exploded'));
    await expect(
      executeCompiledRenderPlan(plan([{ pass: 'renderClip', args: renderClipArgs() }])),
    ).rejects.toThrow('ffmpeg exploded');
  });

  it('applies trimCutRanges on success: renderedPath/finalOutputPath advance, trimApplied true', async () => {
    const cuts = [{ start: 1, end: 2 }];
    const outcome = await executeCompiledRenderPlan(
      plan([
        { pass: 'renderClip', args: renderClipArgs() },
        {
          pass: 'trimCutRanges',
          args: ['output.mp4', 'trimmed.mp4', cuts, 9, null, null, null],
        },
      ]),
    );
    expect(trimCutRangesMock).toHaveBeenCalledWith(
      'output.mp4',
      'trimmed.mp4',
      cuts,
      9,
      null,
      null,
      null,
    );
    expect(outcome.renderedPath).toBe('trimmed.mp4');
    expect(outcome.finalOutputPath).toBe('trimmed.mp4');
    expect(outcome.trimApplied).toBe(true);
  });

  it('falls back to the pre-trim render when trimCutRanges fails - trimApplied stays false, no throw', async () => {
    trimCutRangesMock.mockRejectedValue(new Error('trim failed'));
    const outcome = await executeCompiledRenderPlan(
      plan([
        { pass: 'renderClip', args: renderClipArgs() },
        {
          pass: 'trimCutRanges',
          args: ['output.mp4', 'trimmed.mp4', [{ start: 1, end: 2 }], 9, null, null, null],
        },
      ]),
    );
    expect(outcome.renderedPath).toBe('output.mp4');
    expect(outcome.finalOutputPath).toBe('output.mp4');
    expect(outcome.trimApplied).toBe(false);
  });

  it('applies reaction holds on success: renderedPath advances, instants/duration recorded', async () => {
    const outcome = await executeCompiledRenderPlan(
      plan([
        { pass: 'renderClip', args: renderClipArgs() },
        {
          pass: 'applyReactionHolds',
          args: ['output.mp4', 'held.mp4', [3, 6], 0.5, null, null],
        },
      ]),
    );
    expect(applyReactionHoldsMock).toHaveBeenCalledWith(
      'output.mp4',
      'held.mp4',
      [3, 6],
      0.5,
      null,
      null,
    );
    expect(outcome.renderedPath).toBe('held.mp4');
    expect(outcome.finalOutputPath).toBe('held.mp4');
    expect(outcome.reactionHoldInstants).toEqual([3, 6]);
    expect(outcome.reactionHoldDurationSeconds).toBe(1);
  });

  it('falls back to the pre-hold render when applyReactionHolds fails - instants stay [], no throw', async () => {
    applyReactionHoldsMock.mockRejectedValue(new Error('hold failed'));
    const outcome = await executeCompiledRenderPlan(
      plan([
        { pass: 'renderClip', args: renderClipArgs() },
        {
          pass: 'applyReactionHolds',
          args: ['output.mp4', 'held.mp4', [3], 0.5, null, null],
        },
      ]),
    );
    expect(outcome.renderedPath).toBe('output.mp4');
    expect(outcome.reactionHoldInstants).toEqual([]);
    expect(outcome.reactionHoldDurationSeconds).toBe(0);
  });

  it('applies intro concatBrandSegment on success: finalOutputPath advances, renderedPath does NOT', async () => {
    const outcome = await executeCompiledRenderPlan(
      plan([
        { pass: 'renderClip', args: renderClipArgs() },
        {
          pass: 'concatBrandSegment',
          position: 'start',
          args: [
            'start',
            'output.mp4',
            { filePath: 'intro.mp4', type: 'video', imageDurationSeconds: null },
            1080,
            1920,
            'with-intro.mp4',
            null,
            null,
            null,
          ],
        },
      ]),
    );
    expect(concatBrandSegmentMock).toHaveBeenCalledWith(
      'start',
      'output.mp4',
      { filePath: 'intro.mp4', type: 'video', imageDurationSeconds: null },
      1080,
      1920,
      'with-intro.mp4',
      null,
      null,
      null,
    );
    expect(outcome.finalOutputPath).toBe('with-intro.mp4');
    // renderedPath must stay the pre-intro render - thumbnail/blur-placeholder/storyboard
    // extraction reads renderedPath, never a generic intro/outro card.
    expect(outcome.renderedPath).toBe('output.mp4');
  });

  it('falls back to the pre-intro render when intro concatBrandSegment fails, no throw', async () => {
    concatBrandSegmentMock.mockRejectedValue(new Error('concat failed'));
    const outcome = await executeCompiledRenderPlan(
      plan([
        { pass: 'renderClip', args: renderClipArgs() },
        {
          pass: 'concatBrandSegment',
          position: 'start',
          args: [
            'start',
            'output.mp4',
            { filePath: 'intro.mp4', type: 'video', imageDurationSeconds: null },
            1080,
            1920,
            'with-intro.mp4',
            null,
            null,
            null,
          ],
        },
      ]),
    );
    expect(outcome.finalOutputPath).toBe('output.mp4');
  });

  it('chains outro concatBrandSegment onto whatever intro already produced', async () => {
    const outcome = await executeCompiledRenderPlan(
      plan([
        { pass: 'renderClip', args: renderClipArgs() },
        {
          pass: 'concatBrandSegment',
          position: 'start',
          args: [
            'start',
            'output.mp4',
            { filePath: 'intro.mp4', type: 'video', imageDurationSeconds: null },
            1080,
            1920,
            'with-intro.mp4',
            null,
            null,
            null,
          ],
        },
        {
          pass: 'concatBrandSegment',
          position: 'end',
          args: [
            'end',
            'with-intro.mp4',
            { filePath: 'outro.mp4', type: 'video', imageDurationSeconds: null },
            1080,
            1920,
            'with-outro.mp4',
            null,
            null,
            null,
          ],
        },
      ]),
    );
    expect(concatBrandSegmentMock).toHaveBeenNthCalledWith(
      2,
      'end',
      'with-intro.mp4',
      { filePath: 'outro.mp4', type: 'video', imageDurationSeconds: null },
      1080,
      1920,
      'with-outro.mp4',
      null,
      null,
      null,
    );
    expect(outcome.finalOutputPath).toBe('with-outro.mp4');
    expect(outcome.renderedPath).toBe('output.mp4');
  });

  it('runs every pass in exact plan order: renderClip -> trim -> holds -> intro -> outro', async () => {
    const callOrder: string[] = [];
    renderClipMock.mockImplementation(async () => {
      callOrder.push('renderClip');
    });
    trimCutRangesMock.mockImplementation(async () => {
      callOrder.push('trimCutRanges');
    });
    applyReactionHoldsMock.mockImplementation(async () => {
      callOrder.push('applyReactionHolds');
    });
    concatBrandSegmentMock.mockImplementation(async (position: string) => {
      callOrder.push(`concatBrandSegment:${position}`);
    });

    await executeCompiledRenderPlan(
      plan([
        { pass: 'renderClip', args: renderClipArgs() },
        {
          pass: 'trimCutRanges',
          args: ['output.mp4', 'trimmed.mp4', [], 10, null, null, null],
        },
        {
          pass: 'applyReactionHolds',
          args: ['trimmed.mp4', 'held.mp4', [3], 0.5, null, null],
        },
        {
          pass: 'concatBrandSegment',
          position: 'start',
          args: [
            'start',
            'held.mp4',
            { filePath: 'intro.mp4', type: 'video', imageDurationSeconds: null },
            1080,
            1920,
            'with-intro.mp4',
            null,
            null,
            null,
          ],
        },
        {
          pass: 'concatBrandSegment',
          position: 'end',
          args: [
            'end',
            'with-intro.mp4',
            { filePath: 'outro.mp4', type: 'video', imageDurationSeconds: null },
            1080,
            1920,
            'with-outro.mp4',
            null,
            null,
            null,
          ],
        },
      ]),
    );

    expect(callOrder).toEqual([
      'renderClip',
      'trimCutRanges',
      'applyReactionHolds',
      'concatBrandSegment:start',
      'concatBrandSegment:end',
    ]);
  });

  it('an empty pass list resolves with empty/default outcome fields (never throws)', async () => {
    const outcome = await executeCompiledRenderPlan(plan([]));
    expect(outcome).toEqual({
      renderedPath: '',
      finalOutputPath: '',
      trimApplied: false,
      reactionHoldInstants: [],
      reactionHoldDurationSeconds: 0,
    });
  });

  // Execution-parity fixture (Phase 5 approval's own requirement) - proves
  // executeCompiledRenderPlan() correctly interprets a REAL compileRenderPlan() output (not a
  // hand-built fixture), exercising the exact same @speedora/render-config chain
  // render-clip.worker.ts's own flag=true branch uses, end to end.
  it('correctly executes a REAL compiled plan built via the full RenderPlan -> compileRenderPlan chain', async () => {
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
        frameRate: '30',
        audioSampleRate: 44100,
        audioChannels: 2,
      },
    });
    const cuts = [{ start: 2, end: 3 }];
    const realRenderPlan = buildRenderPlan({
      clipId: 'clip-1',
      videoId: 'video-1',
      effectiveRenderConfig,
      outputProfile,
      requestedStartTime: 0,
      requestedEndTime: 10,
      trimApplied: cuts.length > 0,
      removedSeconds: 1,
      reactionHoldInstants: [],
      reactionHoldDurationSeconds: 0,
      cropPath: null,
      reframeHints: [],
      broll: [],
    });
    const realPlan = compileRenderPlan(realRenderPlan, {
      sourcePath: 'source.mp4',
      outputPath: 'output.mp4',
      trimmedPath: 'trimmed.mp4',
      reactionHoldPath: '',
      introConcatPath: '',
      outroConcatPath: '',
      subtitlesPath: null,
      watermarkPath: null,
      introPath: null,
      outroPath: null,
      brollOverlayPaths: [],
      cuts,
      sourceAudioChannels: 2,
      reframe: { outputWidth: 1080, outputHeight: 1920, sendCmdPath: null, crop: null } as never,
    });

    const outcome = await executeCompiledRenderPlan(realPlan);

    expect(renderClipMock).toHaveBeenCalledTimes(1);
    expect(trimCutRangesMock).toHaveBeenCalledTimes(1);
    expect(applyReactionHoldsMock).not.toHaveBeenCalled();
    expect(concatBrandSegmentMock).not.toHaveBeenCalled();
    expect(outcome.renderedPath).toBe('trimmed.mp4');
    expect(outcome.trimApplied).toBe(true);
  });
});
