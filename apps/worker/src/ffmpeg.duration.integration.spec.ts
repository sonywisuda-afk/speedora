// Deliberately NOT jest.mock()'d, unlike ffmpeg.spec.ts's fully-mocked suite - this drives the
// REAL ffmpeg/ffprobe binaries. Closes a verification gap docs/testing.md already calls out
// ("unit tests pass" and "verified against the real external system" are two separate claims):
// an exact-args assertion (ffmpeg.spec.ts's "positions TOP_LEFT correctly" etc.) can only ever
// prove renderClip() BUILDS the args array it intends to - it can't catch an ffmpeg CLI semantic
// bug, because ffmpeg.spec.ts's execFile mock never actually parses the args the way ffmpeg does.
//
// That's exactly what shipped and passed all 54 of those mocked assertions: `-t <duration>` was
// placed as an INPUT option immediately after `-i inputPath`, but ffmpeg binds an input option to
// whichever `-i` comes NEXT, not the previous one - so as soon as a watermark (or B-roll) input
// was added after it, `-t` silently rebound onto THAT input instead of the main source, leaving
// the main source unbounded (reads to EOF) instead of stopping at the clip's duration. Found via a
// real P3c live-verification render (2026-07-24/25) that ballooned a 61s clip into a 20-minute
// encode; fixed by moving `-t` to be an output option instead (see execFfmpegAtomically's call
// site in ffmpeg.ts). This test pins that fix against regression the only way that actually can:
// real ffmpeg, real ffprobe, real measured output duration.
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { renderClip } from './ffmpeg';

const execFileAsync = promisify(execFile);
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH ?? 'ffprobe';

// Same "not always available in this dev sandbox" honesty docs/testing.md's "Known, honestly-
// documented verification gaps" section already applies to every other ffmpeg/Python-shelling
// module - skips cleanly (not a failure) rather than breaking `pnpm test` for anyone/CI without
// real ffmpeg on PATH.
function isFfmpegAvailable(): boolean {
  try {
    execFileSync(FFMPEG_PATH, ['-version'], { stdio: 'ignore' });
    execFileSync(FFPROBE_PATH, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeIfFfmpeg = isFfmpegAvailable() ? describe : describe.skip;

describeIfFfmpeg('renderClip against real ffmpeg (duration regression guard)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'speedora-ffmpeg-it-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('bounds output duration to the requested clip length when a watermark input is added after the source', async () => {
    const sourcePath = path.join(dir, 'source.mp4');
    const watermarkPath = path.join(dir, 'watermark.png');
    const outputPath = path.join(dir, 'output.mp4');

    // A synthetic 8s source (lavfi test sources - no fixture asset needed), well longer than
    // the 2s clip requested below. If `-t` silently rebinds onto the watermark input instead of
    // this one, the bug reproduces as ~8s (the full source) showing up in the output, not ~2s.
    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=25',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=mono',
      '-t',
      '8',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      sourcePath,
    ]);
    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=64x64',
      '-frames:v',
      '1',
      watermarkPath,
    ]);

    const requestedDuration = 2;
    await renderClip({
      inputPath: sourcePath,
      startTime: 0,
      endTime: requestedDuration,
      subtitlesPath: null,
      outputPath,
      reframe: null,
      broll: null,
      watermark: {
        filePath: watermarkPath,
        opacity: 0.5,
        scale: 0.3,
        margin: 0.05,
        position: 'BOTTOM_RIGHT',
      },
    });

    const { stdout } = await execFileAsync(FFPROBE_PATH, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      outputPath,
    ]);
    const actualDuration = Number(stdout.trim());

    // Generous tolerance for keyframe-boundary/encoder rounding - tight enough that the old bug
    // (output close to the full 8s source, not ~2s) fails this assertion by a wide margin.
    expect(actualDuration).toBeGreaterThan(0);
    expect(Math.abs(actualDuration - requestedDuration)).toBeLessThan(1.5);
  }, 30000);
});
