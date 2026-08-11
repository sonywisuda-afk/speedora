// The real signature is (file, args, options?, callback) - options is only passed by callers that
// need a timeout (renderClip, trimCutRanges), so the callback can land in either the 3rd or 4th
// position depending on the call site. `file`/`args` stay concretely typed (fixed tuple positions
// before the rest element), so every `const [file, args] = execFileMock.mock.calls[0]` destructure
// elsewhere in this file keeps its inferred types; only the callback's position is flexible.
const execFileMock = jest.fn((_file: string, _args: string[], ...rest: unknown[]) => {
  const callback = rest[rest.length - 1] as (
    error: Error | null,
    result: { stdout: string; stderr: string },
  ) => void;
  callback(null, { stdout: '', stderr: '' });
});
// Loosely-typed alias for setting mock behavior (mockImplementation/mockImplementationOnce) -
// TypeScript's contravariant parameter checking rejects a 3-arg override function (the common case
// for every function in this file except renderClip/trimCutRanges) as assignable to execFileMock's
// own `...rest: unknown[]` signature, even though it's safe at runtime (fewer params is always
// callable). `execFileMock` itself stays strongly typed for READING `.mock.calls[...]` everywhere
// below; this alias is only ever used for WRITING mock behavior.
const execFileMockBehavior = execFileMock as unknown as jest.Mock;

jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => (execFileMock as unknown as (...a: unknown[]) => void)(...args),
}));

const renameMock = jest.fn().mockResolvedValue(undefined);
const unlinkMock = jest.fn().mockResolvedValue(undefined);
jest.mock('node:fs/promises', () => ({
  rename: (...args: unknown[]) => renameMock(...args),
  unlink: (...args: unknown[]) => unlinkMock(...args),
}));

import {
  applyReactionHolds,
  concatBrandSegment,
  escapeFfmpegFilterPath,
  extractAnimatedPreview,
  extractAudio,
  extractBlurPlaceholder,
  extractThumbnail,
  fadeOutBRoll,
  getAudioChannelCount,
  getMediaDurationSeconds,
  getVideoCodec,
  getVideoDimensions,
  getVideoFrameRateString,
  reencodeToH264,
  renderClip,
  trimAndFadeInBRoll,
  trimCutRanges,
} from './ffmpeg';

describe('escapeFfmpegFilterPath', () => {
  it('escapes a Windows absolute path for use in a subtitles= filter', () => {
    expect(escapeFfmpegFilterPath('C:\\Users\\me\\clip.ass')).toBe('C\\:/Users/me/clip.ass');
  });

  it('leaves a POSIX path without a drive letter mostly unchanged', () => {
    expect(escapeFfmpegFilterPath('/tmp/clip.ass')).toBe('/tmp/clip.ass');
  });
});

describe('getVideoDimensions', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('parses width,height from ffprobe csv output', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: '320,240\n', stderr: '' });
      },
    );

    const result = await getVideoDimensions('/tmp/source.mp4');

    expect(result).toEqual({ width: 320, height: 240 });
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffprobe');
    expect(args).toEqual(
      expect.arrayContaining(['-select_streams', 'v:0', '-of', 'csv=p=0', '/tmp/source.mp4']),
    );
  });
});

// Output Resolution/Quality audit, Phase 5 (FPS/CFR policy).
describe('getVideoFrameRateString', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('returns avg_frame_rate as-is (the raw "num/den" string, not re-parsed to a float)', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: '30000/1001,30/1\n', stderr: '' });
      },
    );

    const result = await getVideoFrameRateString('/tmp/source.mp4');

    expect(result).toBe('30000/1001');
    const [file] = execFileMock.mock.calls[0];
    expect(file).toBe('ffprobe');
  });

  it('falls back to r_frame_rate when avg_frame_rate is "0/0" (no real average available)', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: '0/0,25/1\n', stderr: '' });
      },
    );

    const result = await getVideoFrameRateString('/tmp/source.mp4');

    expect(result).toBe('25/1');
  });

  it('returns null when neither rate is usable', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: '0/0,0/0\n', stderr: '' });
      },
    );

    const result = await getVideoFrameRateString('/tmp/source.mp4');

    expect(result).toBeNull();
  });

  it('returns null (never throws) when the ffprobe call itself fails', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(new Error('ffprobe exited with code 1'), { stdout: '', stderr: 'boom' });
      },
    );

    await expect(getVideoFrameRateString('/tmp/source.mp4')).resolves.toBeNull();
  });
});

// Output Resolution/Quality audit, Phase 6 (Audio params finalization).
describe('getAudioChannelCount', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('returns the probed channel count as a number', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: '2\n', stderr: '' });
      },
    );

    const result = await getAudioChannelCount('/tmp/source.mp4');

    expect(result).toBe(2);
    const [file] = execFileMock.mock.calls[0];
    expect(file).toBe('ffprobe');
  });

  it('returns null when ffprobe reports no usable channel count (no audio stream)', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: '\n', stderr: '' });
      },
    );

    const result = await getAudioChannelCount('/tmp/source.mp4');

    expect(result).toBeNull();
  });

  it('returns null (never throws) when the ffprobe call itself fails', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(new Error('ffprobe exited with code 1'), { stdout: '', stderr: 'boom' });
      },
    );

    await expect(getAudioChannelCount('/tmp/source.mp4')).resolves.toBeNull();
  });
});

describe('extractAudio', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('extracts a compressed mono 16kHz mp3 audio track with no video stream', async () => {
    await extractAudio('/tmp/source.mp4', '/tmp/audio.mp3');

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffmpeg');
    expect(args).toEqual(
      expect.arrayContaining([
        '-i',
        '/tmp/source.mp4',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '64k',
        '/tmp/audio.mp3',
      ]),
    );
    // No windowing args on a full-length extraction.
    expect(args).not.toContain('-ss');
    expect(args).not.toContain('-t');
  });

  it('seeks and caps the duration when given a window (long-video chunking)', async () => {
    await extractAudio('/tmp/source.mp4', '/tmp/chunk.mp3', {
      startSeconds: 3000,
      durationSeconds: 3000,
    });

    const [, args] = execFileMock.mock.calls[0];
    // -ss must come before -i (fast input seek); -t after -i caps the window.
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args.indexOf('-t')).toBeGreaterThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('3000');
    expect(args[args.indexOf('-t') + 1]).toBe('3000');
  });

  it('propagates the error when ffmpeg fails', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
      },
    );

    await expect(extractAudio('/tmp/source.mp4', '/tmp/audio.mp3')).rejects.toThrow(
      'ffmpeg exited with code 1',
    );
  });
});

describe('extractThumbnail', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('seeks to the given offset and extracts a single scaled-down WebP frame', async () => {
    await extractThumbnail('/tmp/source.mp4', '/tmp/thumb.webp', 5);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffmpeg');
    expect(args).toEqual(
      expect.arrayContaining([
        '-ss',
        '5',
        '-i',
        '/tmp/source.mp4',
        '-vframes',
        '1',
        '-update',
        '1',
        '-vf',
        'scale=480:-1',
        '-c:v',
        'libwebp',
        '-quality',
        '80',
        '/tmp/thumb.webp',
      ]),
    );
    // -ss before -i for a fast input seek, same convention as extractAudio's window.
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
  });

  it('propagates the error when ffmpeg fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, ...rest) => {
      const callback = rest[rest.length - 1] as (error: Error, result: unknown) => void;
      callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(extractThumbnail('/tmp/source.mp4', '/tmp/thumb.webp', 1)).rejects.toThrow(
      'ffmpeg exited with code 1',
    );
  });

  it('passes a timeout so a hung extraction cannot block the job forever', async () => {
    await extractThumbnail('/tmp/source.mp4', '/tmp/thumb.webp', 1);

    const call = execFileMock.mock.calls[0];
    const options = call[2] as { timeout?: number };
    expect(options.timeout).toBe(30 * 1000);
  });
});

