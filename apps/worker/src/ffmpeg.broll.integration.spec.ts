// Deliberately NOT jest.mock()'d, unlike ffmpeg.spec.ts's fully-mocked suite - this drives the
// REAL ffmpeg/ffprobe binaries, the exact same describeIfFfmpeg-skip / mkdtempSync-scratch-dir /
// real lavfi test media template ffmpeg.reaction-hold.integration.spec.ts, ffmpeg.brand-segment-
// concat.integration.spec.ts, and ffmpeg.crossfade.integration.spec.ts already established. An
// exact-args assertion (ffmpeg.spec.ts's trimAndFadeInBRoll/fadeOutBRoll/B-roll-overlay tests) can
// only ever prove these functions BUILD the args they intend to - it can't catch an ffmpeg CLI
// semantic bug (a botched fade/alpha filter, a normalization step that silently no-ops, an overlay
// enable window landing at the wrong instant, a composite that changes the clip's own duration).
// This is the AI B-roll Recommendation feature's own real-render acceptance gate - see
// docs/ai/broll-recommendation.md, whose "Explicitly deferred" section named the lack of exactly
// this kind of test as a real, standing gap.
//
// Deliberately does NOT call any live network/third-party API (Pexels/Pixabay/Unsplash/Clearbit) -
// that would make this suite flaky and dependent on secrets in CI. Everything downstream of "an
// asset file already sits on local disk" is real ffmpeg and fully exercised here; the network/
// adapter layer above it (stockAssetService.ts, logoAdapter.ts/pexelsAdapter.ts/etc.) already has
// its own mocked unit coverage.
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { BROLL_DURATION_SECONDS, BROLL_FADE_SECONDS } from './broll';
import { fadeOutBRoll, renderClip, trimAndFadeInBRoll } from './ffmpeg';

const execFileAsync = promisify(execFile);
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH ?? 'ffprobe';

function isFfmpegAvailable(): boolean {
  try {
    execFileSync(FFMPEG_PATH, ['-version'], { stdio: 'ignore' });
    execFileSync(FFPROBE_PATH, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function ffprobeDuration(file: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return Number(stdout.trim());
}

async function ffprobeDimensions(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0',
    file,
  ]);
  const [width, height] = stdout.trim().split(',').map(Number);
  return { width, height };
}

async function ffprobePixFmt(file: string): Promise<string> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=pix_fmt',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return stdout.trim();
}

