// Output Resolution/Quality audit, Phase 2 - the real-ffmpeg acceptance gate Phase 1's own plan
// named up front, same posture as every prior genuinely-new render mechanism in this codebase
// (Smart Transitions' ffmpeg.crossfade.integration.spec.ts, Reaction Hold's ffmpeg.reaction-
// hold.integration.spec.ts, ...): a mocked exact-args test (crop-path.spec.ts's own
// targetAspectRatio matrix, resolution-policy.spec.ts) can only prove computeCropDimensions()/
// resolveOutputResolution() COMPUTE the right numbers - it can't prove ffmpeg's crop/scale filter
// chain actually PRODUCES a real file at those pixel dimensions, with the right pixel format,
// codec, aspect ratio (no stretching), and FPS/audio pass-through behavior. Deliberately NOT
// jest.mock()'d, same "drives the real binaries" posture as every sibling *.integration.spec.ts
// in this file.
//
// Runs @speedora/reframe's REAL computeCropDimensions()/resolveOutputResolution() (not mocked)
// against a real lavfi-generated source, then feeds the result into this file's own real
// renderClip() exactly the way render-clip.worker.ts's computeReframeDimensions() does (a static
// center-crop reframe, since a face-tracking crop PATH is an orthogonal concern already covered
// by ffmpeg.spec.ts/crop-path.spec.ts - this gate is about resolution/aspect/quality, not
// subject-tracking).
//
// This gate did exactly what it exists for on its first real run: it caught that a pure
// crop-only pipeline delivers a real, native 608px-wide clip (not 1080x1920) for the single most
// common real conversion - a typical 1920x1080 landscape source cropped to 9:16 - because
// computeCropDimensions() only ever removes pixels, never scales. Resolved via AskUserQuestion:
// resolveOutputResolution() now scales UP to a tier's canonical size too (not just down), guarded
// by a floor against upscaling a crop with too little real source detail - see that function's
// own MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP comment for the full story.
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { computeCropDimensions, resolveOutputResolution } from '@speedora/reframe';
import { getAudioChannelCount, renderClip, type ReframeOptions } from './ffmpeg';

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

interface VideoStreamInfo {
  width: number;
  height: number;
  pix_fmt: string;
  codec_name: string;
  r_frame_rate: string;
  sample_aspect_ratio: string;
  duration: number;
}

interface AudioStreamInfo {
  sample_rate: number;
  channels: number;
  codec_name: string;
  duration: number;
}

async function ffprobeVideo(file: string): Promise<VideoStreamInfo> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,pix_fmt,codec_name,r_frame_rate,sample_aspect_ratio,duration',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(stdout) as { streams: Record<string, string>[] };
  const s = parsed.streams[0];
  return {
    width: Number(s.width),
    height: Number(s.height),
    pix_fmt: s.pix_fmt,
    codec_name: s.codec_name,
    r_frame_rate: s.r_frame_rate,
    sample_aspect_ratio: s.sample_aspect_ratio,
    duration: Number(s.duration),
  };
}

async function ffprobeAudio(file: string): Promise<AudioStreamInfo> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate,channels,codec_name,duration',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(stdout) as { streams: Record<string, string>[] };
  const s = parsed.streams[0];
  return {
    sample_rate: Number(s.sample_rate),
    channels: Number(s.channels),
    codec_name: s.codec_name,
    duration: Number(s.duration),
  };
}

const describeIfFfmpeg = isFfmpegAvailable() ? describe : describe.skip;