describe('extractBlurPlaceholder', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('seeks to the given offset and extracts a tiny, heavily-compressed WebP frame', async () => {
    await extractBlurPlaceholder('/tmp/source.mp4', '/tmp/blur.webp', 5);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffmpeg');
    expect(args).toEqual(
      expect.arrayContaining([
        '-ss',
        '5',
        '-i',
        '/tmp/source.mp4',
        '-vframes',
        '1',
        '-update',
        '1',
        '-vf',
        'scale=16:-1',
        '-c:v',
        'libwebp',
        '-quality',
        '50',
        '/tmp/blur.webp',
      ]),
    );
  });

  it('propagates the error when ffmpeg fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, ...rest) => {
      const callback = rest[rest.length - 1] as (error: Error, result: unknown) => void;
      callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(extractBlurPlaceholder('/tmp/source.mp4', '/tmp/blur.webp', 1)).rejects.toThrow(
      'ffmpeg exited with code 1',
    );
  });
});

describe('extractAnimatedPreview', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('seeks to the given offset and extracts a short, muted, looping WebP (Animated Thumbnail config)', async () => {
    await extractAnimatedPreview('/tmp/source.mp4', '/tmp/preview.webp', 3, {
      durationSeconds: 1.5,
      fps: 6,
      width: 480,
    });

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffmpeg');
    expect(args).toEqual(
      expect.arrayContaining([
        '-ss',
        '3',
        '-i',
        '/tmp/source.mp4',
        '-t',
        '1.5',
        '-vf',
        'fps=6,scale=480:-1',
        '-an',
        '-c:v',
        'libwebp',
        '-loop',
        '0',
        '-quality',
        '60',
        '/tmp/preview.webp',
      ]),
    );
    // No -vframes/-update - unlike extractThumbnail/extractBlurPlaceholder,
    // this wants multiple frames, not a forced single still.
    expect(args).not.toContain('-vframes');
    expect(args).not.toContain('-update');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
  });

  it('accepts a different config (Hover/Clip Preview shape) via the same options', async () => {
    await extractAnimatedPreview('/tmp/source.mp4', '/tmp/preview.webp', 0, {
      durationSeconds: 3,
      fps: 12,
      width: 320,
    });

    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['-t', '3', '-vf', 'fps=12,scale=320:-1']));
  });

  it('propagates the error when ffmpeg fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, ...rest) => {
      const callback = rest[rest.length - 1] as (error: Error, result: unknown) => void;
      callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(
      extractAnimatedPreview('/tmp/source.mp4', '/tmp/preview.webp', 0, {
        durationSeconds: 1.5,
        fps: 6,
        width: 480,
      }),
    ).rejects.toThrow('ffmpeg exited with code 1');
  });

  it('passes a timeout so a hung extraction cannot block the job forever', async () => {
    await extractAnimatedPreview('/tmp/source.mp4', '/tmp/preview.webp', 0, {
      durationSeconds: 1.5,
      fps: 6,
      width: 480,
    });

    const call = execFileMock.mock.calls[0];
    const options = call[2] as { timeout?: number };
    expect(options.timeout).toBe(60 * 1000);
  });
});

describe('getMediaDurationSeconds', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('parses the duration in seconds from ffprobe', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: '3600.5\n', stderr: '' });
      },
    );

    const result = await getMediaDurationSeconds('/tmp/source.mp4');

    expect(result).toBe(3600.5);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffprobe');
    expect(args).toEqual(
      expect.arrayContaining(['-show_entries', 'format=duration', '/tmp/source.mp4']),
    );
  });

  it('returns NaN when ffprobe reports no duration', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: 'N/A\n', stderr: '' });
      },
    );

    expect(await getMediaDurationSeconds('/tmp/source.mp4')).toBeNaN();
  });
});

describe('getVideoCodec', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it("reads the first video stream's codec name from ffprobe", async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: 'av1\n', stderr: '' });
      },
    );

    const codec = await getVideoCodec('/tmp/source.mp4');

    expect(codec).toBe('av1');
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffprobe');
    expect(args).toEqual(
      expect.arrayContaining(['-select_streams', 'v:0', '-show_entries', 'stream=codec_name']),
    );
  });
});

describe('reencodeToH264', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('transcodes to H.264 video + AAC audio with a faststart mp4', async () => {
    await reencodeToH264('/tmp/av1.mp4', '/tmp/h264.mp4');

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffmpeg');
    expect(args).toEqual(
      expect.arrayContaining([
        '-i',
        '/tmp/av1.mp4',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        '/tmp/h264.mp4',
      ]),
    );
  });

  it('propagates the error when ffmpeg fails', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
      },
    );

    await expect(reencodeToH264('/tmp/av1.mp4', '/tmp/h264.mp4')).rejects.toThrow(
      'ffmpeg exited with code 1',
    );
  });
});

