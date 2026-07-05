const execFileMock = jest.fn(
  (
    _file: string,
    _args: string[],
    callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    callback(null, { stdout: '[]', stderr: '' });
  },
);

jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => (execFileMock as unknown as (...a: unknown[]) => void)(...args),
}));

const writeFileMock = jest.fn().mockResolvedValue(undefined);
jest.mock('node:fs/promises', () => ({
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}));

let scratchCounter = 0;
const reserveScratchPathMock = jest.fn(
  (prefix: string, ext: string) => `/scratch/${prefix}-${scratchCounter++}${ext}`,
);
const cleanupTempFileMock = jest.fn().mockResolvedValue(undefined);
jest.mock('./storage', () => ({
  reserveScratchPath: (...args: [string, string]) => reserveScratchPathMock(...args),
  cleanupTempFile: (...args: unknown[]) => cleanupTempFileMock(...args),
}));

import { detectVocalEmotions } from './vocalEmotion';

describe('detectVocalEmotions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    scratchCounter = 0;
  });

  it('writes segments to a scratch JSON file and shells out to python3 with the audio path and that file', async () => {
    const segments = [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ];

    await detectVocalEmotions('/tmp/audio.mp3', segments);

    expect(reserveScratchPathMock).toHaveBeenCalledWith('vocal-emotion-segments', '.json');
    expect(writeFileMock).toHaveBeenCalledWith(
      '/scratch/vocal-emotion-segments-0.json',
      JSON.stringify(segments),
    );
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('python3');
    expect(args[0]).toContain('detect_vocal_emotion.py');
    expect(args[1]).toBe('/tmp/audio.mp3');
    expect(args[2]).toBe('/scratch/vocal-emotion-segments-0.json');
  });

  it('cleans up the scratch segments file after the script runs', async () => {
    await detectVocalEmotions('/tmp/audio.mp3', []);

    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/vocal-emotion-segments-0.json');
  });

  it('cleans up the scratch segments file even when the script fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, callback) => {
      callback(new Error('python3 exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(detectVocalEmotions('/tmp/audio.mp3', [])).rejects.toThrow(
      'python3 exited with code 1',
    );
    expect(cleanupTempFileMock).toHaveBeenCalledWith('/scratch/vocal-emotion-segments-0.json');
  });

  it('parses the JSON array of emotion results (including null for skipped segments) from stdout', async () => {
    execFileMock.mockImplementationOnce((_file, _args, callback) => {
      callback(null, {
        stdout: JSON.stringify([{ emotion: 'hap', score: 0.83 }, null]),
        stderr: '',
      });
    });

    const result = await detectVocalEmotions('/tmp/audio.mp3', [
      { start: 0, end: 2 },
      { start: 2, end: 2.1 },
    ]);

    expect(result).toEqual([{ emotion: 'hap', score: 0.83 }, null]);
  });
});