describeIfFfmpeg('output resolution/aspect-ratio profile against real ffmpeg (Phase 2)', () => {
  let dir: string;
  const CLIP_DURATION_SECONDS = 2;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'speedora-output-profile-it-'));
  }, 15000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // A real, known-parameter source (explicit size/fps/audio sample rate/channel count) so every
  // pass-through assertion below (FPS, audio) has something non-default to actually verify
  // against, not just "whatever ffmpeg happened to default to."
  async function makeSource(
    name: string,
    width: number,
    height: number,
    fps: number,
    audioSampleRate = 48000,
    // Output Resolution/Quality audit, Phase 6 (Audio params finalization) - an OUTPUT option (a
    // real channel-count conversion at encode time), not an input option before -i (which lavfi
    // sources like sine= silently ignore) - the same distinction the rest of this codebase's own
    // -ss/-t input-vs-output option comments already document for a different flag.
    audioChannels = 2,
  ): Promise<string> {
    const sourcePath = path.join(dir, name);
    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${width}x${height}:rate=${fps}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:sample_rate=${audioSampleRate}`,
      '-t',
      String(CLIP_DURATION_SECONDS),
      '-ac',
      String(audioChannels),
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

  // Mirrors render-clip.worker.ts's buildReframePlan() static-fallback branch exactly (no
  // detected face/emphasis word -> a fixed center crop for the whole clip) - the same real code
  // path a genuinely static/no-subject clip renders through in production. `crop` (natural,
  // source-bounded) and `outputSize` (final delivered resolution, can be BIGGER when
  // resolveOutputResolution() scales up) are deliberately two separate parameters - collapsing
  // them back into one is exactly the real Phase 2 wiring bug this whole file exists to catch
  // (ffmpeg's `crop=` filter fed a region bigger than the source frame fails outright, see
  // computeReframeDimensions()'s own comment in render-clip.worker.ts for the full story).
  function staticCenterReframe(
    sourceWidth: number,
    sourceHeight: number,
    crop: { width: number; height: number },
    outputSize: { width: number; height: number },
  ): ReframeOptions {
    return {
      outputWidth: outputSize.width,
      outputHeight: outputSize.height,
      width: crop.width,
      height: crop.height,
      x: Math.round((sourceWidth - crop.width) / 2),
      y: Math.round((sourceHeight - crop.height) / 2),
      sendCmdPath: null,
    };
  }

  // The exact same 3-step pipeline computeReframeDimensions() runs in production: real
  // computeCropDimensions() -> real resolveOutputResolution() -> real renderClip(). Also probes
  // the real getAudioChannelCount() (Phase 6) and threads it through exactly as
  // computeReframeDimensions()'s own renderClip() call site does, rather than a hand-picked
  // constant - this is what makes the audio tests below a genuine end-to-end proof, not just of
  // renderClip()'s own arg-building.
  async function renderProfile(
    sourcePath: string,
    sourceWidth: number,
    sourceHeight: number,
    targetAspectRatio: number,
    tier: '1080p' | '720p' | null,
    outputName: string,
  ): Promise<string> {
    const crop = computeCropDimensions(sourceWidth, sourceHeight, targetAspectRatio);
    const outputSize = resolveOutputResolution(crop, targetAspectRatio, tier);
    const reframe = staticCenterReframe(sourceWidth, sourceHeight, crop, outputSize);
    const outputPath = path.join(dir, outputName);
    const sourceAudioChannels = await getAudioChannelCount(sourcePath);
    // -preset ultrafast keeps this gate fast - quality/CRF is Phase 0's own already-verified
    // concern (ffmpeg.spec.ts/render-clip.worker.spec.ts), orthogonal to resolution/aspect ratio.
    await renderClip({
      inputPath: sourcePath,
      startTime: 0,
      endTime: CLIP_DURATION_SECONDS,
      subtitlesPath: null,
      outputPath,
      reframe,
      quality: { preset: 'ultrafast', crf: 30 },
      sourceAudioChannels,
    });
    return outputPath;
  }

  // The audit's own test matrix (source x aspect-ratio -> expected output), adjusted for Phase
  // 1's deliberate crop-only/never-upscale decision - see crop-path.ts's own comment and Phase
  // 1's commit message for why a portrait source asked for 16:9 lands BELOW the canonical
  // 1920x1080 size instead of being upscaled/padded to it.
  describe('resolution/aspect-ratio matrix', () => {
    let landscape1080p: string;
    let portrait1080p: string;
    let landscape4k: string;
    let landscape720p: string;

    beforeAll(async () => {
      [landscape1080p, portrait1080p, landscape4k, landscape720p] = await Promise.all([
        makeSource('landscape-1080p.mp4', 1920, 1080, 30),
        makeSource('portrait-1080p.mp4', 1080, 1920, 30),
        makeSource('landscape-4k.mp4', 3840, 2160, 30),
        makeSource('landscape-720p.mp4', 1280, 720, 30),
      ]);
    }, 60000);

    it('1920x1080 source, 9:16 target, 1080p tier -> scaled UP to exactly 1080x1920 (the single most common real conversion)', async () => {
      const output = await renderProfile(landscape1080p, 1920, 1080, 9 / 16, '1080p', 'r1.mp4');
      const info = await ffprobeVideo(output);
      // computeCropDimensions() alone produces a real, native 608x1080 crop (keeps the source's
      // full 1080 height, narrows width to round(1080*9/16)=608) - well above the floor, so
      // resolveOutputResolution() scales it UP to the real canonical 1080x1920 rather than
      // shipping a 608px-wide clip. This is the exact case that surfaced the need for Phase 2's
      // scale-up policy in the first place: a mocked test could never have caught this, since it
      // requires actually chaining the real crop math into a real encode to notice the natural
      // crop was too narrow at all.
      expect(info.width).toBe(1080);
      expect(info.height).toBe(1920);
    }, 30000);

    it('3840x2160 source, 9:16 target, 1080p tier -> capped down to 1080x1920 (not the natural ~1215x2160)', async () => {
      const output = await renderProfile(landscape4k, 3840, 2160, 9 / 16, '1080p', 'r2.mp4');
      const info = await ffprobeVideo(output);
      expect(info.width).toBe(1080);
      expect(info.height).toBe(1920);
    }, 30000);

    it('1280x720 source, 9:16 target, 1080p tier -> stays at its own natural (smaller) size, never upscaled to 1080x1920', async () => {
      const output = await renderProfile(landscape720p, 1280, 720, 9 / 16, '1080p', 'r3.mp4');
      const info = await ffprobeVideo(output);
      // Natural 9:16 crop of a 1280x720 source keeps the full height and crops width:
      // width = round(720 * 9/16) = 406 (even-rounded), height = 720. That 406px short side is
      // BELOW resolveOutputResolution()'s MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP floor (480), so it's
      // deliberately left unscaled rather than upscaled to 1080p's canonical size - this IS the
      // "don't fake 1080p from a 720p source" rule (audit rule 4), proven against a real encode
      // exercising the exact floor guard that makes it real, not just asserted in a mocked test.
      expect(info.height).toBe(720);
      expect(info.width).toBeLessThanOrEqual(720);
      expect(info.width).toBeLessThan(1080);
    }, 30000);

    it('1080x1920 source, 9:16 target, 1080p tier -> exactly 1080x1920 (no-op crop, already portrait)', async () => {
      const output = await renderProfile(portrait1080p, 1080, 1920, 9 / 16, '1080p', 'r4.mp4');
      const info = await ffprobeVideo(output);
      expect(info.width).toBe(1080);
      expect(info.height).toBe(1920);
    }, 30000);

    it('1920x1080 source, 16:9 target, 1080p tier -> exactly 1920x1080 (no-op crop, already landscape)', async () => {
      const output = await renderProfile(landscape1080p, 1920, 1080, 16 / 9, '1080p', 'r5.mp4');
      const info = await ffprobeVideo(output);
      expect(info.width).toBe(1920);
      expect(info.height).toBe(1080);
    }, 30000);

    it('1080x1920 source, 16:9 target, 1080p tier -> scaled UP to exactly 1920x1080 (Phase 2 policy)', async () => {
      const output = await renderProfile(portrait1080p, 1080, 1920, 16 / 9, '1080p', 'r6.mp4');
      const info = await ffprobeVideo(output);
      // computeCropDimensions() alone produces a real, native 1080x608 crop here (a 1080-wide
      // portrait source has no 1920px of horizontal information for a full-height 16:9 crop) -
      // but 608 is well above MIN_NATURAL_SHORT_SIDE_FOR_SCALE_UP (480), so
      // resolveOutputResolution() scales it UP to the tier's real canonical size instead of
      // leaving it small (Phase 2 policy, resolved via AskUserQuestion after real-ffmpeg
      // verification found crop-only reframing misses the audit's own target profiles for the
      // overwhelmingly common case - see resolution-policy.ts's own comment).
      expect(info.width).toBe(1920);
      expect(info.height).toBe(1080);
    }, 30000);

    it('1920x1080 source, 1:1 target, 1080p tier -> exactly 1080x1080', async () => {
      const output = await renderProfile(landscape1080p, 1920, 1080, 1, '1080p', 'r7.mp4');
      const info = await ffprobeVideo(output);
      expect(info.width).toBe(1080);
      expect(info.height).toBe(1080);
    }, 30000);

    it('1080x1920 source, 1:1 target, 1080p tier -> exactly 1080x1080', async () => {
      const output = await renderProfile(portrait1080p, 1080, 1920, 1, '1080p', 'r8.mp4');
      const info = await ffprobeVideo(output);
      expect(info.width).toBe(1080);
      expect(info.height).toBe(1080);
    }, 30000);
  });

  describe('encoding invariants (quality/format audit, cross-checked against a real encode)', () => {
    let source: string;

    beforeAll(async () => {
      source = await makeSource('invariants-source.mp4', 1920, 1080, 30);
    }, 30000);

    it('always encodes h264/yuv420p regardless of the requested profile', async () => {
      const output = await renderProfile(source, 1920, 1080, 9 / 16, '1080p', 'invariants-1.mp4');
      const info = await ffprobeVideo(output);
      expect(info.codec_name).toBe('h264');
      expect(info.pix_fmt).toBe('yuv420p');
    }, 30000);

    it('never stretches the image - sample aspect ratio stays 1:1 (square pixels) after crop+scale', async () => {
      const output = await renderProfile(source, 1920, 1080, 1, '1080p', 'invariants-2.mp4');
      const info = await ffprobeVideo(output);
      expect(['1:1', '0:1']).toContain(info.sample_aspect_ratio);
    }, 30000);

    it('preserves the source duration', async () => {
      const output = await renderProfile(source, 1920, 1080, 9 / 16, '1080p', 'invariants-3.mp4');
      const info = await ffprobeVideo(output);
      expect(Math.abs(info.duration - CLIP_DURATION_SECONDS)).toBeLessThan(0.2);
    }, 30000);
  });

  describe('FPS handling (audit rule 6 - no accidental frame-rate normalization)', () => {
    it('passes a 24fps source through unchanged (no forced 30fps)', async () => {
      const source24 = await makeSource('fps24.mp4', 1920, 1080, 24);
      const output = await renderProfile(source24, 1920, 1080, 9 / 16, '1080p', 'fps24-out.mp4');
      const info = await ffprobeVideo(output);
      // r_frame_rate is a "num/den" string (e.g. "24/1") - parse and compare numerically rather
      // than string-matching, same reasoning ffmpeg.ts's own parseFrameRate() documents.
      const [num, den] = info.r_frame_rate.split('/').map(Number);
      expect(num / den).toBeCloseTo(24, 0);
    }, 30000);

    it('passes a 60fps source through unchanged (no forced downsample)', async () => {
      const source60 = await makeSource('fps60.mp4', 1920, 1080, 60);
      const output = await renderProfile(source60, 1920, 1080, 9 / 16, '1080p', 'fps60-out.mp4');
      const info = await ffprobeVideo(output);
      const [num, den] = info.r_frame_rate.split('/').map(Number);
      expect(num / den).toBeCloseTo(60, 0);
    }, 30000);
  });

  // Output Resolution/Quality audit, Phase 6 (Audio params finalization) - this describe's own
  // title was updated: sample rate is still fully source-preserving (unchanged by this phase),
  // but "channels" is no longer a blanket passthrough - a source is preserved up to
  // MAX_OUTPUT_AUDIO_CHANNELS (2), and downmixed above it. See resolveAudioEncodeArgs()'s own
  // comment for the full policy.
  describe('audio handling (audit rule 5 - AAC, source-preserving sample rate, capped channels)', () => {
    it('preserves a 48kHz stereo source', async () => {
      const source = await makeSource('audio48k.mp4', 1920, 1080, 30, 48000);
      const output = await renderProfile(source, 1920, 1080, 9 / 16, '1080p', 'audio48k-out.mp4');
      const info = await ffprobeAudio(output);
      expect(info.codec_name).toBe('aac');
      expect(info.sample_rate).toBe(48000);
      expect(info.channels).toBe(2);
      expect(Math.abs(info.duration - CLIP_DURATION_SECONDS)).toBeLessThan(0.2);
    }, 30000);

    it('preserves a 44.1kHz stereo source (no forced resample to 48kHz)', async () => {
      const source = await makeSource('audio44k.mp4', 1920, 1080, 30, 44100);
      const output = await renderProfile(source, 1920, 1080, 9 / 16, '1080p', 'audio44k-out.mp4');
      const info = await ffprobeAudio(output);
      expect(info.sample_rate).toBe(44100);
      expect(info.channels).toBe(2);
    }, 30000);

    // Phase 6's own real gap: a mono source must stay mono - never upmixed just because
    // renderClip()'s own -b:a decision now depends on channel count.
    it('never upmixes a mono source to stereo', async () => {
      const source = await makeSource('audio-mono.mp4', 1920, 1080, 30, 48000, 1);
      const output = await renderProfile(source, 1920, 1080, 9 / 16, '1080p', 'audio-mono-out.mp4');
      const info = await ffprobeAudio(output);
      expect(info.codec_name).toBe('aac');
      expect(info.channels).toBe(1);
    }, 30000);

    // Phase 6's own real gap: a >2-channel (e.g. 5.1 surround) source is downmixed to stereo, not
    // passed through - real-ffmpeg exploration found an unconverted 5.1 AAC output roughly triples
    // the bitrate for no audible benefit on the mobile/phone playback this pipeline targets.
    it('downmixes a >2-channel source to stereo', async () => {
      const source = await makeSource('audio-6ch.mp4', 1920, 1080, 30, 48000, 6);
      // Sanity-check the fixture itself actually has more than 2 channels before asserting the
      // downmix - otherwise a broken fixture could pass this test for the wrong reason.
      expect(await getAudioChannelCount(source)).toBeGreaterThan(2);

      const output = await renderProfile(source, 1920, 1080, 9 / 16, '1080p', 'audio-6ch-out.mp4');
      const info = await ffprobeAudio(output);
      expect(info.codec_name).toBe('aac');
      expect(info.channels).toBe(2);
      expect(Math.abs(info.duration - CLIP_DURATION_SECONDS)).toBeLessThan(0.2);
    }, 30000);
  });
});