describe('renderClip', () => {
  beforeEach(() => {
    execFileMock.mockClear();
    renameMock.mockClear();
    unlinkMock.mockClear();
  });

  it('invokes ffmpeg with -ss/-t trimming and no -vf when there are no subtitles and no reframe', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 5,
      endTime: 15,
      subtitlesPath: null,
      outputPath: '/tmp/output.mp4',
      reframe: null,
    });

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining([
        '-ss',
        '5',
        '-i',
        '/tmp/source.mp4',
        '-t',
        '10',
        '/tmp/output.mp4.tmp',
      ]),
    );
    expect(args).not.toEqual(expect.arrayContaining(['-vf']));
    // ffmpeg wrote to the .tmp sibling, not the final path directly - only
    // visible at outputPath once rename() makes it so.
    expect(args).not.toContain('/tmp/output.mp4');
  });

  it('forces -f mp4 explicitly rather than letting ffmpeg infer the format from the .tmp filename (issue #28)', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 5,
      endTime: 15,
      subtitlesPath: null,
      outputPath: '/tmp/output.mp4',
      reframe: null,
    });

    const [, args] = execFileMock.mock.calls[0];
    const formatFlagIndex = args.indexOf('-f');
    expect(formatFlagIndex).toBeGreaterThanOrEqual(0);
    expect(args[formatFlagIndex + 1]).toBe('mp4');
    // -f mp4 has to come right before the (.tmp) output path, not just
    // anywhere in the args, since ffmpeg applies -f to whichever output
    // follows it.
    expect(args[formatFlagIndex + 2]).toBe('/tmp/output.mp4.tmp');
  });

  // Pre-Processing Settings roadmap (Phase 0/1).
  it('adds -preset/-crf only when a quality override is passed', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 5,
      endTime: 15,
      subtitlesPath: null,
      outputPath: '/tmp/output.mp4',
      reframe: null,
      quality: { preset: 'slow', crf: 18 },
    });

    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['-preset', 'slow', '-crf', '18']));
  });

  it('omits -preset/-crf entirely when quality is not passed (unchanged prior behavior)', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 5,
      endTime: 15,
      subtitlesPath: null,
      outputPath: '/tmp/output.mp4',
      reframe: null,
    });

    const [, args] = execFileMock.mock.calls[0];
    expect(args).not.toEqual(expect.arrayContaining(['-preset']));
    expect(args).not.toEqual(expect.arrayContaining(['-crf']));
  });

  // Output Resolution/Quality audit, Phase 0 - unconditional, unlike -preset/-crf above, since
  // this isn't a user preference; it's a correctness guard against an unforced pixel format
  // some players/browsers can't decode for a source with non-standard chroma subsampling.
  it('always forces -pix_fmt yuv420p, regardless of whether a quality override is passed', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 5,
      endTime: 15,
      subtitlesPath: null,
      outputPath: '/tmp/output.mp4',
      reframe: null,
    });

    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['-pix_fmt', 'yuv420p']));
  });

  it('atomically renames the .tmp output onto the real path only after ffmpeg succeeds', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 5,
      endTime: 15,
      subtitlesPath: null,
      outputPath: '/tmp/output.mp4',
      reframe: null,
    });

    expect(renameMock).toHaveBeenCalledWith('/tmp/output.mp4.tmp', '/tmp/output.mp4');
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('cleans up the .tmp output and does not rename when ffmpeg fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, ...rest) => {
      const callback = rest[rest.length - 1] as (error: Error, result: unknown) => void;
      callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(
      renderClip({
        inputPath: '/tmp/source.mp4',
        startTime: 0,
        endTime: 5,
        subtitlesPath: null,
        outputPath: '/tmp/output.mp4',
        reframe: null,
      }),
    ).rejects.toThrow('ffmpeg exited with code 1');

    expect(unlinkMock).toHaveBeenCalledWith('/tmp/output.mp4.tmp');
    expect(renameMock).not.toHaveBeenCalled();
  });

  it('adds a subtitles filter when subtitlesPath is provided', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 5,
      endTime: 15,
      subtitlesPath: '/tmp/captions.ass',
      outputPath: '/tmp/output.mp4',
      reframe: null,
    });

    const [, args] = execFileMock.mock.calls[0];
    const vfIndex = args.indexOf('-vf');
    expect(vfIndex).toBeGreaterThanOrEqual(0);
    expect(args[vfIndex + 1]).toBe("subtitles='/tmp/captions.ass'");
  });

  it('adds a static crop filter (no sendcmd) when reframe has no sendCmdPath', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 5,
      endTime: 15,
      subtitlesPath: null,
      outputPath: '/tmp/output.mp4',
      reframe: {
        outputWidth: 136,
        outputHeight: 240,
        width: 136,
        height: 240,
        x: 92,
        y: 0,
        sendCmdPath: null,
      },
    });

    const [, args] = execFileMock.mock.calls[0];
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toBe('crop=w=136:h=240:x=92:y=0,scale=136:240');
  });

  it('adds a sendcmd + tagged crop filter + a scale filter (to normalize any zoom) when reframe has a sendCmdPath', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 5,
      endTime: 15,
      subtitlesPath: null,
      outputPath: '/tmp/output.mp4',
      reframe: {
        outputWidth: 136,
        outputHeight: 240,
        width: 136,
        height: 240,
        x: 0,
        y: 0,
        sendCmdPath: '/tmp/cmds.txt',
      },
    });

    const [, args] = execFileMock.mock.calls[0];
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toBe("sendcmd=f='/tmp/cmds.txt',crop@reframe=w=136:h=240:x=0:y=0,scale=136:240");
  });

  it('orders crop before subtitles so captions burn onto the reframed picture', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 5,
      endTime: 15,
      subtitlesPath: '/tmp/captions.ass',
      outputPath: '/tmp/output.mp4',
      reframe: {
        outputWidth: 136,
        outputHeight: 240,
        width: 136,
        height: 240,
        x: 92,
        y: 0,
        sendCmdPath: null,
      },
    });

    const [, args] = execFileMock.mock.calls[0];
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toBe("crop=w=136:h=240:x=92:y=0,scale=136:240,subtitles='/tmp/captions.ass'");
  });

  it('propagates the error when ffmpeg fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, ...rest) => {
      const callback = rest[rest.length - 1] as (error: Error, result: unknown) => void;
      callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(
      renderClip({
        inputPath: '/tmp/source.mp4',
        startTime: 0,
        endTime: 5,
        subtitlesPath: null,
        outputPath: '/tmp/output.mp4',
        reframe: null,
      }),
    ).rejects.toThrow('ffmpeg exited with code 1');
  });

  it('passes a timeout so a hung render pass cannot block the job forever', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 0,
      endTime: 5,
      subtitlesPath: null,
      outputPath: '/tmp/output.mp4',
      reframe: null,
    });

    const [, , options] = execFileMock.mock.calls[0];
    expect((options as { timeout: number }).timeout).toBeGreaterThan(0);
  });

  describe('B-roll overlays (Fase 15)', () => {
    it('switches to -filter_complex, adding one extra input + overlay stage per cutaway', async () => {
      await renderClip({
        inputPath: '/tmp/source.mp4',
        startTime: 5,
        endTime: 15,
        subtitlesPath: null,
        outputPath: '/tmp/output.mp4',
        reframe: null,
        broll: [{ filePath: '/tmp/broll0.mov', startTime: 2, endTime: 4.5 }],
      });

      const [, args] = execFileMock.mock.calls[0];
      expect(args).toEqual(expect.arrayContaining(['-i', '/tmp/broll0.mov']));
      const fcIndex = args.indexOf('-filter_complex');
      expect(fcIndex).toBeGreaterThanOrEqual(0);
      expect(args[fcIndex + 1]).toBe(
        '[1:v]setpts=PTS-STARTPTS+2/TB[broll0];' +
          "[0:v][broll0]overlay=enable='between(t,2,4.5)'[main1]",
      );
      expect(args).toEqual(expect.arrayContaining(['-map', '[main1]', '-map', '0:a']));
      // No -vf at all once -filter_complex is in play.
      expect(args).not.toContain('-vf');
    });

    it('applies the crop chain before the overlay, and subtitles after', async () => {
      await renderClip({
        inputPath: '/tmp/source.mp4',
        startTime: 5,
        endTime: 15,
        subtitlesPath: '/tmp/captions.ass',
        outputPath: '/tmp/output.mp4',
        reframe: {
          outputWidth: 136,
          outputHeight: 240,
          width: 136,
          height: 240,
          x: 92,
          y: 0,
          sendCmdPath: null,
        },
        broll: [{ filePath: '/tmp/broll0.mov', startTime: 2, endTime: 4.5 }],
      });

      const [, args] = execFileMock.mock.calls[0];
      const fc = args[args.indexOf('-filter_complex') + 1];
      expect(fc).toBe(
        '[0:v]crop=w=136:h=240:x=92:y=0,scale=136:240[main0];' +
          '[1:v]setpts=PTS-STARTPTS+2/TB[broll0];' +
          "[main0][broll0]overlay=enable='between(t,2,4.5)'[main1];" +
          "[main1]subtitles='/tmp/captions.ass'[withsubs]",
      );
      expect(args).toEqual(expect.arrayContaining(['-map', '[withsubs]', '-map', '0:a']));
    });

    it('chains multiple B-roll cutaways in order', async () => {
      await renderClip({
        inputPath: '/tmp/source.mp4',
        startTime: 5,
        endTime: 15,
        subtitlesPath: null,
        outputPath: '/tmp/output.mp4',
        reframe: null,
        broll: [
          { filePath: '/tmp/broll0.mov', startTime: 2, endTime: 4.5 },
          { filePath: '/tmp/broll1.mov', startTime: 7, endTime: 9.5 },
        ],
      });

      const [, args] = execFileMock.mock.calls[0];
      expect(args).toEqual(
        expect.arrayContaining(['-i', '/tmp/broll0.mov', '-i', '/tmp/broll1.mov']),
      );
      const fc = args[args.indexOf('-filter_complex') + 1];
      expect(fc).toBe(
        '[1:v]setpts=PTS-STARTPTS+2/TB[broll0];' +
          "[0:v][broll0]overlay=enable='between(t,2,4.5)'[main1];" +
          '[2:v]setpts=PTS-STARTPTS+7/TB[broll1];' +
          "[main1][broll1]overlay=enable='between(t,7,9.5)'[main2]",
      );
      expect(args).toEqual(expect.arrayContaining(['-map', '[main2]', '-map', '0:a']));
    });

    it('uses the plain -vf path (no -filter_complex) when broll is null or empty', async () => {
      await renderClip({
        inputPath: '/tmp/source.mp4',
        startTime: 5,
        endTime: 15,
        subtitlesPath: null,
        outputPath: '/tmp/output.mp4',
        reframe: null,
        broll: [],
      });

      const [, args] = execFileMock.mock.calls[0];
      expect(args).not.toContain('-filter_complex');
      expect(args).not.toContain('-map');
    });
  });

  describe('Watermark overlay (P3c)', () => {
    it('switches to -filter_complex (with -loop 1) even when there is no B-roll', async () => {
      await renderClip({
        inputPath: '/tmp/source.mp4',
        startTime: 5,
        endTime: 15,
        subtitlesPath: null,
        outputPath: '/tmp/output.mp4',
        reframe: null,
        watermark: {
          filePath: '/tmp/watermark.png',
          opacity: 0.8,
          scale: 0.15,
          margin: 0.03,
          position: 'BOTTOM_RIGHT',
        },
      });

      const [, args] = execFileMock.mock.calls[0];
      expect(args).toEqual(expect.arrayContaining(['-loop', '1', '-i', '/tmp/watermark.png']));
      const fc = args[args.indexOf('-filter_complex') + 1];
      expect(fc).toBe(
        '[1:v]format=rgba,colorchannelmixer=aa=0.8[wm_prepped];' +
          '[wm_prepped][0:v]scale2ref=w=main_w*0.15:h=ow/mdar[wm_scaled][wm_main];' +
          '[wm_main][wm_scaled]overlay=x=main_w-overlay_w-(main_w*0.03):y=main_h-overlay_h-(main_w*0.03)[withwatermark]',
      );
      expect(args).toEqual(expect.arrayContaining(['-map', '[withwatermark]', '-map', '0:a']));
      expect(args).not.toContain('-vf');
    });

    it.each([
      ['TOP_LEFT', 'x=main_w*0.03:y=main_w*0.03'],
      ['TOP_RIGHT', 'x=main_w-overlay_w-(main_w*0.03):y=main_w*0.03'],
      ['BOTTOM_LEFT', 'x=main_w*0.03:y=main_h-overlay_h-(main_w*0.03)'],
      ['BOTTOM_RIGHT', 'x=main_w-overlay_w-(main_w*0.03):y=main_h-overlay_h-(main_w*0.03)'],
      ['CENTER', 'x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2'],
    ] as const)('positions %s correctly', async (position, expectedXY) => {
      await renderClip({
        inputPath: '/tmp/source.mp4',
        startTime: 5,
        endTime: 15,
        subtitlesPath: null,
        outputPath: '/tmp/output.mp4',
        reframe: null,
        watermark: {
          filePath: '/tmp/watermark.png',
          opacity: 0.8,
          scale: 0.15,
          margin: 0.03,
          position,
        },
      });

      const [, args] = execFileMock.mock.calls[0];
      const fc = args[args.indexOf('-filter_complex') + 1];
      expect(fc).toContain(`overlay=${expectedXY}[withwatermark]`);
    });

    it('is inserted LAST - after crop, B-roll, and subtitles', async () => {
      await renderClip({
        inputPath: '/tmp/source.mp4',
        startTime: 5,
        endTime: 15,
        subtitlesPath: '/tmp/captions.ass',
        outputPath: '/tmp/output.mp4',
        reframe: {
          outputWidth: 136,
          outputHeight: 240,
          width: 136,
          height: 240,
          x: 92,
          y: 0,
          sendCmdPath: null,
        },
        broll: [{ filePath: '/tmp/broll0.mov', startTime: 2, endTime: 4.5 }],
        watermark: {
          filePath: '/tmp/watermark.png',
          opacity: 0.8,
          scale: 0.15,
          margin: 0.03,
          position: 'BOTTOM_RIGHT',
        },
      });

      const [, args] = execFileMock.mock.calls[0];
      // watermark is input index 2 - main(0) + broll(1) + watermark(2).
      expect(args).toEqual(
        expect.arrayContaining(['-i', '/tmp/broll0.mov', '-loop', '1', '-i', '/tmp/watermark.png']),
      );
      const fc = args[args.indexOf('-filter_complex') + 1];
      expect(fc).toBe(
        '[0:v]crop=w=136:h=240:x=92:y=0,scale=136:240[main0];' +
          '[1:v]setpts=PTS-STARTPTS+2/TB[broll0];' +
          "[main0][broll0]overlay=enable='between(t,2,4.5)'[main1];" +
          "[main1]subtitles='/tmp/captions.ass'[withsubs];" +
          '[2:v]format=rgba,colorchannelmixer=aa=0.8[wm_prepped];' +
          '[wm_prepped][withsubs]scale2ref=w=main_w*0.15:h=ow/mdar[wm_scaled][wm_main];' +
          '[wm_main][wm_scaled]overlay=x=main_w-overlay_w-(main_w*0.03):y=main_h-overlay_h-(main_w*0.03)[withwatermark]',
      );
      expect(args).toEqual(expect.arrayContaining(['-map', '[withwatermark]', '-map', '0:a']));
    });

    it('omits the watermark stage entirely when watermark is null', async () => {
      await renderClip({
        inputPath: '/tmp/source.mp4',
        startTime: 5,
        endTime: 15,
        subtitlesPath: null,
        outputPath: '/tmp/output.mp4',
        reframe: null,
        broll: [{ filePath: '/tmp/broll0.mov', startTime: 2, endTime: 4.5 }],
        watermark: null,
      });

      const [, args] = execFileMock.mock.calls[0];
      expect(args).not.toContain('-loop');
      const fc = args[args.indexOf('-filter_complex') + 1];
      expect(fc).not.toContain('wm_scaled');
    });
  });

  // Output Resolution/Quality audit, Phase 6 (Audio params finalization).
  describe('sourceAudioChannels (audio bitrate/downmix)', () => {
    async function renderWithChannels(sourceAudioChannels?: number | null) {
      await renderClip({
        inputPath: '/tmp/source.mp4',
        startTime: 5,
        endTime: 15,
        subtitlesPath: null,
        outputPath: '/tmp/output.mp4',
        reframe: null,
        sourceAudioChannels,
      });
      return execFileMock.mock.calls[0][1] as string[];
    }

    it('pins -b:a 64k for a mono source, with no -ac downmix', async () => {
      const args = await renderWithChannels(1);
      expect(args).toEqual(expect.arrayContaining(['-b:a', '64k']));
      expect(args).not.toContain('-ac');
    });

    it('pins -b:a 128k for a stereo source, with no -ac downmix', async () => {
      const args = await renderWithChannels(2);
      expect(args).toEqual(expect.arrayContaining(['-b:a', '128k']));
      expect(args).not.toContain('-ac');
    });

    it('downmixes to stereo (-ac 2) and pins -b:a 128k for a >2-channel (e.g. 5.1 surround) source', async () => {
      const args = await renderWithChannels(6);
      expect(args).toEqual(expect.arrayContaining(['-ac', '2', '-b:a', '128k']));
    });

    it('falls back to the stereo-equivalent bitrate when the channel count is null (unprobeable source)', async () => {
      const args = await renderWithChannels(null);
      expect(args).toEqual(expect.arrayContaining(['-b:a', '128k']));
      expect(args).not.toContain('-ac');
    });

    it('falls back to the stereo-equivalent bitrate when sourceAudioChannels is omitted entirely (unchanged prior behavior for every existing caller/test)', async () => {
      const args = await renderWithChannels(undefined);
      expect(args).toEqual(expect.arrayContaining(['-b:a', '128k']));
      expect(args).not.toContain('-ac');
    });
  });
});