// Downsamples the alpha plane at a specific instant to a single pixel (scale=1:1) and reads its
// raw gray byte directly - accurate, real-ffmpeg-computed proof of "how transparent is this frame"
// (0 = fully transparent, 255 = fully opaque), without needing to decode/parse a full frame.
// -ss placed AFTER -i (not before) is a deliberate accuracy choice - qtrle's own frames are all
// intra-coded so either seek mode would be frame-exact for trimAndFadeInBRoll/fadeOutBRoll's own
// output, but the FINAL composited output (libx264, real inter-frame prediction) needs the
// accurate post-input seek to land on the exact requested instant rather than the nearest keyframe.
async function alphaByteAt(file: string, t: number): Promise<number> {
  const { stdout } = await execFileAsync(
    FFMPEG_PATH,
    [
      '-i',
      file,
      '-ss',
      String(t),
      '-frames:v',
      '1',
      '-vf',
      'alphaextract,scale=1:1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 },
  );
  return (stdout as Buffer)[0];
}

// Same downsample-to-a-single-pixel idiom as alphaByteAt above, applied to the final composited
// (no-alpha) RGB output - used to confirm WHICH color is actually on screen at a given instant
// (the main clip's own color vs. the B-roll overlay's), the observable proof that the overlay
// filter's enable=between(...) window and setpts offset actually land where they're supposed to.
async function averageRgbAt(file: string, t: number): Promise<{ r: number; g: number; b: number }> {
  const { stdout } = await execFileAsync(
    FFMPEG_PATH,
    [
      '-i',
      file,
      '-ss',
      String(t),
      '-frames:v',
      '1',
      '-vf',
      'scale=1:1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 },
  );
  const buf = stdout as Buffer;
  return { r: buf[0], g: buf[1], b: buf[2] };
}

const describeIfFfmpeg = isFfmpegAvailable() ? describe : describe.skip;

describeIfFfmpeg('AI B-roll Recommendation against real ffmpeg (item 8)', () => {
  let dir: string;
  const WIDTH = 320;
  const HEIGHT = 240;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'speedora-broll-it-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // A DIFFERENT size/fps than the target WIDTH/HEIGHT/BROLL_TARGET_FPS - deliberately, so a
  // passing dimension/fps assertion actually proves trimAndFadeInBRoll's own scale+crop+fps
  // normalization ran for real, not merely that a pass-through file already matched.
  async function makeStockVideoAsset(name: string, color: string): Promise<string> {
    const assetPath = path.join(dir, name);
    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:size=640x480:rate=60`,
      '-t',
      '5',
      '-c:v',
      'libx264',
      '-an',
      assetPath,
    ]);
    return assetPath;
  }

  async function makeStockImageAsset(name: string, color: string): Promise<string> {
    const assetPath = path.join(dir, name);
    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:size=800x600`,
      '-frames:v',
      '1',
      assetPath,
    ]);
    return assetPath;
  }

  describe('trimAndFadeInBRoll', () => {
    it('trims a video asset to BROLL_DURATION_SECONDS, normalizes to the target dimensions, and produces a genuine alpha channel', async () => {
      const assetPath = await makeStockVideoAsset('video-asset.mp4', 'blue');
      const outputPath = path.join(dir, 'trimmed-video.mov');

      await trimAndFadeInBRoll(
        assetPath,
        outputPath,
        WIDTH,
        HEIGHT,
        BROLL_DURATION_SECONDS,
        BROLL_FADE_SECONDS,
        'video',
      );

      const duration = await ffprobeDuration(outputPath);
      const dimensions = await ffprobeDimensions(outputPath);
      const pixFmt = await ffprobePixFmt(outputPath);

      expect(Math.abs(duration - BROLL_DURATION_SECONDS)).toBeLessThan(0.15);
      expect(dimensions).toEqual({ width: WIDTH, height: HEIGHT });
      // A real finding from running this against actual ffmpeg, not an assumption: the filter
      // chain's own format=yuva420p only sets the FILTER GRAPH's pixel format going into the
      // encoder - the qtrle encoder itself re-converts to whichever pixel format it natively
      // supports, which turns out to be 'argb', not a pass-through of yuva420p. Still genuinely
      // alpha-capable (the 'a' channel), just not the exact string the filter chain requests -
      // the actual fade-in/fade-out behavior is what the next two tests verify numerically.
      expect(pixFmt).toBe('argb');
    }, 30000);

    it('fades alpha in from near-transparent at t=0 to fully opaque by BROLL_FADE_SECONDS', async () => {
      const assetPath = await makeStockVideoAsset('fade-in-asset.mp4', 'blue');
      const outputPath = path.join(dir, 'fade-in.mov');

      await trimAndFadeInBRoll(
        assetPath,
        outputPath,
        WIDTH,
        HEIGHT,
        BROLL_DURATION_SECONDS,
        BROLL_FADE_SECONDS,
        'video',
      );

      const atStart = await alphaByteAt(outputPath, 0);
      const afterFade = await alphaByteAt(outputPath, BROLL_FADE_SECONDS + 0.1);

      expect(atStart).toBeLessThan(60);
      expect(afterFade).toBeGreaterThan(200);
    }, 30000);

    it('loops a still image via -f image2 -loop 1, producing a real video stream of the requested duration despite the source having no inherent duration', async () => {
      const assetPath = await makeStockImageAsset('image-asset.png', 'green');
      const outputPath = path.join(dir, 'trimmed-image.mov');

      await trimAndFadeInBRoll(
        assetPath,
        outputPath,
        WIDTH,
        HEIGHT,
        BROLL_DURATION_SECONDS,
        BROLL_FADE_SECONDS,
        'image',
      );

      const duration = await ffprobeDuration(outputPath);
      const dimensions = await ffprobeDimensions(outputPath);

      expect(Math.abs(duration - BROLL_DURATION_SECONDS)).toBeLessThan(0.15);
      expect(dimensions).toEqual({ width: WIDTH, height: HEIGHT });
    }, 30000);
  });

  describe('fadeOutBRoll', () => {
    it('fades alpha out from fully opaque mid-clip to near-transparent by the very end, without changing duration', async () => {
      const assetPath = await makeStockVideoAsset('fade-out-source.mp4', 'blue');
      const fadedInPath = path.join(dir, 'faded-in-for-out-test.mov');
      const outputPath = path.join(dir, 'faded-out.mov');

      await trimAndFadeInBRoll(
        assetPath,
        fadedInPath,
        WIDTH,
        HEIGHT,
        BROLL_DURATION_SECONDS,
        BROLL_FADE_SECONDS,
        'video',
      );
      await fadeOutBRoll(fadedInPath, outputPath, BROLL_DURATION_SECONDS, BROLL_FADE_SECONDS);

      const duration = await ffprobeDuration(outputPath);
      const midClip = await alphaByteAt(outputPath, BROLL_DURATION_SECONDS / 2);
      const nearEnd = await alphaByteAt(outputPath, BROLL_DURATION_SECONDS - 0.05);

      expect(Math.abs(duration - BROLL_DURATION_SECONDS)).toBeLessThan(0.15);
      expect(midClip).toBeGreaterThan(200);
      expect(nearEnd).toBeLessThan(60);
    }, 30000);
  });

  describe('renderClip B-roll overlay compositing', () => {
    it('composites a B-roll cutaway onto the main clip exactly within its own time window, without changing the final output duration', async () => {
      const CLIP_DURATION_SECONDS = 8;
      const mainClipPath = path.join(dir, 'main-clip.mp4');
      await execFileAsync(FFMPEG_PATH, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=red:size=${WIDTH}x${HEIGHT}:rate=25`,
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100',
        '-t',
        String(CLIP_DURATION_SECONDS),
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        mainClipPath,
      ]);

      const stockAssetPath = await makeStockVideoAsset('composite-asset.mp4', 'blue');
      const fadedInPath = path.join(dir, 'composite-faded-in.mov');
      const brollFinalPath = path.join(dir, 'composite-final.mov');
      await trimAndFadeInBRoll(
        stockAssetPath,
        fadedInPath,
        WIDTH,
        HEIGHT,
        BROLL_DURATION_SECONDS,
        BROLL_FADE_SECONDS,
        'video',
      );
      await fadeOutBRoll(fadedInPath, brollFinalPath, BROLL_DURATION_SECONDS, BROLL_FADE_SECONDS);

      const overlayStart = 2;
      const overlayEnd = overlayStart + BROLL_DURATION_SECONDS;
      const outputPath = path.join(dir, 'composited.mp4');

      await renderClip({
        inputPath: mainClipPath,
        startTime: 0,
        endTime: CLIP_DURATION_SECONDS,
        subtitlesPath: null,
        outputPath,
        reframe: null,
        broll: [{ filePath: brollFinalPath, startTime: overlayStart, endTime: overlayEnd }],
      });

      const duration = await ffprobeDuration(outputPath);
      // B-roll never extends/truncates the clip - final duration must still match the requested
      // window exactly, not overlayEnd or anything derived from the cutaway's own length.
      expect(Math.abs(duration - CLIP_DURATION_SECONDS)).toBeLessThan(0.15);

      const before = await averageRgbAt(outputPath, 0.5);
      // Well inside the overlay window, comfortably past its own fade-in - the B-roll cutaway
      // should now dominate the frame.
      const during = await averageRgbAt(outputPath, overlayStart + BROLL_FADE_SECONDS + 0.5);
      const after = await averageRgbAt(outputPath, overlayEnd + 0.3);

      // Before the overlay window: pure red main clip, no blue at all.
      expect(before.r).toBeGreaterThan(150);
      expect(before.b).toBeLessThan(60);
      // During the overlay window: blue now dominates over the red base.
      expect(during.b).toBeGreaterThan(150);
      expect(during.b).toBeGreaterThan(during.r);
      // After the overlay window ends: back to pure red, exactly like `before`.
      expect(after.r).toBeGreaterThan(150);
      expect(after.b).toBeLessThan(60);
    }, 45000);
  });
});
