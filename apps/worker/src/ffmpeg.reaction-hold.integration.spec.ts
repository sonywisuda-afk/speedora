// Deliberately NOT jest.mock()'d, unlike ffmpeg.spec.ts's fully-mocked suite - this drives the
// REAL ffmpeg/ffprobe binaries, same posture as ffmpeg.brand-segment-concat.integration.spec.ts
// (whose exact template - describeIfFfmpeg skip pattern, local ffprobeDuration()/hasAudioStream()
// helpers, mkdtempSync scratch dir, real lavfi test media - this file follows verbatim). An
// exact-args assertion (ffmpeg.spec.ts's applyReactionHolds tests) can only ever prove the
// function BUILDS the args it intends to - it can't catch an ffmpeg CLI semantic bug (a filter-
// graph label mismatch, wrong segment count reaching concat, a freeze landing at the wrong
// instant, an A/V duration mismatch). This is the real-render acceptance test the C6R design
// explicitly required before C6R.2 could be considered shipped (see docs/ai/
// visual-emphasis-engine.md's "C6R design" section).
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { applyReactionHolds } from './ffmpeg';

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

async function ffprobeAudioDuration(file: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return Number(stdout.trim());
}

async function hasAudioStream(file: string): Promise<boolean> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_type',
    '-of',
    'csv=p=0',
    file,
  ]);
  return stdout.trim().length > 0;
}

// Measures the mean absolute sample amplitude over the whole audio stream via ffmpeg's astats
// filter - used to confirm a hold window is genuinely near-silent (synthesized anullsrc) rather
// than just "some audio", and conversely that the surrounding audio is NOT silent (it's a real
// 440Hz tone), so a broken filter graph that accidentally dropped the tone entirely wouldn't
// silently pass.
async function meanVolumeDb(
  file: string,
  startSeconds: number,
  durationSeconds: number,
): Promise<number> {
  const { stderr } = await execFileAsync(FFMPEG_PATH, [
    '-y',
    '-ss',
    String(startSeconds),
    '-t',
    String(durationSeconds),
    '-i',
    file,
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ]);
  const match = stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)\s*dB/);
  if (!match) {
    throw new Error(`could not parse mean_volume from ffmpeg stderr:\n${stderr}`);
  }
  return match[1] === '-inf' ? -Infinity : Number(match[1]);
}

const describeIfFfmpeg = isFfmpegAvailable() ? describe : describe.skip;

describeIfFfmpeg('applyReactionHolds against real ffmpeg (C6R.2)', () => {
  let dir: string;
  const WIDTH = 320;
  const HEIGHT = 240;
  const CLIP_DURATION_SECONDS = 6;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'speedora-reaction-hold-it-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function makeTestClip(name: string): Promise<string> {
    const clipPath = path.join(dir, name);
    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${WIDTH}x${HEIGHT}:rate=25`,
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
      clipPath,
    ]);
    return clipPath;
  }

  it('extends total duration by exactly one hold duration for a single hold instant', async () => {
    const clipPath = await makeTestClip('single-hold-in.mp4');
    const outputPath = path.join(dir, 'single-hold-out.mp4');
    const holdDurationSeconds = 0.5;

    await applyReactionHolds(clipPath, outputPath, [3], holdDurationSeconds);

    const videoDuration = await ffprobeDuration(outputPath);
    const audioDuration = await ffprobeAudioDuration(outputPath);

    expect(Math.abs(videoDuration - (CLIP_DURATION_SECONDS + holdDurationSeconds))).toBeLessThan(
      0.2,
    );
    // The stated C6R invariant: video and audio must extend by exactly the same amount, at
    // exactly the same point - checked here as "the two streams end up the same duration",
    // the observable consequence of that invariant holding.
    expect(Math.abs(videoDuration - audioDuration)).toBeLessThan(0.1);
  }, 30000);

  it('inserts genuine near-silence at the hold window, with real tone immediately before and after', async () => {
    const clipPath = await makeTestClip('silence-check-in.mp4');
    const outputPath = path.join(dir, 'silence-check-out.mp4');
    const holdDurationSeconds = 1;
    const holdInstant = 3;

    await applyReactionHolds(clipPath, outputPath, [holdInstant], holdDurationSeconds);

    // The pre-hold segment (real tone) should be clearly audible.
    const beforeVolume = await meanVolumeDb(outputPath, 0, 2);
    // The inserted hold window is synthesized silence (anullsrc) - near -inf dB.
    const holdVolume = await meanVolumeDb(
      outputPath,
      holdInstant + 0.05,
      holdDurationSeconds - 0.1,
    );
    // The post-hold segment resumes the real tone.
    const afterVolume = await meanVolumeDb(
      outputPath,
      holdInstant + holdDurationSeconds + 0.2,
      1.5,
    );

    expect(beforeVolume).toBeGreaterThan(-60);
    expect(holdVolume).toBeLessThan(-60);
    expect(afterVolume).toBeGreaterThan(-60);
  }, 30000);

  it('extends total duration by the sum of every hold for multiple, well-separated hold instants', async () => {
    const clipPath = await makeTestClip('multi-hold-in.mp4');
    const outputPath = path.join(dir, 'multi-hold-out.mp4');
    const holdDurationSeconds = 0.5;
    const holdInstants = [1.5, 4];

    await applyReactionHolds(clipPath, outputPath, holdInstants, holdDurationSeconds);

    const videoDuration = await ffprobeDuration(outputPath);
    const audioDuration = await ffprobeAudioDuration(outputPath);
    const expectedDuration = CLIP_DURATION_SECONDS + holdInstants.length * holdDurationSeconds;

    expect(Math.abs(videoDuration - expectedDuration)).toBeLessThan(0.3);
    expect(Math.abs(videoDuration - audioDuration)).toBeLessThan(0.1);
    expect(await hasAudioStream(outputPath)).toBe(true);
  }, 30000);

  it('does not crash for a hold instant very close to clip start or clip end', async () => {
    const clipPath = await makeTestClip('edge-hold-in.mp4');
    const outputPath = path.join(dir, 'edge-hold-out.mp4');
    const holdDurationSeconds = 0.3;
    // 0.2s from the very start, 0.2s from the very end (CLIP_DURATION_SECONDS = 6).
    const holdInstants = [0.2, 5.8];

    await expect(
      applyReactionHolds(clipPath, outputPath, holdInstants, holdDurationSeconds),
    ).resolves.toBeUndefined();

    const videoDuration = await ffprobeDuration(outputPath);
    const audioDuration = await ffprobeAudioDuration(outputPath);
    expect(Math.abs(videoDuration - audioDuration)).toBeLessThan(0.1);
  }, 30000);

  it('throws synchronously (before touching ffmpeg) for an empty hold-instants array', async () => {
    const clipPath = await makeTestClip('empty-holds-in.mp4');
    const outputPath = path.join(dir, 'empty-holds-out.mp4');

    await expect(applyReactionHolds(clipPath, outputPath, [])).rejects.toThrow(/no hold instants/);
  });
});
