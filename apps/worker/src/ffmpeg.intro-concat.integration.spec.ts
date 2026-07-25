// Deliberately NOT jest.mock()'d, unlike ffmpeg.spec.ts's fully-mocked suite - this drives the
// REAL ffmpeg/ffprobe binaries, same posture as ffmpeg.duration.integration.spec.ts. An exact-args
// assertion (ffmpeg.spec.ts's concatIntro tests) can only ever prove the function BUILDS the args
// it intends to - it can't catch an ffmpeg CLI semantic bug (argument-binding, filter-graph
// mismatch, wrong stream count). This test proves the actual concat behavior a mocked test cannot:
// real ffmpeg, real ffprobe, real measured output duration - for both a video intro (with its own
// audio) and a static-image intro (no audio at all, needs the synthesized-silence path).
//
// Confirmed working via a throwaway spike script (P3d, 2026-07-24/25) before this permanent test
// was written - see concatIntro()'s own comment in ffmpeg.ts for the full design rationale
// (trim=/atrim= filters instead of a bare -t flag, specifically to avoid the exact argument-binding
// bug ffmpeg.duration.integration.spec.ts guards against).
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { concatIntro } from './ffmpeg';

const execFileAsync = promisify(execFile);
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH ?? 'ffprobe';

// Same "not always available in this dev sandbox" honesty as
// ffmpeg.duration.integration.spec.ts - skips cleanly rather than breaking `pnpm test` for
// anyone/CI without real ffmpeg on PATH.
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
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return Number(stdout.trim());
}

const describeIfFfmpeg = isFfmpegAvailable() ? describe : describe.skip;

describeIfFfmpeg('concatIntro against real ffmpeg (P3d)', () => {
  let dir: string;
  const OUTPUT_WIDTH = 320;
  const OUTPUT_HEIGHT = 240;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'speedora-intro-concat-it-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it(
    'concatenates a video intro (with its own audio) onto the front of the clip, at the correct total duration',
    async () => {
      const clipPath = path.join(dir, 'clip.mp4');
      const introPath = path.join(dir, 'intro-video.mp4');
      const outputPath = path.join(dir, 'out-video-intro.mp4');

      // Deliberately a DIFFERENT resolution/fps than the clip, so this test actually proves
      // normalization, not just a lucky format match.
      await execFileAsync(FFMPEG_PATH, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:rate=25`,
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-t',
        '5',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        clipPath,
      ]);
      await execFileAsync(FFMPEG_PATH, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=1280x720:rate=24',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:sample_rate=44100',
        '-t',
        '3',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        introPath,
      ]);

      const clipDuration = await ffprobeDuration(clipPath);

      await concatIntro(
        clipPath,
        { filePath: introPath, type: 'video', imageDurationSeconds: null },
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT,
        outputPath,
      );

      const actualDuration = await ffprobeDuration(outputPath);
      // The intro's own real duration (3s) is what concatIntro() uses (uncapped here, well under
      // MAX_INTRO_DURATION_SECONDS) - expected total is ~3s intro + ~5s clip.
      expect(Math.abs(actualDuration - (3 + clipDuration))).toBeLessThan(1.5);
    },
    30000,
  );

  it(
    'concatenates a static-image intro (synthesized silent audio) onto the front of the clip, held for its configured duration',
    async () => {
      const clipPath = path.join(dir, 'clip2.mp4');
      const introPath = path.join(dir, 'intro-image.png');
      const outputPath = path.join(dir, 'out-image-intro.mp4');

      await execFileAsync(FFMPEG_PATH, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:rate=25`,
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-t',
        '4',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        clipPath,
      ]);
      await execFileAsync(FFMPEG_PATH, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=1080x1080',
        '-frames:v',
        '1',
        introPath,
      ]);

      const clipDuration = await ffprobeDuration(clipPath);
      const imageDurationSeconds = 2.5;

      await concatIntro(
        clipPath,
        { filePath: introPath, type: 'image', imageDurationSeconds },
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT,
        outputPath,
      );

      const actualDuration = await ffprobeDuration(outputPath);
      expect(Math.abs(actualDuration - (imageDurationSeconds + clipDuration))).toBeLessThan(1.5);

      // Confirms the output actually has an audio stream at all (the synthesized silence made
      // it into the mux, rather than the concat silently dropping the audio branch).
      const { stdout } = await execFileAsync(FFPROBE_PATH, [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'csv=p=0',
        outputPath,
      ]);
      expect(stdout.trim().length).toBeGreaterThan(0);
    },
    30000,
  );
});