describe('trimAndFadeInBRoll', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('trims to the given duration, scales+crops to fill the target size, normalizes fps + color space, and fades alpha in (video asset)', async () => {
    await trimAndFadeInBRoll('/tmp/raw.mp4', '/tmp/faded-in.mov', 136, 240, 2.5, 0.3, 'video');

    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffmpeg');
    expect(args).toEqual(
      expect.arrayContaining([
        '-i',
        '/tmp/raw.mp4',
        '-t',
        '2.5',
        '-vf',
        'scale=136:240:force_original_aspect_ratio=increase,crop=136:240,fps=30,' +
          'colorspace=iall=bt709:all=bt709:range=tv,format=yuva420p,' +
          'fade=t=in:st=0:d=0.3:alpha=1',
        '-c:v',
        'qtrle',
        '-an',
        '/tmp/faded-in.mov',
      ]),
    );
    expect(args).not.toContain('-loop');
  });

  it('loops a still image via -f image2 -loop 1 for an image asset (Unsplash)', async () => {
    await trimAndFadeInBRoll('/tmp/raw.jpg', '/tmp/faded-in.mov', 136, 240, 2.5, 0.3, 'image');

    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining(['-f', 'image2', '-loop', '1', '-i', '/tmp/raw.jpg']),
    );
  });

  it('propagates the error when ffmpeg fails', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
      },
    );

    await expect(
      trimAndFadeInBRoll('/tmp/raw.mp4', '/tmp/faded-in.mov', 136, 240, 2.5, 0.3, 'video'),
    ).rejects.toThrow('ffmpeg exited with code 1');
  });
});

