// Render Fidelity & Composition Execution Engine, Phase 5 (Cutover) - the real-ffmpeg
// acceptance gate this phase's own approval required ("Do not rely exclusively on mocks"), same
// posture as every sibling *.integration.spec.ts in this directory. execute-render-plan.spec.ts
// already proves executeCompiledRenderPlan()'s own pass-interpretation/fallback/ordering logic
// against MOCKED ffmpeg.ts functions - this file proves the same executor, completely unmocked,
// correctly drives the REAL renderClip()/trimCutRanges() against real ffmpeg/ffprobe, producing a
// real, valid output file. Deliberately does not re-verify every technique's own ffmpeg
// correctness (reaction hold/intro-outro/B-roll/crossfade already have their own dedicated
// integration gates - ffmpeg.reaction-hold/ffmpeg.brand-segment-concat/ffmpeg.broll/
// ffmpeg.crossfade.integration.spec.ts) - this gate is about the EXECUTOR's own dispatch
// mechanism, not about re-litigating passes that already have real-ffmpeg proof elsewhere.
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CutRange } from '@speedora/cutlist';
import { executeCompiledRenderPlan } from './execute-render-plan';
import type { ReframeOptions } from './ffmpeg';
import type { CompiledPass, FfmpegExecutionPlan } from './render-plan-compiler';

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
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(stdout) as { format: { duration: string } };
  return Number(parsed.format.duration);
}

const describeIfFfmpeg = isFfmpegAvailable() ? describe : describe.skip;

describeIfFfmpeg('executeCompiledRenderPlan against real ffmpeg (Phase 5)', () => {
  let dir: string;
  const SOURCE_DURATION_SECONDS = 6;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'speedora-execute-render-plan-it-'));
  }, 15000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function makeSource(name: string): Promise<string> {
    const sourcePath = path.join(dir, name);
    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100',
      '-t',
      String(SOURCE_DURATION_SECONDS),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      sourcePath,
    ]);
    return sourcePath;
  }

  const reframe: ReframeOptions = {
    outputWidth: 240,
    outputHeight: 240,
    width: 240,
    height: 240,
    x: 40,
    y: 0,
    sendCmdPath: null,
  };

  it('drives a real renderClip-only plan through real ffmpeg, producing a valid output file', async () => {
    const sourcePath = await makeSource('source-minimal.mp4');
    const outputPath = path.join(dir, 'output-minimal.mp4');
    const plan: FfmpegExecutionPlan = {
      clipId: 'clip-1',
      videoId: 'video-1',
      passes: [
        {
          pass: 'renderClip',
          args: {
            inputPath: sourcePath,
            startTime: 0,
            endTime: 3,
            subtitlesPath: null,
            outputPath,
            reframe,
            broll: [],
            watermark: null,
            quality: null,
            sourceAudioChannels: 2,
          },
        },
      ],
    };

    const outcome = await executeCompiledRenderPlan(plan);

    expect(outcome.renderedPath).toBe(outputPath);
    expect(outcome.finalOutputPath).toBe(outputPath);
    expect(outcome.trimApplied).toBe(false);
    const duration = await ffprobeDuration(outputPath);
    expect(duration).toBeGreaterThan(2.5);
    expect(duration).toBeLessThan(3.5);
  }, 30000);

  it('drives a real renderClip + trimCutRanges plan through real ffmpeg, producing a correctly shortened output', async () => {
    const sourcePath = await makeSource('source-cuts.mp4');
    const outputPath = path.join(dir, 'output-cuts.mp4');
    const trimmedPath = path.join(dir, 'trimmed-cuts.mp4');
    // Cuts 1 second out of a 5-second requested clip (0-5s of the 6s source).
    const cuts: CutRange[] = [{ start: 2, end: 3 }];
    const passes: CompiledPass[] = [
      {
        pass: 'renderClip',
        args: {
          inputPath: sourcePath,
          startTime: 0,
          endTime: 5,
          subtitlesPath: null,
          outputPath,
          reframe,
          broll: [],
          watermark: null,
          quality: null,
          sourceAudioChannels: 2,
        },
      },
      {
        pass: 'trimCutRanges',
        args: [outputPath, trimmedPath, cuts, 4, null, null, null],
      },
    ];

    const outcome = await executeCompiledRenderPlan({
      clipId: 'clip-1',
      videoId: 'video-1',
      passes,
    });

    expect(outcome.renderedPath).toBe(trimmedPath);
    expect(outcome.finalOutputPath).toBe(trimmedPath);
    expect(outcome.trimApplied).toBe(true);
    const duration = await ffprobeDuration(trimmedPath);
    // Requested 5s, cut 1s -> ~4s expected.
    expect(duration).toBeGreaterThan(3.5);
    expect(duration).toBeLessThan(4.5);
  }, 30000);

  it('propagates a real renderClip failure (bad input path) rather than swallowing it', async () => {
    const outputPath = path.join(dir, 'output-should-not-exist.mp4');
    const plan: FfmpegExecutionPlan = {
      clipId: 'clip-1',
      videoId: 'video-1',
      passes: [
        {
          pass: 'renderClip',
          args: {
            inputPath: path.join(dir, 'does-not-exist.mp4'),
            startTime: 0,
            endTime: 3,
            subtitlesPath: null,
            outputPath,
            reframe,
            broll: [],
            watermark: null,
            quality: null,
            sourceAudioChannels: 2,
          },
        },
      ],
    };

    await expect(executeCompiledRenderPlan(plan)).rejects.toThrow();
  }, 30000);
});
