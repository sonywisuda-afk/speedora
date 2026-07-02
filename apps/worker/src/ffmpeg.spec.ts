import type { TranscriptSegment } from '@viral-clip-app/shared';

const execFileMock = jest.fn(
  (
    _file: string,
    _args: string[],
    callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    callback(null, { stdout: '', stderr: '' });
  },
);

jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => (execFileMock as unknown as (...a: unknown[]) => void)(...args),
}));

import { buildSrt, escapeFfmpegFilterPath, renderClip } from './ffmpeg';

describe('buildSrt', () => {
  const segments: TranscriptSegment[] = [
    { start: 10, end: 12, text: 'hello' },
    { start: 13, end: 15, text: 'world' },
  ];

  it('shifts segment timestamps relative to the clip start', () => {
    const srt = buildSrt(segments, 10, 20);

    expect(srt).toContain('00:00:00,000 --> 00:00:02,000');
    expect(srt).toContain('hello');
    expect(srt).toContain('00:00:03,000 --> 00:00:05,000');
    expect(srt).toContain('world');
  });

  it('clamps segment end times to the clip duration', () => {
    const srt = buildSrt([{ start: 18, end: 25, text: 'overflow' }], 10, 20);

    expect(srt).toContain('00:00:08,000 --> 00:00:10,000');
  });

  it('drops segments that end at or before the clip start (zero/negative duration)', () => {
    const srt = buildSrt([{ start: 0, end: 10, text: 'before clip' }], 10, 20);

    expect(srt).toBe('');
  });

  it('returns an empty string when there are no overlapping segments', () => {
    expect(buildSrt([], 10, 20)).toBe('');
  });

  it('numbers cues sequentially starting at 1', () => {
    const srt = buildSrt(segments, 10, 20);

    expect(srt.startsWith('1\n')).toBe(true);
    expect(srt).toContain('\n2\n');
  });
});

describe('escapeFfmpegFilterPath', () => {
  it('escapes a Windows absolute path for use in a subtitles= filter', () => {
    expect(escapeFfmpegFilterPath('C:\\Users\\me\\clip.srt')).toBe('C\\:/Users/me/clip.srt');
  });

  it('leaves a POSIX path without a drive letter mostly unchanged', () => {
    expect(escapeFfmpegFilterPath('/tmp/clip.srt')).toBe('/tmp/clip.srt');
  });
});

describe('renderClip', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('invokes ffmpeg with -ss/-t trimming and no subtitles filter when srtPath is null', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 5,
      endTime: 15,
      srtPath: null,
      outputPath: '/tmp/output.mp4',
    });

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining(['-ss', '5', '-i', '/tmp/source.mp4', '-t', '10', '/tmp/output.mp4']),
    );
    expect(args).not.toEqual(expect.arrayContaining(['-vf']));
  });

  it('adds a subtitles filter when srtPath is provided', async () => {
    await renderClip({
      inputPath: '/tmp/source.mp4',
      startTime: 5,
      endTime: 15,
      srtPath: '/tmp/captions.srt',
      outputPath: '/tmp/output.mp4',
    });

    const [, args] = execFileMock.mock.calls[0];
    const vfIndex = args.indexOf('-vf');
    expect(vfIndex).toBeGreaterThanOrEqual(0);
    expect(args[vfIndex + 1]).toBe("subtitles='/tmp/captions.srt'");
  });

  it('propagates the error when ffmpeg fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, callback) => {
      callback(new Error('ffmpeg exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(
      renderClip({
        inputPath: '/tmp/source.mp4',
        startTime: 0,
        endTime: 5,
        srtPath: null,
        outputPath: '/tmp/output.mp4',
      }),
    ).rejects.toThrow('ffmpeg exited with code 1');
  });
});
