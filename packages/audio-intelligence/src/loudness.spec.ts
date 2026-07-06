import { analyzeAudioLoudness, type ExecFileFn } from './loudness';

// Fixture text shaped like ffmpeg's real astats filter output (per
// documented format - NOT captured from a real ffmpeg run, see loudness.ts's
// "KNOWN GAP" comment). Deliberately gives the per-channel and "Overall"
// sections DIFFERENT numbers so the tests actually prove "last match wins"
// picks the Overall section, rather than passing by coincidence.
function fakeAstatsStderr(overallRmsDb: number, overallPeakDb: number): string {
  return `
[Parsed_astats_0 @ 0x1] Channel: 1
[Parsed_astats_0 @ 0x1] Peak level dB: -99.000000
[Parsed_astats_0 @ 0x1] RMS level dB: -99.000000
[Parsed_astats_0 @ 0x1] Overall
[Parsed_astats_0 @ 0x1]   Peak level dB: ${overallPeakDb}
[Parsed_astats_0 @ 0x1]   RMS level dB: ${overallRmsDb}
`;
}

function fakeDeps(execFile: ExecFileFn) {
  return { execFile, ffmpegPath: 'ffmpeg' };
}

describe('analyzeAudioLoudness', () => {
  it("calls ffmpeg's astats filter once per segment, trimmed to that segment's own range", async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: '', stderr: fakeAstatsStderr(-20, -3) });

    await analyzeAudioLoudness(
      { audioPath: '/tmp/audio.mp3', segments: [{ start: 5, end: 10 }] },
      fakeDeps(execFile),
    );

    expect(execFile).toHaveBeenCalledWith('ffmpeg', [
      '-ss',
      '5',
      '-to',
      '10',
      '-i',
      '/tmp/audio.mp3',
      '-af',
      'astats',
      '-f',
      'null',
      '-',
    ]);
  });

  it("parses the Overall section's RMS/peak level, not the per-channel section", async () => {
    const execFile = jest
      .fn()
      .mockResolvedValue({ stdout: '', stderr: fakeAstatsStderr(-18.5, -2.25) });

    const result = await analyzeAudioLoudness(
      { audioPath: '/tmp/audio.mp3', segments: [{ start: 0, end: 5 }] },
      fakeDeps(execFile),
    );

    expect(result.segments).toEqual([{ rmsDb: -18.5, peakDb: -2.25 }]);
  });

  it('analyzes multiple segments independently, one ffmpeg call each', async () => {
    const execFile = jest
      .fn()
      .mockResolvedValueOnce({ stdout: '', stderr: fakeAstatsStderr(-30, -10) })
      .mockResolvedValueOnce({ stdout: '', stderr: fakeAstatsStderr(-12, -1) });

    const result = await analyzeAudioLoudness(
      {
        audioPath: '/tmp/audio.mp3',
        segments: [
          { start: 0, end: 5 },
          { start: 5, end: 10 },
        ],
      },
      fakeDeps(execFile),
    );

    expect(execFile).toHaveBeenCalledTimes(2);
    expect(result.segments).toEqual([
      { rmsDb: -30, peakDb: -10 },
      { rmsDb: -12, peakDb: -1 },
    ]);
  });

  it('returns null readings (not a thrown error) for a segment whose ffmpeg call fails', async () => {
    const execFile = jest
      .fn()
      .mockResolvedValueOnce({ stdout: '', stderr: fakeAstatsStderr(-20, -3) })
      .mockRejectedValueOnce(new Error('ffmpeg exited with code 1'));

    const result = await analyzeAudioLoudness(
      {
        audioPath: '/tmp/audio.mp3',
        segments: [
          { start: 0, end: 5 },
          { start: 5, end: 5.001 },
        ],
      },
      fakeDeps(execFile),
    );

    expect(result.segments).toEqual([
      { rmsDb: -20, peakDb: -3 },
      { rmsDb: null, peakDb: null },
    ]);
  });

  it('returns null readings when the stderr has no recognizable astats output at all', async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: '', stderr: 'unexpected garbage' });

    const result = await analyzeAudioLoudness(
      { audioPath: '/tmp/audio.mp3', segments: [{ start: 0, end: 5 }] },
      fakeDeps(execFile),
    );

    expect(result.segments).toEqual([{ rmsDb: null, peakDb: null }]);
  });

  it('rejects a malformed input against the analyzeAudioLoudnessInputSchema contract', async () => {
    const execFile = jest.fn();
    await expect(
      analyzeAudioLoudness({ segments: [] } as never, fakeDeps(execFile)),
    ).rejects.toThrow();
    expect(execFile).not.toHaveBeenCalled();
  });
});
