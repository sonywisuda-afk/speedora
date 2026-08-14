import type {
  BuildOutputProfileInput,
  BuildRenderManifestInput,
  OutputProfile,
  ProbedMediaForVerification,
  RenderManifest,
} from '@speedora/contracts';
import { buildEffectiveRenderConfig } from './build-effective-render-config';
import { buildOutputProfile } from './build-output-profile';
import { buildRenderManifest } from './build-render-manifest';
import { compareRenderManifestToProbe } from './compare-render-manifest';

// Same "chain the real upstream functions rather than hand-roll a fixture" approach every earlier
// phase's own spec already established.
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
      frameRate: '30/1',
      audioSampleRate: 44100,
      audioChannels: 2,
    },
    ...overrides,
  });
}

function manifest(overrides: Partial<BuildRenderManifestInput> = {}): RenderManifest {
  return buildRenderManifest({
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
  });
}

// A probe that agrees with the default manifest() above in every field - the "perfect match"
// baseline every test overrides from.
function matchingProbe(
  overrides: Partial<ProbedMediaForVerification> = {},
): ProbedMediaForVerification {
  return {
    width: 608,
    height: 1080,
    fps: 30,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioSampleRate: 44100,
    audioChannels: 2,
    ...overrides,
  };
}

describe('compareRenderManifestToProbe', () => {
  // 1. perfect match + overall PASS
  it('reports every field matching and passed: true when the probe agrees with expectedOutput exactly', () => {
    const result = compareRenderManifestToProbe(manifest(), matchingProbe());

    expect(result.version).toBe(1);
    expect(result.clipId).toBe('clip-1');
    expect(result.videoId).toBe('video-1');
    expect(result.passed).toBe(true);
    for (const field of Object.values(result.fields)) {
      expect(field.matches).toBe(true);
    }
  });

  // 2. dimension mismatch + overall FAIL
  it('reports width/height mismatches and fails overall when the probed dimensions differ', () => {
    const result = compareRenderManifestToProbe(
      manifest(),
      matchingProbe({ width: 600, height: 1070 }),
    );

    expect(result.fields.width).toEqual({ expected: 608, actual: 600, matches: false });
    expect(result.fields.height).toEqual({ expected: 1080, actual: 1070, matches: false });
    expect(result.passed).toBe(false);
  });

  // 3. FPS mismatch (and a same-value-different-representation match case)
  describe('fps', () => {
    it('matches when the probed decimal agrees with the parsed expected fraction within float precision', () => {
      const result = compareRenderManifestToProbe(
        manifest({
          outputProfile: outputProfile({
            sourceMedia: {
              width: 1920,
              height: 1080,
              frameRate: '30000/1001',
              audioSampleRate: 44100,
              audioChannels: 2,
            },
          }),
        }),
        matchingProbe({ fps: 30000 / 1001 }),
      );

      expect(result.fields.fps.matches).toBe(true);
    });

    it('fails when the probed fps genuinely diverges from the expected rate', () => {
      const result = compareRenderManifestToProbe(manifest(), matchingProbe({ fps: 24 }));

      expect(result.fields.fps).toEqual({ expected: 30, actual: 24, matches: false });
      expect(result.passed).toBe(false);
    });

    it('treats null expected and null actual fps as a match (both genuinely unknown)', () => {
      const result = compareRenderManifestToProbe(
        manifest({
          outputProfile: outputProfile({
            sourceMedia: {
              width: 1920,
              height: 1080,
              frameRate: null,
              audioSampleRate: 44100,
              audioChannels: 2,
            },
          }),
        }),
        matchingProbe({ fps: null }),
      );

      expect(result.fields.fps).toEqual({ expected: null, actual: null, matches: true });
    });
  });

  // 4. video codec libx264/h264 semantic match + 5. wrong video codec
  describe('videoCodec', () => {
    it('normalizes the libx264 encoder name to h264 before comparing, and matches', () => {
      const result = compareRenderManifestToProbe(
        manifest(),
        matchingProbe({ videoCodec: 'h264' }),
      );

      expect(result.fields.videoCodec).toEqual({ expected: 'h264', actual: 'h264', matches: true });
    });

    it('fails when the probed video codec genuinely differs', () => {
      const result = compareRenderManifestToProbe(manifest(), matchingProbe({ videoCodec: 'vp9' }));

      expect(result.fields.videoCodec).toEqual({ expected: 'h264', actual: 'vp9', matches: false });
      expect(result.passed).toBe(false);
    });
  });

  // 6. audio codec mismatch (aac already matches identically, no mapping needed)
  describe('audioCodec', () => {
    it('matches aac directly, with no mapping needed', () => {
      const result = compareRenderManifestToProbe(manifest(), matchingProbe({ audioCodec: 'aac' }));

      expect(result.fields.audioCodec).toEqual({ expected: 'aac', actual: 'aac', matches: true });
    });

    it('fails when the probed audio codec genuinely differs', () => {
      const result = compareRenderManifestToProbe(
        manifest(),
        matchingProbe({ audioCodec: 'opus' }),
      );

      expect(result.fields.audioCodec).toEqual({ expected: 'aac', actual: 'opus', matches: false });
      expect(result.passed).toBe(false);
    });
  });

  // 7. audio sample-rate match + 8. audio sample-rate mismatch
  describe('audioSampleRate', () => {
    it('matches when the probed rate equals the declared 44100', () => {
      const result = compareRenderManifestToProbe(
        manifest(),
        matchingProbe({ audioSampleRate: 44100 }),
      );

      expect(result.fields.audioSampleRate).toEqual({
        expected: 44100,
        actual: 44100,
        matches: true,
      });
    });

    it('fails when the probed rate diverges (the exact gap Phase 8 exists to catch)', () => {
      const result = compareRenderManifestToProbe(
        manifest(),
        matchingProbe({ audioSampleRate: 48000 }),
      );

      expect(result.fields.audioSampleRate).toEqual({
        expected: 44100,
        actual: 48000,
        matches: false,
      });
      expect(result.passed).toBe(false);
    });
  });

  // 9. channel mismatch
  it('fails audioChannels when the probed channel count differs', () => {
    const result = compareRenderManifestToProbe(manifest(), matchingProbe({ audioChannels: 1 }));

    expect(result.fields.audioChannels).toEqual({ expected: 2, actual: 1, matches: false });
    expect(result.passed).toBe(false);
  });

  // 10. overall FAIL from a single divergent field (already covered above per-field) - one more
  // explicit end-to-end multi-field-divergence case.
  it('fails overall when multiple fields diverge at once', () => {
    const result = compareRenderManifestToProbe(
      manifest(),
      matchingProbe({ width: 100, audioSampleRate: 48000, videoCodec: 'vp9' }),
    );

    expect(result.passed).toBe(false);
    expect(result.fields.width.matches).toBe(false);
    expect(result.fields.audioSampleRate.matches).toBe(false);
    expect(result.fields.videoCodec.matches).toBe(false);
    expect(result.fields.height.matches).toBe(true);
  });

  // 11. deterministic result
  it('is deterministic: the same manifest/probe produce a deep-equal result every call', () => {
    const theManifest = manifest();
    const theProbe = matchingProbe();

    const first = compareRenderManifestToProbe(theManifest, theProbe);
    const second = compareRenderManifestToProbe(theManifest, theProbe);

    expect(first).toEqual(second);
  });

  // schema shape check
  it('produces an object that satisfies its own schema shape - exactly the expected top-level keys', () => {
    const result = compareRenderManifestToProbe(manifest(), matchingProbe());

    expect(Object.keys(result).sort()).toEqual(
      ['version', 'clipId', 'videoId', 'fields', 'passed'].sort(),
    );
    expect(Object.keys(result.fields).sort()).toEqual(
      [
        'width',
        'height',
        'fps',
        'videoCodec',
        'audioCodec',
        'audioChannels',
        'audioSampleRate',
      ].sort(),
    );
  });
});