describe('fadeOutBRoll', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('fades alpha out over the last fadeSeconds of the clip', async () => {
    await fadeOutBRoll('/tmp/faded-in.mov', '/tmp/final.mov', 2.5, 0.3);

    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffmpeg');
    expect(args).toEqual(
      expect.arrayContaining([
        '-i',
        '/tmp/faded-in.mov',
        '-vf',
        'fade=t=out:st=2.2:d=0.3:alpha=1',
        '-c:v',
        'qtrle',
        '-an',
        '/tmp/final.mov',
      ]),
    );
  });

  it('propagates the error when ffmpeg fails', async () => {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
      },
    );

    await expect(fadeOutBRoll('/tmp/faded-in.mov', '/tmp/final.mov', 2.5, 0.3)).rejects.toThrow(
      'ffmpeg exited with code 1',
    );
  });
});

describe('trimCutRanges (Item 9 - Silence Compression AI real crossfade)', () => {
  beforeEach(() => {
    execFileMock.mockClear();
    renameMock.mockClear();
    unlinkMock.mockClear();
  });

  it('builds a segment-trim + xfade/acrossfade chain for a single cut, with matching video/audio fade durations', async () => {
    await trimCutRanges('/tmp/rendered.mp4', '/tmp/trimmed.mp4', [{ start: 2, end: 4 }], 10);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffmpeg');
    expect(args).toEqual(expect.arrayContaining(['-i', '/tmp/rendered.mp4']));

    const fc = args[args.indexOf('-filter_complex') + 1];
    // totalInputDuration = 10 (totalOutputDuration) + 2 (the cut's own length) = 12. Kept
    // segments are [0,2] and [4,12] - both far longer than 2 * CROSSFADE_SECONDS, so the full
    // 0.15s fade applies. offset = (duration of segment 0) - fade = 2 - 0.15 = 1.85.
    expect(fc).toBe(
      '[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS[v0];' +
        '[0:v]trim=start=4:end=12,setpts=PTS-STARTPTS[v1];' +
        '[v0][v1]xfade=transition=fade:duration=0.15:offset=1.85[vx1];' +
        '[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS[a0];' +
        '[0:a]atrim=start=4:end=12,asetpts=PTS-STARTPTS[a1];' +
        '[a0][a1]acrossfade=d=0.15:c1=tri:c2=tri[ax1]',
    );
    expect(args).toEqual(expect.arrayContaining(['-map', '[vx1]', '-map', '[ax1]']));
    expect(args).not.toContain('/tmp/trimmed.mp4');
  });

  it('chains xfade/acrossfade across multiple junctions, tracking cumulative video duration for each offset', async () => {
    await trimCutRanges(
      '/tmp/rendered.mp4',
      '/tmp/trimmed.mp4',
      [
        { start: 2, end: 4 },
        { start: 10, end: 10.5 },
      ],
      20,
    );

    const [, args] = execFileMock.mock.calls[0];
    const fc = args[args.indexOf('-filter_complex') + 1];
    // totalInputDuration = 20 + 2.5 = 22.5. Segments: [0,2] (dur 2), [4,10] (dur 6),
    // [10.5,22.5] (dur 12). First junction offset = 2 - 0.15 = 1.85. Second junction's offset is
    // relative to the FIRST xfade's own cumulative output duration (2 + 6 - 0.15 = 7.85), not the
    // raw segment boundary - 7.85 - 0.15 = 7.7.
    expect(fc).toContain('[v0][v1]xfade=transition=fade:duration=0.15:offset=1.85[vx1]');
    expect(fc).toContain('[vx1][v2]xfade=transition=fade:duration=0.15:offset=7.7[vx2]');
    expect(fc).toContain('[a0][a1]acrossfade=d=0.15:c1=tri:c2=tri[ax1]');
    expect(fc).toContain('[ax1][a2]acrossfade=d=0.15:c1=tri:c2=tri[ax2]');
    expect(args).toEqual(expect.arrayContaining(['-map', '[vx2]', '-map', '[ax2]']));
  });

  it('falls back to a plain hard concat (no xfade/acrossfade) at a junction whose kept segment is too short for a meaningful dissolve', async () => {
    // The middle kept segment here is only 0.03s (between the two cuts) - half of that (0.015s)
    // is below MIN_CROSSFADE_SECONDS (0.02), so BOTH junctions touching it fall back to a plain
    // concat rather than passing an effectively-zero duration into xfade/acrossfade.
    await trimCutRanges(
      '/tmp/rendered.mp4',
      '/tmp/trimmed.mp4',
      [
        { start: 2, end: 3 },
        { start: 3.03, end: 5 },
      ],
      10,
    );

    const [, args] = execFileMock.mock.calls[0];
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).not.toContain('xfade');
    expect(fc).not.toContain('acrossfade');
    expect(fc).toContain('[v0][v1]concat=n=2:v=1:a=0[vx1]');
    expect(fc).toContain('[vx1][v2]concat=n=2:v=1:a=0[vx2]');
    expect(fc).toContain('[a0][a1]concat=n=2:v=0:a=1[ax1]');
    expect(fc).toContain('[ax1][a2]concat=n=2:v=0:a=1[ax2]');
    expect(args).toEqual(expect.arrayContaining(['-map', '[vx2]', '-map', '[ax2]']));
  });

  it('forces -f mp4 explicitly rather than letting ffmpeg infer the format from the .tmp filename (issue #28)', async () => {
    await trimCutRanges('/tmp/rendered.mp4', '/tmp/trimmed.mp4', [{ start: 0, end: 1 }], 10);

    const [, args] = execFileMock.mock.calls[0];
    const formatFlagIndex = args.indexOf('-f');
    expect(formatFlagIndex).toBeGreaterThanOrEqual(0);
    expect(args[formatFlagIndex + 1]).toBe('mp4');
    expect(args[formatFlagIndex + 2]).toBe('/tmp/trimmed.mp4.tmp');
  });

  // Output Resolution/Quality audit, Phase 0 - regression coverage for the quality-propagation
  // fix: this re-encode pass previously had no way to honor the user's chosen -preset/-crf at
  // all, always silently falling back to ffmpeg's own default (CRF 23, medium) regardless of
  // what renderClip()'s own first pass used.
  it('adds -preset/-crf only when a quality override is passed', async () => {
    await trimCutRanges('/tmp/rendered.mp4', '/tmp/trimmed.mp4', [{ start: 0, end: 1 }], 10, {
      preset: 'slow',
      crf: 18,
    });

    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['-preset', 'slow', '-crf', '18']));
  });

  it('omits -preset/-crf entirely when quality is not passed (unchanged prior behavior)', async () => {
    await trimCutRanges('/tmp/rendered.mp4', '/tmp/trimmed.mp4', [{ start: 0, end: 1 }], 10);

    const [, args] = execFileMock.mock.calls[0];
    expect(args).not.toEqual(expect.arrayContaining(['-preset']));
    expect(args).not.toEqual(expect.arrayContaining(['-crf']));
  });

  it('always forces -pix_fmt yuv420p, regardless of whether a quality override is passed', async () => {
    await trimCutRanges('/tmp/rendered.mp4', '/tmp/trimmed.mp4', [{ start: 0, end: 1 }], 10);

    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['-pix_fmt', 'yuv420p']));
  });

  // Output Resolution/Quality audit, Phase 5 (FPS/CFR policy) - regression coverage for the fix:
  // a genuinely variable-frame-rate source (large real gaps between frames) can have a crossfade
  // junction's own fade window land inside a gap with no actual frame data, which real ffmpeg
  // verification (ffmpeg.crossfade.integration.spec.ts) found drops frames and leaves video
  // shorter than audio. Normalizing every kept segment to the source's own real rate, floored at
  // MIN_FPS_FOR_CROSSFADE_SAFETY, before xfade/concat fixes it - see that constant's own comment
  // for why the floor is required (the raw source rate alone isn't sufficient for a genuinely
  // sparse VFR source, also verified against real ffmpeg).
  describe('frameRate (fps= normalization)', () => {
    it('adds fps= to every kept segment when a frame rate is provided', async () => {
      await trimCutRanges(
        '/tmp/rendered.mp4',
        '/tmp/trimmed.mp4',
        [{ start: 2, end: 4 }],
        10,
        null,
        '30000/1001',
      );

      const [, args] = execFileMock.mock.calls[0];
      const fc = args[args.indexOf('-filter_complex') + 1];
      expect(fc).toBe(
        '[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS,fps=30000/1001[v0];' +
          '[0:v]trim=start=4:end=12,setpts=PTS-STARTPTS,fps=30000/1001[v1];' +
          '[v0][v1]xfade=transition=fade:duration=0.15:offset=1.85[vx1];' +
          '[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS[a0];' +
          '[0:a]atrim=start=4:end=12,asetpts=PTS-STARTPTS[a1];' +
          '[a0][a1]acrossfade=d=0.15:c1=tri:c2=tri[ax1]',
      );
    });

    it('omits fps= from every segment when frameRate is not passed (unchanged prior behavior)', async () => {
      await trimCutRanges('/tmp/rendered.mp4', '/tmp/trimmed.mp4', [{ start: 2, end: 4 }], 10);

      const [, args] = execFileMock.mock.calls[0];
      const fc = args[args.indexOf('-filter_complex') + 1];
      expect(fc).not.toContain('fps=');
    });

    it('omits fps= when frameRate is explicitly null (unprobeable source, same as omitted)', async () => {
      await trimCutRanges(
        '/tmp/rendered.mp4',
        '/tmp/trimmed.mp4',
        [{ start: 2, end: 4 }],
        10,
        null,
        null,
      );

      const [, args] = execFileMock.mock.calls[0];
      const fc = args[args.indexOf('-filter_complex') + 1];
      expect(fc).not.toContain('fps=');
    });

    it('applies fps= to every segment even at a junction that falls back to a plain concat (no fade)', async () => {
      // Same fixture as the "falls back to a plain hard concat" test above - the middle kept
      // segment is too short (0.03s) for a meaningful crossfade, so both junctions concat
      // instead. fps= normalization still applies uniformly to every segment regardless.
      await trimCutRanges(
        '/tmp/rendered.mp4',
        '/tmp/trimmed.mp4',
        [
          { start: 2, end: 3 },
          { start: 3.03, end: 5 },
        ],
        10,
        null,
        '25/1',
      );

      const [, args] = execFileMock.mock.calls[0];
      const fc = args[args.indexOf('-filter_complex') + 1];
      expect(fc).toContain('[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS,fps=25/1[v0]');
      expect(fc).toContain('[0:v]trim=start=3:end=3.03,setpts=PTS-STARTPTS,fps=25/1[v1]');
      expect(fc).toContain('[0:v]trim=start=5:end=12.97,setpts=PTS-STARTPTS,fps=25/1[v2]');
      expect(fc).not.toContain('xfade');
    });

    it('floors a too-slow source rate at 15fps rather than normalizing to it directly (real ffmpeg verification found the raw rate alone insufficient)', async () => {
      await trimCutRanges(
        '/tmp/rendered.mp4',
        '/tmp/trimmed.mp4',
        [{ start: 2, end: 4 }],
        10,
        null,
        '2/1', // a genuinely sparse VFR source averaging 2fps
      );

      const [, args] = execFileMock.mock.calls[0];
      const fc = args[args.indexOf('-filter_complex') + 1];
      expect(fc).toContain('fps=15');
      expect(fc).not.toContain('fps=2/1');
    });

    it('passes an already-fast-enough rate through unchanged, exact precision preserved (no floor applied)', async () => {
      await trimCutRanges(
        '/tmp/rendered.mp4',
        '/tmp/trimmed.mp4',
        [{ start: 2, end: 4 }],
        10,
        null,
        '30000/1001', // ~29.97fps, well above the 15fps floor
      );

      const [, args] = execFileMock.mock.calls[0];
      const fc = args[args.indexOf('-filter_complex') + 1];
      expect(fc).toContain('fps=30000/1001');
    });
  });

  // Output Resolution/Quality audit, Phase 6 (Audio params finalization). Unlike the frameRate
  // parameter, this receives an ALREADY-CLAMPED channel count from the caller (never a raw
  // >2-channel source count) - see the parameter's own comment - so there is no downmix case to
  // test here at all, only the resulting bitrate.
  describe('sourceAudioChannels (audio bitrate)', () => {
    it('pins -b:a 64k when the caller passes a clamped mono channel count', async () => {
      await trimCutRanges(
        '/tmp/rendered.mp4',
        '/tmp/trimmed.mp4',
        [{ start: 2, end: 4 }],
        10,
        null,
        null,
        1,
      );

      const [, args] = execFileMock.mock.calls[0];
      expect(args).toEqual(expect.arrayContaining(['-b:a', '64k']));
      expect(args).not.toContain('-ac');
    });

    it('pins -b:a 128k when the caller passes a clamped stereo channel count', async () => {
      await trimCutRanges(
        '/tmp/rendered.mp4',
        '/tmp/trimmed.mp4',
        [{ start: 2, end: 4 }],
        10,
        null,
        null,
        2,
      );

      const [, args] = execFileMock.mock.calls[0];
      expect(args).toEqual(expect.arrayContaining(['-b:a', '128k']));
    });

    it('falls back to the stereo-equivalent bitrate when sourceAudioChannels is not passed (unchanged prior behavior for every existing caller/test)', async () => {
      await trimCutRanges('/tmp/rendered.mp4', '/tmp/trimmed.mp4', [{ start: 2, end: 4 }], 10);

      const [, args] = execFileMock.mock.calls[0];
      expect(args).toEqual(expect.arrayContaining(['-b:a', '128k']));
    });
  });

  it('atomically renames the .tmp output onto the real path only after ffmpeg succeeds', async () => {
    await trimCutRanges('/tmp/rendered.mp4', '/tmp/trimmed.mp4', [{ start: 0, end: 1 }], 10);

    expect(renameMock).toHaveBeenCalledWith('/tmp/trimmed.mp4.tmp', '/tmp/trimmed.mp4');
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('cleans up the .tmp output and does not rename when ffmpeg fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, ...rest) => {
      const callback = rest[rest.length - 1] as (error: Error, result: unknown) => void;
      callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(
      trimCutRanges('/tmp/rendered.mp4', '/tmp/trimmed.mp4', [{ start: 0, end: 1 }], 10),
    ).rejects.toThrow('ffmpeg exited with code 1');

    expect(unlinkMock).toHaveBeenCalledWith('/tmp/trimmed.mp4.tmp');
    expect(renameMock).not.toHaveBeenCalled();
  });

  it('propagates the error when ffmpeg fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, ...rest) => {
      const callback = rest[rest.length - 1] as (error: Error, result: unknown) => void;
      callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(
      trimCutRanges('/tmp/rendered.mp4', '/tmp/trimmed.mp4', [{ start: 0, end: 1 }], 10),
    ).rejects.toThrow('ffmpeg exited with code 1');
  });

  it('passes a timeout so a hung trim pass cannot block the job forever', async () => {
    await trimCutRanges('/tmp/rendered.mp4', '/tmp/trimmed.mp4', [{ start: 0, end: 1 }], 10);

    const [, , options] = execFileMock.mock.calls[0];
    expect((options as { timeout: number }).timeout).toBeGreaterThan(0);
  });
});

