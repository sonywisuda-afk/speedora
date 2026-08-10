// Deliberately NOT jest.mock()'d, unlike ffmpeg.spec.ts's fully-mocked suite - this drives the
// REAL ffmpeg/ffprobe binaries, the exact same describeIfFfmpeg-skip / mkdtempSync-scratch-dir /
// real lavfi test media template ffmpeg.reaction-hold.integration.spec.ts and ffmpeg.brand-
// segment-concat.integration.spec.ts already established. An exact-args assertion (ffmpeg.spec.
// ts's trimCutRanges tests) can only ever prove the function BUILDS the args it intends to - it
// can't catch an ffmpeg CLI semantic bug (a filter-graph label mismatch, xfade/acrossfade
// misusing `offset`/`duration`, an A/V duration mismatch, or audio silently dropping to silence
// at a crossfade). This is Item 9's own real-render acceptance gate, the same posture every prior
// genuinely-new render mechanism in this initiative required before being considered shipped
// (OCR Highlight, Reaction Hold) - see docs/ai/silence-compression.md.
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { trimCutRanges } from './ffmpeg';

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

// Same astats-based measurement ffmpeg.reaction-hold.integration.spec.ts's own meanVolumeDb
// already established - used here for the opposite purpose: confirming audio stays genuinely
// AUDIBLE (never drops to silence) all the way through every crossfade junction, which is exactly
// what a mislabeled filter graph (an acrossfade output that silently resolves to nothing) would
// break.
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

describeIfFfmpeg('trimCutRanges real crossfade against real ffmpeg (Item 9)', () => {
  let dir: string;
  const WIDTH = 320;
  const HEIGHT = 240;
  const CLIP_DURATION_SECONDS = 10;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'speedora-crossfade-it-'));
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

  it('shrinks total duration below the naive close-the-gap length by the crossfade overlap, proving a real dissolve ran (not a no-op)', async () => {
    const clipPath = await makeTestClip('single-cut-in.mp4');
    const outputPath = path.join(dir, 'single-cut-out.mp4');
    const cuts = [{ start: 3, end: 4 }];
    const totalOutputDuration = CLIP_DURATION_SECONDS - 1; // = 9

    await trimCutRanges(clipPath, outputPath, cuts, totalOutputDuration);

    const videoDuration = await ffprobeDuration(outputPath);
    const audioDuration = await ffprobeAudioDuration(outputPath);
    // One junction, both kept segments (3s and 6s) far exceed 2 * CROSSFADE_SECONDS, so the full
    // 0.15s fade applies - expected real duration is 9 - 0.15 = 8.85, not the naive 9.
    const expectedDuration = totalOutputDuration - 0.15;

    expect(Math.abs(videoDuration - expectedDuration)).toBeLessThan(0.2);
    // The stated sync invariant: video and audio must shrink by the identical amount.
    expect(Math.abs(videoDuration - audioDuration)).toBeLessThan(0.1);
  }, 30000);

  it('shrinks by the sum of every junction fade for multiple, well-separated cuts', async () => {
    const clipPath = await makeTestClip('multi-cut-in.mp4');
    const outputPath = path.join(dir, 'multi-cut-out.mp4');
    const cuts = [
      { start: 2, end: 3 },
      { start: 6, end: 6.5 },
    ];
    const totalOutputDuration = CLIP_DURATION_SECONDS - 1.5; // = 8.5

    await trimCutRanges(clipPath, outputPath, cuts, totalOutputDuration);

    const videoDuration = await ffprobeDuration(outputPath);
    const audioDuration = await ffprobeAudioDuration(outputPath);
    const expectedDuration = totalOutputDuration - 2 * 0.15;

    expect(Math.abs(videoDuration - expectedDuration)).toBeLessThan(0.3);
    expect(Math.abs(videoDuration - audioDuration)).toBeLessThan(0.1);
  }, 30000);

  it('stays audible (no dropout) across every crossfade junction', async () => {
    const clipPath = await makeTestClip('audible-in.mp4');
    const outputPath = path.join(dir, 'audible-out.mp4');
    const cuts = [
      { start: 2, end: 3 },
      { start: 6, end: 6.5 },
    ];
    const totalOutputDuration = CLIP_DURATION_SECONDS - 1.5;

    await trimCutRanges(clipPath, outputPath, cuts, totalOutputDuration);

    // Sample around both junctions (roughly t=1.85 and t=6.4 on the post-crossfade timeline,
    // see the previous test's own math) and the middle of the file - all should be clearly
    // audible, never near-silent, since this is a continuous 440Hz tone crossfading into itself.
    const nearFirstJunction = await meanVolumeDb(outputPath, 1.5, 0.7);
    const nearSecondJunction = await meanVolumeDb(outputPath, 6, 0.7);
    const wholeFile = await meanVolumeDb(outputPath, 0, await ffprobeAudioDuration(outputPath));

    expect(nearFirstJunction).toBeGreaterThan(-60);
    expect(nearSecondJunction).toBeGreaterThan(-60);
    expect(wholeFile).toBeGreaterThan(-60);
  }, 30000);

  it('does not shrink duration at all when every junction falls back to a plain concat (kept segment too short to crossfade)', async () => {
    const clipPath = await makeTestClip('fallback-in.mp4');
    const outputPath = path.join(dir, 'fallback-out.mp4');
    // A 0.03s kept segment between the two cuts - both its adjacent junctions fall back to a
    // plain hard concat (see ffmpeg.spec.ts's own fallback test for the exact math).
    const cuts = [
      { start: 3, end: 4 },
      { start: 4.03, end: 5 },
    ];
    const totalOutputDuration = CLIP_DURATION_SECONDS - 1.97; // = 8.03

    await trimCutRanges(clipPath, outputPath, cuts, totalOutputDuration);

    const videoDuration = await ffprobeDuration(outputPath);
    const audioDuration = await ffprobeAudioDuration(outputPath);

    expect(Math.abs(videoDuration - totalOutputDuration)).toBeLessThan(0.2);
    expect(Math.abs(videoDuration - audioDuration)).toBeLessThan(0.1);
  }, 30000);

  it('does not crash for a cut very close to clip start or clip end', async () => {
    const clipPath = await makeTestClip('edge-cut-in.mp4');
    const outputPath = path.join(dir, 'edge-cut-out.mp4');
    // A short cut 0.3s from the very start, leaving a tiny first kept segment.
    const cuts = [{ start: 0.3, end: 0.6 }];
    const totalOutputDuration = CLIP_DURATION_SECONDS - 0.3;

    await expect(
      trimCutRanges(clipPath, outputPath, cuts, totalOutputDuration),
    ).resolves.toBeUndefined();

    const videoDuration = await ffprobeDuration(outputPath);
    const audioDuration = await ffprobeAudioDuration(outputPath);
    expect(Math.abs(videoDuration - audioDuration)).toBeLessThan(0.1);
  }, 30000);
});
