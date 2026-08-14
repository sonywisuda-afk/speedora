import type {
  BuildOutputProfileInput,
  BuildRenderManifestInput,
  OutputProfile,
} from '@speedora/contracts';
import { buildEffectiveRenderConfig } from './build-effective-render-config';
import { buildOutputProfile } from './build-output-profile';
import { buildRenderManifest } from './build-render-manifest';

// Same "chain the real upstream functions rather than hand-roll a fixture" approach every earlier
// phase's own spec already established - RenderManifest embeds OutputProfile verbatim, so
// building it for real (not stubbing) is what actually proves embedding works.
function outputProfile(overrides: Partial<BuildOutputProfileInput> = {}): OutputProfile {
  return buildOutputProfile({
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
    }),
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

// Every field required by BuildRenderManifestInput, with sensible "renderClip only, nothing else
// ran" defaults - tests override only what they care about, same convention as every earlier
// phase's own spec.
function baseInput(overrides: Partial<BuildRenderManifestInput> = {}): BuildRenderManifestInput {
  return {
    clipId: 'clip-1',
    videoId: 'video-1',
    outputProfile: outputProfile(),
    passes: ['renderClip'],
    trimApplied: false,
    reactionHoldInstants: [],
    reactionHoldDurationSeconds: 0,
    introApplied: false,
    outroApplied: false,
    outputKey: 'renders/clip-1.mp4',
    sizeBytes: 654321,
    checksumMd5: 'd41d8cd98f00b204e9800998ecf8427e',
    ...overrides,
  };
}

describe('buildRenderManifest', () => {
  // 1. contract validation (implicit on every call - renderManifestSchema.parse() throws on a
  // real shape violation) + minimal render manifest
  it('builds a valid minimal manifest for a renderClip-only render', () => {
    const manifest = buildRenderManifest(baseInput());

    expect(manifest.version).toBe(1);
    expect(manifest.clipId).toBe('clip-1');
    expect(manifest.videoId).toBe('video-1');
    expect(manifest.execution).toEqual({
      passes: ['renderClip'],
      trimApplied: false,
      reactionHoldCount: 0,
      reactionHoldDurationSeconds: 0,
      introApplied: false,
      outroApplied: false,
    });
  });

  // 2. no reaction holds (covered by the minimal case above) + 3. multiple reaction holds
  it('captures multiple reaction hold instants as a count, plus their total duration', () => {
    const manifest = buildRenderManifest(
      baseInput({
        passes: ['renderClip', 'applyReactionHolds'],
        reactionHoldInstants: [2.5, 8.1, 15.75],
        reactionHoldDurationSeconds: 1.5,
      }),
    );

    expect(manifest.execution.reactionHoldCount).toBe(3);
    expect(manifest.execution.reactionHoldDurationSeconds).toBe(1.5);
  });

  // 4. intro only
  it('reports introApplied: true, outroApplied: false for an intro-only render', () => {
    const manifest = buildRenderManifest(
      baseInput({
        passes: ['renderClip', 'concatBrandSegment:start'],
        introApplied: true,
        outroApplied: false,
      }),
    );

    expect(manifest.execution.introApplied).toBe(true);
    expect(manifest.execution.outroApplied).toBe(false);
  });

  // 5. outro only
  it('reports outroApplied: true, introApplied: false for an outro-only render', () => {
    const manifest = buildRenderManifest(
      baseInput({
        passes: ['renderClip', 'concatBrandSegment:end'],
        introApplied: false,
        outroApplied: true,
      }),
    );

    expect(manifest.execution.introApplied).toBe(false);
    expect(manifest.execution.outroApplied).toBe(true);
  });

  // 6. intro + outro
  it('reports both introApplied and outroApplied: true when both ran', () => {
    const manifest = buildRenderManifest(
      baseInput({
        passes: ['renderClip', 'concatBrandSegment:start', 'concatBrandSegment:end'],
        introApplied: true,
        outroApplied: true,
      }),
    );

    expect(manifest.execution.introApplied).toBe(true);
    expect(manifest.execution.outroApplied).toBe(true);
  });

  // 7. trim applied
  it('reports trimApplied: true only when the trim pass genuinely succeeded', () => {
    const manifest = buildRenderManifest(
      baseInput({ passes: ['renderClip', 'trimCutRanges'], trimApplied: true }),
    );

    expect(manifest.execution.trimApplied).toBe(true);
  });

  // 8. full five-pass execution
  it('captures the full 5-pass sequence when every optional pass genuinely succeeded', () => {
    const manifest = buildRenderManifest(
      baseInput({
        passes: [
          'renderClip',
          'trimCutRanges',
          'applyReactionHolds',
          'concatBrandSegment:start',
          'concatBrandSegment:end',
        ],
        trimApplied: true,
        reactionHoldInstants: [5, 12],
        reactionHoldDurationSeconds: 1,
        introApplied: true,
        outroApplied: true,
      }),
    );

    expect(manifest.execution).toEqual({
      passes: [
        'renderClip',
        'trimCutRanges',
        'applyReactionHolds',
        'concatBrandSegment:start',
        'concatBrandSegment:end',
      ],
      trimApplied: true,
      reactionHoldCount: 2,
      reactionHoldDurationSeconds: 1,
      introApplied: true,
      outroApplied: true,
    });
  });

  // 9. expectedOutput faithfully copied from OutputProfile
  it('embeds the exact given OutputProfile verbatim as expectedOutput, never re-deriving it', () => {
    const profile = outputProfile({
      sourceMedia: {
        width: 3840,
        height: 2160,
        frameRate: '60',
        audioSampleRate: 48000,
        audioChannels: 1,
      },
    });
    const manifest = buildRenderManifest(baseInput({ outputProfile: profile }));

    // toEqual (deep equality), not toBe - buildRenderManifest()'s own defense-in-depth
    // renderManifestSchema.parse() call legitimately constructs a new object graph (Zod's own
    // documented behavior), so reference identity isn't preserved even though nothing was
    // rebuilt/re-derived.
    expect(manifest.expectedOutput).toEqual(profile);
  });

  // 10. file metadata faithfully copied
  it('carries outputKey/sizeBytes/checksumMd5 straight through, unmodified', () => {
    const manifest = buildRenderManifest(
      baseInput({
        outputKey: 'renders/clip-42.mp4',
        sizeBytes: 12345678,
        checksumMd5: 'abc123def456',
      }),
    );

    expect(manifest.file).toEqual({
      outputKey: 'renders/clip-42.mp4',
      sizeBytes: 12345678,
      checksumMd5: 'abc123def456',
    });
  });

  // schema shape check
  it('produces an object that satisfies its own schema shape - exactly the expected top-level keys', () => {
    const manifest = buildRenderManifest(baseInput());

    expect(Object.keys(manifest).sort()).toEqual(
      ['version', 'clipId', 'videoId', 'execution', 'expectedOutput', 'file'].sort(),
    );
  });

  // 11. deterministic output
  it('is deterministic: the same input produces a deep-equal manifest every call', () => {
    const input = baseInput({
      passes: ['renderClip', 'trimCutRanges'],
      trimApplied: true,
      reactionHoldInstants: [5],
      reactionHoldDurationSeconds: 0.5,
      introApplied: true,
    });

    const first = buildRenderManifest(input);
    const second = buildRenderManifest(input);

    expect(first).toEqual(second);
  });
});