describe('concatBrandSegment (P3d intro / P3e outro)', () => {
  beforeEach(() => {
    execFileMock.mockClear();
    renameMock.mockClear();
    unlinkMock.mockClear();
  });

  // Queues one ffprobe-shaped success response, consumed in call order by
  // whichever probe concatBrandSegment() issues first (duration, then audio
  // presence, for a video-type segment) - mirrors getMediaDurationSeconds'
  // own spec's mockImplementationOnce shape.
  function queueProbeResponse(stdout: string) {
    execFileMockBehavior.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout, stderr: '' });
      },
    );
  }

  it.each(['start', 'end'] as const)(
    "builds the image-segment filter graph (position '%s'): -f image2 -loop 1, default hold duration, synthesized silent audio, no ffprobe calls",
    async (position) => {
      await concatBrandSegment(
        position,
        '/tmp/clip.mp4',
        { filePath: '/tmp/segment.png', type: 'image', imageDurationSeconds: null },
        608,
        1080,
        '/tmp/output.mp4',
      );

      // No ffprobe needed at all for an image segment - duration comes from
      // the (defaulted) imageDurationSeconds, and it never has audio to
      // probe for.
      expect(execFileMock).toHaveBeenCalledTimes(1);
      const [file, args] = execFileMock.mock.calls[0];
      expect(file).toBe('ffmpeg');
      expect(args).toEqual(
        expect.arrayContaining(['-f', 'image2', '-loop', '1', '-i', '/tmp/segment.png']),
      );
      expect(args).toEqual(
        expect.arrayContaining([
          '-f',
          'lavfi',
          '-i',
          'anullsrc=sample_rate=44100:channel_layout=stereo',
        ]),
      );
      const fc = args[args.indexOf('-filter_complex') + 1];
      const expectedConcat =
        position === 'start'
          ? '[segv][sega][clipv][clipa]concat=n=2:v=1:a=1[outv][outa]'
          : '[clipv][clipa][segv][sega]concat=n=2:v=1:a=1[outv][outa]';
      expect(fc).toBe(
        '[0:v]scale=608:1080:force_original_aspect_ratio=increase,crop=608:1080,fps=30,' +
          'colorspace=iall=bt709:all=bt709:range=tv,format=yuv420p,' +
          'setsar=1,trim=duration=3,setpts=PTS-STARTPTS[segv];' +
          '[2:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=duration=3,' +
          'asetpts=PTS-STARTPTS[sega];' +
          '[1:v]fps=30,format=yuv420p,setsar=1[clipv];' +
          '[1:a]aformat=sample_rates=44100:channel_layouts=stereo[clipa];' +
          expectedConcat,
      );
      expect(args).toEqual(expect.arrayContaining(['-map', '[outv]', '-map', '[outa]']));
    },
  );

  // Output Resolution/Quality audit, Phase 6 (Audio params finalization) - a fixed constant, not
  // data-dependent, since this function's own filter graph already forces both the segment and
  // main clip's audio to stereo before the concat (see the filter graph asserted above), regardless
  // of either source's real channel count.
  it('always pins -b:a 128k (this function forces stereo audio by construction)', async () => {
    await concatBrandSegment(
      'start',
      '/tmp/clip.mp4',
      { filePath: '/tmp/segment.png', type: 'image', imageDurationSeconds: null },
      608,
      1080,
      '/tmp/output.mp4',
    );

    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['-b:a', '128k']));
  });

  it("puts the segment first in the concat order for position 'start' (intro)", async () => {
    await concatBrandSegment(
      'start',
      '/tmp/clip.mp4',
      { filePath: '/tmp/segment.png', type: 'image', imageDurationSeconds: null },
      608,
      1080,
      '/tmp/output.mp4',
    );

    const [, args] = execFileMock.mock.calls[0];
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('[segv][sega][clipv][clipa]concat=n=2:v=1:a=1[outv][outa]');
  });

  it("puts the segment last in the concat order for position 'end' (outro)", async () => {
    await concatBrandSegment(
      'end',
      '/tmp/clip.mp4',
      { filePath: '/tmp/segment.png', type: 'image', imageDurationSeconds: null },
      608,
      1080,
      '/tmp/output.mp4',
    );

    const [, args] = execFileMock.mock.calls[0];
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('[clipv][clipa][segv][sega]concat=n=2:v=1:a=1[outv][outa]');
  });

  it('uses a custom image hold duration when imageDurationSeconds is set', async () => {
    await concatBrandSegment(
      'start',
      '/tmp/clip.mp4',
      { filePath: '/tmp/segment.png', type: 'image', imageDurationSeconds: 5 },
      608,
      1080,
      '/tmp/output.mp4',
    );

    const [, args] = execFileMock.mock.calls[0];
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('trim=duration=5,setpts=PTS-STARTPTS[segv]');
    expect(fc).toContain('atrim=duration=5,asetpts=PTS-STARTPTS[sega]');
  });

  it('probes duration and audio presence for a video segment, and references its own 0:a when audio exists', async () => {
    queueProbeResponse('4.2'); // getMediaDurationSeconds
    queueProbeResponse('audio'); // hasAudioStream - non-empty codec_type means present

    await concatBrandSegment(
      'start',
      '/tmp/clip.mp4',
      { filePath: '/tmp/segment.mp4', type: 'video', imageDurationSeconds: null },
      608,
      1080,
      '/tmp/output.mp4',
    );

    expect(execFileMock).toHaveBeenCalledTimes(3);
    const [probe1File, probe1Args] = execFileMock.mock.calls[0];
    expect(probe1File).toBe('ffprobe');
    expect(probe1Args).toEqual(expect.arrayContaining(['/tmp/segment.mp4']));
    const [probe2File, probe2Args] = execFileMock.mock.calls[1];
    expect(probe2File).toBe('ffprobe');
    expect(probe2Args).toEqual(expect.arrayContaining(['-select_streams', 'a:0']));

    const [, renderArgs] = execFileMock.mock.calls[2];
    expect(renderArgs).toEqual(expect.arrayContaining(['-i', '/tmp/segment.mp4']));
    expect(renderArgs).not.toContain('anullsrc=sample_rate=44100:channel_layout=stereo');
    const fc = renderArgs[renderArgs.indexOf('-filter_complex') + 1];
    expect(fc).toContain('trim=duration=4.2,setpts=PTS-STARTPTS[segv]');
    expect(fc).toContain(
      '[0:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=duration=4.2,' +
        'asetpts=PTS-STARTPTS[sega]',
    );
  });

  it('synthesizes silent audio for a video segment with no audio stream', async () => {
    queueProbeResponse('4.2'); // getMediaDurationSeconds
    queueProbeResponse(''); // hasAudioStream - empty means no audio stream

    await concatBrandSegment(
      'start',
      '/tmp/clip.mp4',
      { filePath: '/tmp/segment.mp4', type: 'video', imageDurationSeconds: null },
      608,
      1080,
      '/tmp/output.mp4',
    );

    const [, args] = execFileMock.mock.calls[2];
    expect(args).toEqual(
      expect.arrayContaining([
        '-f',
        'lavfi',
        '-i',
        'anullsrc=sample_rate=44100:channel_layout=stereo',
      ]),
    );
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain(
      '[2:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=duration=4.2,' +
        'asetpts=PTS-STARTPTS[sega]',
    );
  });

  it('caps a video segment longer than MAX_INTRO_DURATION_SECONDS', async () => {
    queueProbeResponse('999'); // way over the cap
    queueProbeResponse('audio');

    await concatBrandSegment(
      'end',
      '/tmp/clip.mp4',
      { filePath: '/tmp/segment.mp4', type: 'video', imageDurationSeconds: null },
      608,
      1080,
      '/tmp/output.mp4',
    );

    const [, args] = execFileMock.mock.calls[2];
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('trim=duration=10,setpts=PTS-STARTPTS[segv]');
  });

  it('atomically renames the .tmp output onto the real path only after ffmpeg succeeds', async () => {
    await concatBrandSegment(
      'start',
      '/tmp/clip.mp4',
      { filePath: '/tmp/segment.png', type: 'image', imageDurationSeconds: null },
      608,
      1080,
      '/tmp/output.mp4',
    );

    expect(renameMock).toHaveBeenCalledWith('/tmp/output.mp4.tmp', '/tmp/output.mp4');
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('cleans up the .tmp output and does not rename when ffmpeg fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, ...rest) => {
      const callback = rest[rest.length - 1] as (error: Error, result: unknown) => void;
      callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(
      concatBrandSegment(
        'start',
        '/tmp/clip.mp4',
        { filePath: '/tmp/segment.png', type: 'image', imageDurationSeconds: null },
        608,
        1080,
        '/tmp/output.mp4',
      ),
    ).rejects.toThrow('ffmpeg exited with code 1');

    expect(unlinkMock).toHaveBeenCalledWith('/tmp/output.mp4.tmp');
    expect(renameMock).not.toHaveBeenCalled();
  });
});

