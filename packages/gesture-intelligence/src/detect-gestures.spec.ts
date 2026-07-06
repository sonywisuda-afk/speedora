import { detectGestures, type ExecFileFn } from './detect-gestures';

// No node:child_process mocking at all - the subprocess call is injected via
// deps.execFile, same pattern as facial-intelligence/reframe.
function fakeDeps(execFile: ExecFileFn) {
  return {
    execFile,
    pythonPath: 'python3',
    scriptPath: '/app/scripts/detect_gestures.py',
    modelPath: '/app/models/gesture_recognizer.task',
  };
}

describe('detectGestures', () => {
  it('shells out with the video path, time range, sample interval, and model path', async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: '[]', stderr: '' });

    await detectGestures(
      { sourcePath: '/tmp/source.mp4', startTime: 10, endTime: 20 },
      fakeDeps(execFile),
    );

    expect(execFile).toHaveBeenCalledWith('python3', [
      '/app/scripts/detect_gestures.py',
      '/tmp/source.mp4',
      '10',
      '20',
      '1',
      '/app/models/gesture_recognizer.task',
    ]);
  });

  it('parses the JSON array of gesture samples from stdout', async () => {
    const execFile = jest.fn().mockResolvedValue({
      stdout: JSON.stringify([
        { t: 0, gesture: 'thumb_up', confidence: 0.91 },
        { t: 1, gesture: null, confidence: null },
      ]),
      stderr: '',
    });

    const result = await detectGestures(
      { sourcePath: '/tmp/source.mp4', startTime: 0, endTime: 2 },
      fakeDeps(execFile),
    );

    expect(result).toEqual([
      { t: 0, gesture: 'thumb_up', confidence: 0.91 },
      { t: 1, gesture: null, confidence: null },
    ]);
  });

  it('propagates the error when the python subprocess fails', async () => {
    const execFile = jest.fn().mockRejectedValue(new Error('python3 exited with code 1'));

    await expect(
      detectGestures(
        { sourcePath: '/tmp/source.mp4', startTime: 0, endTime: 5 },
        fakeDeps(execFile),
      ),
    ).rejects.toThrow('python3 exited with code 1');
  });

  it('throws when stdout is not valid JSON matching the output contract', async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: 'not json', stderr: '' });

    await expect(
      detectGestures(
        { sourcePath: '/tmp/source.mp4', startTime: 0, endTime: 5 },
        fakeDeps(execFile),
      ),
    ).rejects.toThrow();
  });

  it('rejects a malformed input against the detectGesturesInputSchema contract', async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: '[]', stderr: '' });

    await expect(
      detectGestures({ sourcePath: '/tmp/source.mp4' } as never, fakeDeps(execFile)),
    ).rejects.toThrow();
  });
});
