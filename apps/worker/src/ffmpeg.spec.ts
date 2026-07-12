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
  escapeFfmpegFilterPath,
  extractAudio,
  extractBlurPlaceholder,
  extractThumbnail,
  fadeOutBRoll,
  getMediaDurationSeconds,
  getVideoCodec,
  getVideoDimensions,
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
    expect(vf).toBe('crop=w=136:h=240:x=92:y=0');
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
    expect(vf).toBe("crop=w=136:h=240:x=92:y=0,subtitles='/tmp/captions.ass'");
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
        '[0:v]crop=w=136:h=240:x=92:y=0[main0];' +
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

describe('trimCutRanges', () => {
  beforeEach(() => {
    execFileMock.mockClear();
    renameMock.mockClear();
    unlinkMock.mockClear();
  });

  it('builds a select/aselect filter that keeps everything outside the given cut ranges, plus a single eq dip filter combining every junction', async () => {
    await trimCutRanges(
      '/tmp/rendered.mp4',
      '/tmp/trimmed.mp4',
      [
        { start: 2, end: 4 },
        { start: 10, end: 10.5 },
      ],
      20,
    );

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('ffmpeg');
    expect(args).toEqual(
      expect.arrayContaining([
        '-i',
        '/tmp/rendered.mp4',
        '-vf',
        "select='not(between(t,2,4)+between(t,10,10.5))',setpts=N/FRAME_RATE/TB," +
          "eq=eval=frame:brightness='min(" +
          'if(lt(abs(t-2),0.15),-(0.15-abs(t-2))/0.15,0),' +
          "if(lt(abs(t-8),0.15),-(0.15-abs(t-8))/0.15,0))'",
        // Audio stays a plain hard cut - no dip (see trimCutRanges' comment
        // on why the audio-side equivalent was dropped after real testing).
        '-af',
        "aselect='not(between(t,2,4)+between(t,10,10.5))',asetpts=N/SR/TB",
        '/tmp/trimmed.mp4.tmp',
      ]),
    );
    expect(args).not.toContain('/tmp/trimmed.mp4');
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

  it('skips a junction transition too close to the very start or end of the output', async () => {
    // Junction 1 is at t=0.05 (the first cut's own start) - too close to the
    // start to dip against nothing before it. totalOutputDuration is 0.2, so
    // a junction near the very end would similarly be skipped (not
    // exercised by this single-cut case, but the same filter applies).
    await trimCutRanges('/tmp/rendered.mp4', '/tmp/trimmed.mp4', [{ start: 0.05, end: 1 }], 0.2);

    const [, args] = execFileMock.mock.calls[0];
    const vfIndex = args.indexOf('-vf');
    expect(args[vfIndex + 1]).toBe("select='not(between(t,0.05,1))',setpts=N/FRAME_RATE/TB");
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
