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

import { detectFaces } from './faceDetection';

describe('detectFaces', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('shells out to python3 with the video path, time range, sample interval, and model path', async () => {
    await detectFaces('/tmp/source.mp4', 10, 20);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('python3');
    expect(args).toEqual(expect.arrayContaining(['/tmp/source.mp4', '10', '20', '1']));
    expect(args[0]).toContain('detect_faces.py');
  });

  it('parses the JSON array of face samples from stdout', async () => {
    execFileMock.mockImplementationOnce((_file, _args, callback) => {
      callback(null, {
        stdout: JSON.stringify([
          { t: 0, box: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.3 } },
          { t: 1, box: null },
        ]),
        stderr: '',
      });
    });

    const result = await detectFaces('/tmp/source.mp4', 0, 2);

    expect(result).toEqual([
      { t: 0, box: { xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.3 } },
      { t: 1, box: null },
    ]);
  });

  it('propagates the error when the python subprocess fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, callback) => {
      callback(new Error('python3 exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(detectFaces('/tmp/source.mp4', 0, 5)).rejects.toThrow(
      'python3 exited with code 1',
    );
  });
});
