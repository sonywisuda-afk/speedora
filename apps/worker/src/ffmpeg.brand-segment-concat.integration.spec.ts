// Deliberately NOT jest.mock()'d, unlike ffmpeg.spec.ts's fully-mocked suite - this drives the
// REAL ffmpeg/ffprobe binaries, same posture as ffmpeg.duration.integration.spec.ts. An exact-args
// assertion (ffmpeg.spec.ts's concatBrandSegment tests) can only ever prove the function BUILDS the
// args it intends to - it can't catch an ffmpeg CLI semantic bug (argument-binding, filter-graph
// mismatch, wrong stream count, a SAR mismatch - see below). This test proves the actual concat
// behavior a mocked test cannot: real ffmpeg, real ffprobe, real measured output duration - for a
// video segment (with its own audio) and a static-image segment (no audio at all, needs the
// synthesized-silence path), at BOTH the 'start' (Intro, P3d) and 'end' (Outro, P3e) position.
//
// Confirmed working via a throwaway spike script (P3d, 2026-07-24/25) before the first version of
// this test was written (intro/'start' only) - see concatBrandSegment()'s own comment in ffmpeg.ts
// for the full design rationale (trim=/atrim= filters instead of a bare -t flag, specifically to
// avoid the exact argument-binding bug ffmpeg.duration.integration.spec.ts guards against). This
// test itself caught a real bug during P3d: a sample-aspect-ratio (SAR) mismatch between the
// segment and clip video branches that made ffmpeg's concat filter fail outright on some
// resolution combinations - fixed with `setsar=1` on both branches (see ffmpeg.ts). P3e extended
// this file (renamed from ffmpeg.intro-concat.integration.spec.ts) to also cover the 'end' position
// once concatIntro() generalized into concatBrandSegment(position, ...) - the exact same real-ffmpeg
// proof, now parametrized over both directions.
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { concatBrandSegment, type BrandSegmentPosition } from './ffmpeg';

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

// Render Fidelity & Composition Execution Engine, Phase 8 (ffprobe verification) - proves the
// "render pipeline with ... brand segments preserves the canonical sample rate" regression case
// explicitly: this file's own concatBrandSegment() already normalizes to
// BRAND_SEGMENT_AUDIO_SAMPLE_RATE via its own aformat= filter graph (concat-alignment, unrelated
// to Phase 8's resolveAudioEncodeArgs() fix) - Phase 8 adds -ar 44100 at the OUTPUT ENCODE step
// too (every caller, including this one), so this confirms the two layers agree rather than
// silently conflicting.
async function ffprobeAudioSampleRate(file: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate',
    '-of',
    'csv=p=0',
    file,
  ]);
  return Number(stdout.trim());
}

// docs/ai/render-fidelity-local-equivalence-gate.md's own documented fps-drift finding - real,
// decode-based frame count (not container `nb_frames` metadata), same "the only metric a held-
// frame/metadata artifact can't fool" reasoning ffmpeg.crossfade.integration.spec.ts's own
// ffprobeVideoFrameCount() already established.
async function ffprobeRealFrameCount(file: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-count_frames',
    '-show_entries',
    'stream=nb_read_frames',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return Number(stdout.trim());
}

async function ffprobeAvgFrameRate(file: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=avg_frame_rate',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const [num, den] = stdout.trim().split('/').map(Number);
  return num / den;
}

const describeIfFfmpeg = isFfmpegAvailable() ? describe : describe.skip;

