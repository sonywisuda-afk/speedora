const execFileMock = jest.fn(
  (
    _file: string,
    _args: string[],
    _options: unknown,
    callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    callback(null, { stdout: '', stderr: '' });
  },
);

jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => (execFileMock as unknown as (...a: unknown[]) => void)(...args),
}));

import { downloadYoutubeVideo } from './youtube';

describe('downloadYoutubeVideo', () => {
  beforeEach(() => {
    execFileMock.mockClear();
    delete process.env.YTDLP_PATH;
    delete process.env.FFMPEG_PATH;
  });

  it('invokes yt-dlp with the url, an exact output path, and mp4 merge format', async () => {
    await downloadYoutubeVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '/tmp/out.mp4');

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('yt-dlp');
    expect(args).toEqual(
      expect.arrayContaining([
        '--no-playlist',
        '--merge-output-format',
        'mp4',
        '-o',
        '/tmp/out.mp4',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      ]),
    );
  });

  it('prefers H.264 (avc1) video so the source preview plays in every browser', async () => {
    await downloadYoutubeVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '/tmp/out.mp4');

    const [, args] = execFileMock.mock.calls[0];
    const format = args[args.indexOf('-f') + 1];
    // First-choice selector must pin avc1 video; AV1 is only a later fallback.
    expect(format.startsWith('bv*[vcodec^=avc1]')).toBe(true);
  });

  it('uses YTDLP_PATH when set, instead of the "yt-dlp" default', async () => {
    process.env.YTDLP_PATH = '/opt/bin/yt-dlp';
    jest.resetModules();
    jest.doMock('node:child_process', () => ({
      execFile: (...args: unknown[]) =>
        (execFileMock as unknown as (...a: unknown[]) => void)(...args),
    }));
    const { downloadYoutubeVideo: downloadWithOverride } = await import('./youtube');

    await downloadWithOverride('https://youtu.be/dQw4w9WgXcQ', '/tmp/out.mp4');

    const [file] = execFileMock.mock.calls[0];
    expect(file).toBe('/opt/bin/yt-dlp');
  });

  it('does not pass --ffmpeg-location when FFMPEG_PATH is unset', async () => {
    await downloadYoutubeVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '/tmp/out.mp4');

    const [, args] = execFileMock.mock.calls[0];
    expect(args).not.toContain('--ffmpeg-location');
  });

  it('passes --ffmpeg-location to yt-dlp when FFMPEG_PATH is set, so its own merge subprocess can find ffmpeg even when ffmpeg is not on the system PATH', async () => {
    process.env.FFMPEG_PATH = 'C:\\ffmpeg\\bin\\ffmpeg.exe';

    await downloadYoutubeVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '/tmp/out.mp4');

    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining(['--ffmpeg-location', 'C:\\ffmpeg\\bin\\ffmpeg.exe']),
    );
  });

  it('propagates the error when yt-dlp fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
      callback(new Error('yt-dlp exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(
      downloadYoutubeVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '/tmp/out.mp4'),
    ).rejects.toThrow('yt-dlp exited with code 1');
  });
});
