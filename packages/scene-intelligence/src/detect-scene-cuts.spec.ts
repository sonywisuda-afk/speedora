import { detectSceneCuts, type ExecFileFn } from './detect-scene-cuts';

// Fixture text shaped like ffmpeg's real showinfo filter output (per
// documented format - NOT captured from a real ffmpeg run, see
// detect-scene-cuts.ts's "PENDING REAL-MACHINE VERIFICATION" comment).
function fakeShowinfoStderr(ptsTimes: number[]): string {
  const lines = ptsTimes.map(
    (t, i) =>
      `[Parsed_showinfo_1 @ 0x1] n:${i.toString().padStart(4)} pts:${(t * 1000).toFixed(0)} ` +
      `pts_time:${t} duration:40 duration_time:0.04 fmt:yuv420p sar:1/1 s:1920x1080 i:P iskey:1 ` +
      `type:I checksum:AAAA plane_checksum:[AAAA] mean:[100] stdev:[10]`,
  );
  return ['[Parsed_showinfo_1 @ 0x1] config in time_base: 1/25, frame_rate: 25/1', ...lines].join(
    '\n',
  );
}

function fakeDeps(execFile: ExecFileFn) {
  return { execFile, ffmpegPath: 'ffmpeg' };
}

describe('detectSceneCuts', () => {
  it("calls ffmpeg's select/showinfo filters trimmed to the given time range with the default threshold", async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: '', stderr: fakeShowinfoStderr([]) });

    await detectSceneCuts(
      { videoPath: '/tmp/source.mp4', startTime: 10, endTime: 20 },
      fakeDeps(execFile),
    );

    expect(execFile).toHaveBeenCalledWith('ffmpeg', [
      '-ss',
      '10',
      '-to',
      '20',
      '-i',
      '/tmp/source.mp4',
      '-vf',
      "select='gt(scene,0.4)',showinfo",
      '-f',
      'null',
      '-',
    ]);
  });

  it('uses a custom threshold when given one', async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: '', stderr: fakeShowinfoStderr([]) });

    await detectSceneCuts(
      { videoPath: '/tmp/source.mp4', startTime: 0, endTime: 5, threshold: 0.25 },
      fakeDeps(execFile),
    );

    expect(execFile).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(["select='gt(scene,0.25)',showinfo"]),
    );
  });

  it('parses every pts_time occurrence as one cut timestamp, in order', async () => {
    const execFile = jest
      .fn()
      .mockResolvedValue({ stdout: '', stderr: fakeShowinfoStderr([1.2, 5.6, 9.75]) });

    const result = await detectSceneCuts(
      { videoPath: '/tmp/source.mp4', startTime: 0, endTime: 10 },
      fakeDeps(execFile),
    );

    expect(result.cuts).toEqual([1.2, 5.6, 9.75]);
  });

  it('returns an empty cuts array when no frame passes the scene-change filter', async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: '', stderr: fakeShowinfoStderr([]) });

    const result = await detectSceneCuts(
      { videoPath: '/tmp/source.mp4', startTime: 0, endTime: 10 },
      fakeDeps(execFile),
    );

    expect(result.cuts).toEqual([]);
  });

  it('returns an empty cuts array (not a thrown error) when the ffmpeg call fails', async () => {
    const execFile = jest.fn().mockRejectedValue(new Error('ffmpeg exited with code 1'));

    const result = await detectSceneCuts(
      { videoPath: '/tmp/source.mp4', startTime: 0, endTime: 10 },
      fakeDeps(execFile),
    );

    expect(result.cuts).toEqual([]);
  });

  it('rejects a malformed input against the detectSceneCutsInputSchema contract', async () => {
    const execFile = jest.fn();
    await expect(detectSceneCuts({ startTime: 0 } as never, fakeDeps(execFile))).rejects.toThrow();
    expect(execFile).not.toHaveBeenCalled();
  });
});