describeIfFfmpeg('concatBrandSegment against real ffmpeg (P3d intro / P3e outro)', () => {
  let dir: string;
  const OUTPUT_WIDTH = 320;
  const OUTPUT_HEIGHT = 240;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'speedora-brand-segment-concat-it-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(['start', 'end'] as const)(
    "concatenates a video segment (with its own audio) at position '%s', at the correct total duration",
    async (position: BrandSegmentPosition) => {
      const clipPath = path.join(dir, `clip-video-${position}.mp4`);
      const segmentPath = path.join(dir, `segment-video-${position}.mp4`);
      const outputPath = path.join(dir, `out-video-${position}.mp4`);

      // Deliberately a DIFFERENT resolution/fps than the clip, so this test actually proves
      // normalization (and the SAR fix), not just a lucky format match.
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
        segmentPath,
      ]);

      const clipDuration = await ffprobeDuration(clipPath);

      await concatBrandSegment(
        position,
        clipPath,
        { filePath: segmentPath, type: 'video', imageDurationSeconds: null },
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT,
        outputPath,
      );

      const actualDuration = await ffprobeDuration(outputPath);
      // The segment's own real duration (3s) is what concatBrandSegment() uses (uncapped here,
      // well under MAX_INTRO_DURATION_SECONDS) - expected total is ~3s segment + ~5s clip,
      // regardless of which end it's attached to.
      expect(Math.abs(actualDuration - (3 + clipDuration))).toBeLessThan(1.5);
      // Phase 8 - the clip source (48kHz) and segment source (44.1kHz) genuinely mismatch, so a
      // real 44100Hz output here proves BOTH the filter-graph normalization and the new -ar
      // output-encode fix land on the same canonical rate, not just one or the other.
      expect(await ffprobeAudioSampleRate(outputPath)).toBe(44100);
    },
    30000,
  );

  it.each(['start', 'end'] as const)(
    "concatenates a static-image segment (synthesized silent audio) at position '%s', held for its configured duration",
    async (position: BrandSegmentPosition) => {
      const clipPath = path.join(dir, `clip-image-${position}.mp4`);
      const segmentPath = path.join(dir, `segment-image-${position}.png`);
      const outputPath = path.join(dir, `out-image-${position}.mp4`);

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
        segmentPath,
      ]);

      const clipDuration = await ffprobeDuration(clipPath);
      const imageDurationSeconds = 2.5;

      await concatBrandSegment(
        position,
        clipPath,
        { filePath: segmentPath, type: 'image', imageDurationSeconds },
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT,
        outputPath,
      );

      const actualDuration = await ffprobeDuration(outputPath);
      expect(Math.abs(actualDuration - (imageDurationSeconds + clipDuration))).toBeLessThan(1.5);

      // Confirms the output actually has an audio stream at all (the synthesized silence made it
      // into the mux, rather than the concat silently dropping the audio branch) - true regardless
      // of position.
      expect(await hasAudioStream(outputPath)).toBe(true);
    },
    30000,
  );

  // docs/ai/render-fidelity-local-equivalence-gate.md's own documented fps-drift finding, and the
  // `-shortest` fix - see that flag's own comment in ffmpeg.ts for the full root-cause reasoning.
  // Chains BOTH an intro ('start') and outro ('end') concatBrandSegment() call against the SAME
  // clip, the exact scenario that originally surfaced the bug (a single call's own overshoot is
  // too small to move avg_frame_rate; it only became measurable after 2 chained calls). Proves the
  // fix with the SAME real, decode-based frame-count check that originally diagnosed the bug (not
  // container `nb_frames` metadata, which held the wrong (drifted) avg_frame_rate right up until
  // this exact assertion would have caught it) - a real regression test, not just an exact-args
  // assertion (ffmpeg.spec.ts's own `-shortest` presence test can't prove the flag actually works).
  it('keeps avg_frame_rate exact and container duration tied to the real frame count after chaining an intro AND an outro (not just one)', async () => {
    const FPS = 25;
    const clipPath = path.join(dir, 'fps-drift-clip.mp4');
    const introPath = path.join(dir, 'fps-drift-intro.mp4');
    const outroPath = path.join(dir, 'fps-drift-outro.mp4');
    const withIntroPath = path.join(dir, 'fps-drift-with-intro.mp4');
    const finalPath = path.join(dir, 'fps-drift-final.mp4');

    async function makeColorClip(outputPath: string, color: string, durationSeconds: number) {
      await execFileAsync(FFMPEG_PATH, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=${color}:size=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:rate=${FPS}:duration=${durationSeconds}`,
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=440:sample_rate=44100:duration=${durationSeconds}`,
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        outputPath,
      ]);
    }
    await makeColorClip(clipPath, 'blue', 5);
    await makeColorClip(introPath, 'green', 1);
    await makeColorClip(outroPath, 'red', 1);

    await concatBrandSegment(
      'start',
      clipPath,
      { filePath: introPath, type: 'video', imageDurationSeconds: null },
      OUTPUT_WIDTH,
      OUTPUT_HEIGHT,
      withIntroPath,
      null,
      `${FPS}/1`,
    );
    await concatBrandSegment(
      'end',
      withIntroPath,
      { filePath: outroPath, type: 'video', imageDurationSeconds: null },
      OUTPUT_WIDTH,
      OUTPUT_HEIGHT,
      finalPath,
      null,
      `${FPS}/1`,
    );

    const realFrameCount = await ffprobeRealFrameCount(finalPath);
    const avgFrameRate = await ffprobeAvgFrameRate(finalPath);
    const containerDuration = await ffprobeDuration(finalPath);

    // 175 real frames = 125 (5s clip) + 25 (1s intro) + 25 (1s outro), at exactly 25fps - no
    // frames dropped or duplicated by either concat pass.
    expect(realFrameCount).toBe(175);
    expect(avgFrameRate).toBeCloseTo(FPS, 3);
    expect(containerDuration).toBeCloseTo(realFrameCount / FPS, 2);
  }, 30000);
});