// Visual Emphasis Engine Phase C6R.2 ("Reaction Hold Temporal Extension" - see docs/ai/
// visual-emphasis-engine.md's "C6R design" section). These exact-args assertions can only prove
// this function BUILDS the filter graph it intends to - see
// ffmpeg.reaction-hold.integration.spec.ts for the real-ffmpeg proof that the graph actually
// produces the correct freeze/silence/duration behavior (the acceptance gate the C6R design
// explicitly required before this sub-phase could ship).
describe('applyReactionHolds (C6R.2)', () => {
  beforeEach(() => {
    execFileMock.mockClear();
    renameMock.mockClear();
    unlinkMock.mockClear();
  });

  it('throws without touching ffmpeg at all for an empty hold-instants array', async () => {
    await expect(applyReactionHolds('/tmp/clip.mp4', '/tmp/output.mp4', [])).rejects.toThrow(
      /no hold instants/,
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('builds a 3-segment (pre/hold/post) filter graph for a single hold instant, at the default hold duration', async () => {
    await applyReactionHolds('/tmp/clip.mp4', '/tmp/output.mp4', [3]);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffmpeg');
    // Main clip at input 0, one anullsrc silence input at index 1.
    expect(args).toEqual(expect.arrayContaining(['-i', '/tmp/clip.mp4']));
    expect(args).toEqual(
      expect.arrayContaining([
        '-f',
        'lavfi',
        '-i',
        'anullsrc=sample_rate=44100:channel_layout=stereo',
      ]),
    );

    const fc = args[args.indexOf('-filter_complex') + 1];
    // All video segments are built first, then all audio segments, then the two concat stages -
    // matching applyReactionHolds()'s own build order (videoParts, then audioParts).
    expect(fc).toBe(
      '[0:v]trim=start=0:end=3,setpts=PTS-STARTPTS[v0pre];' +
        '[0:v]trim=start=3:end=3.05,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=0.45[v0hold];' +
        '[0:v]trim=start=3.05,setpts=PTS-STARTPTS[v1post];' +
        '[0:a]atrim=start=0:end=3,asetpts=PTS-STARTPTS,' +
        'aformat=sample_rates=44100:channel_layouts=stereo[a0pre];' +
        '[1:a]atrim=duration=0.5[a0hold];' +
        '[0:a]atrim=start=3.05,asetpts=PTS-STARTPTS,' +
        'aformat=sample_rates=44100:channel_layouts=stereo[a1post];' +
        '[v0pre][v0hold][v1post]concat=n=3:v=1:a=0[outv];' +
        '[a0pre][a0hold][a1post]concat=n=3:v=0:a=1[outa]',
    );
    expect(args).toEqual(expect.arrayContaining(['-map', '[outv]', '-map', '[outa]']));
  });

  // Output Resolution/Quality audit, Phase 6 (Audio params finalization) - a fixed constant, not
  // data-dependent, since this function's own audioParts already force stereo audio (see the
  // aformat=...channel_layouts=stereo calls in the filter graph asserted above) regardless of the
  // input's real channel count.
  it('always pins -b:a 128k (this function forces stereo audio by construction)', async () => {
    await applyReactionHolds('/tmp/clip.mp4', '/tmp/output.mp4', [3]);

    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['-b:a', '128k']));
  });

  it('honors a custom hold duration, subtracting the freeze-slice epsilon from tpad stop_duration only', async () => {
    await applyReactionHolds('/tmp/clip.mp4', '/tmp/output.mp4', [2], 1);

    const [, args] = execFileMock.mock.calls[0];
    const fc = args[args.indexOf('-filter_complex') + 1];
    // Total inserted time (freeze slice + stop_duration) is exactly holdDurationSeconds (1s) -
    // stop_duration is 0.95 (1 - 0.05 epsilon), not the full 1s, so the pad doesn't overshoot.
    expect(fc).toContain('tpad=stop_mode=clone:stop_duration=0.95[v0hold]');
    // The synthesized silence input is trimmed to the FULL requested hold duration, not reduced
    // by the epsilon - only the video pad subtracts it (to account for the freeze slice itself
    // already contributing 0.05s of frozen video).
    expect(fc).toContain('[1:a]atrim=duration=1[a0hold]');
  });

  it('builds a 5-segment filter graph and one anullsrc input per hold, for two hold instants', async () => {
    await applyReactionHolds('/tmp/clip.mp4', '/tmp/output.mp4', [1.5, 4], 0.5);

    const [, args] = execFileMock.mock.calls[0];
    const anullsrcCount = args.filter(
      (a) => a === 'anullsrc=sample_rate=44100:channel_layout=stereo',
    ).length;
    expect(anullsrcCount).toBe(2);

    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('[v0pre][v0hold][v1pre][v1hold][v2post]concat=n=5:v=1:a=0[outv]');
    expect(fc).toContain('[a0pre][a0hold][a1pre][a1hold][a2post]concat=n=5:v=0:a=1[outa]');
    // The second hold's pre-segment starts right where the first hold's frozen slice ended
    // (1.5 + 0.05 = 1.55), not back at the original 1.5 - each pre-segment picks up from the
    // previous hold's own freeze-slice end, same cursor-advancing shape as cutlist's own cut
    // math.
    expect(fc).toContain('[0:v]trim=start=1.55:end=4,setpts=PTS-STARTPTS[v1pre]');
    // References input 2 (the second anullsrc) for the second hold's silence.
    expect(fc).toContain('[2:a]atrim=duration=0.5[a1hold]');
  });

  // Output Resolution/Quality audit, Phase 0 - same quality-propagation fix/regression
  // coverage as trimCutRanges() above; this pass had the identical gap.
  it('adds -preset/-crf only when a quality override is passed', async () => {
    await applyReactionHolds('/tmp/clip.mp4', '/tmp/output.mp4', [3], 0.5, {
      preset: 'slow',
      crf: 18,
    });

    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['-preset', 'slow', '-crf', '18']));
  });

  it('omits -preset/-crf entirely when quality is not passed (unchanged prior behavior)', async () => {
    await applyReactionHolds('/tmp/clip.mp4', '/tmp/output.mp4', [3]);

    const [, args] = execFileMock.mock.calls[0];
    expect(args).not.toEqual(expect.arrayContaining(['-preset']));
    expect(args).not.toEqual(expect.arrayContaining(['-crf']));
  });

  it('always forces -pix_fmt yuv420p, regardless of whether a quality override is passed', async () => {
    await applyReactionHolds('/tmp/clip.mp4', '/tmp/output.mp4', [3]);

    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['-pix_fmt', 'yuv420p']));
  });

  it('atomically renames the .tmp output onto the real path only after ffmpeg succeeds', async () => {
    await applyReactionHolds('/tmp/clip.mp4', '/tmp/output.mp4', [3]);

    expect(renameMock).toHaveBeenCalledWith('/tmp/output.mp4.tmp', '/tmp/output.mp4');
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('cleans up the .tmp output and does not rename when ffmpeg fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, ...rest) => {
      const callback = rest[rest.length - 1] as (error: Error, result: unknown) => void;
      callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(applyReactionHolds('/tmp/clip.mp4', '/tmp/output.mp4', [3])).rejects.toThrow(
      'ffmpeg exited with code 1',
    );

    expect(unlinkMock).toHaveBeenCalledWith('/tmp/output.mp4.tmp');
    expect(renameMock).not.toHaveBeenCalled();
  });
});
