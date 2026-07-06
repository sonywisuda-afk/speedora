import { detectFacialEmotion, type ExecFileFn } from './detect-facial-emotion';

// No node:child_process mocking at all - the subprocess call is injected via
// deps.execFile (see detect-facial-emotion.ts's DetectFacialEmotionDeps),
// same pattern as @speedora/reframe's face-detection.spec.ts.
function fakeDeps(execFile: ExecFileFn) {
  return {
    execFile,
    pythonPath: 'python3',
    scriptPath: '/app/scripts/detect_facial_emotion.py',
    modelPath: '/app/models/blaze_face_short_range.tflite',
  };
}

describe('detectFacialEmotion', () => {
  it('shells out with the video path, time range, and sample interval', async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: '[]', stderr: '' });

    await detectFacialEmotion(
      { sourcePath: '/tmp/source.mp4', startTime: 10, endTime: 20 },
      fakeDeps(execFile),
    );

    expect(execFile).toHaveBeenCalledWith('python3', [
      '/app/scripts/detect_facial_emotion.py',
      '/tmp/source.mp4',
      '10',
      '20',
      '1',
      '/app/models/blaze_face_short_range.tflite',
    ]);
  });

  it('parses the JSON array of facial emotion samples from stdout', async () => {
    const execFile = jest.fn().mockResolvedValue({
      stdout: JSON.stringify([
        { t: 0, emotion: 'happy', score: 0.91 },
        { t: 1, emotion: null, score: null },
      ]),
      stderr: '',
    });

    const result = await detectFacialEmotion(
      { sourcePath: '/tmp/source.mp4', startTime: 0, endTime: 2 },
      fakeDeps(execFile),
    );

    expect(result).toEqual([
      { t: 0, emotion: 'happy', score: 0.91 },
      { t: 1, emotion: null, score: null },
    ]);
  });

  it('propagates the error when the python subprocess fails', async () => {
    const execFile = jest.fn().mockRejectedValue(new Error('python3 exited with code 1'));

    await expect(
      detectFacialEmotion(
        { sourcePath: '/tmp/source.mp4', startTime: 0, endTime: 5 },
        fakeDeps(execFile),
      ),
    ).rejects.toThrow('python3 exited with code 1');
  });

  it('throws when stdout is not valid JSON matching the output contract', async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: 'not json', stderr: '' });

    await expect(
      detectFacialEmotion(
        { sourcePath: '/tmp/source.mp4', startTime: 0, endTime: 5 },
        fakeDeps(execFile),
      ),
    ).rejects.toThrow();
  });

  it('rejects a malformed input against the detectFacialEmotionInputSchema contract', async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: '[]', stderr: '' });

    await expect(
      detectFacialEmotion({ sourcePath: '/tmp/source.mp4' } as never, fakeDeps(execFile)),
    ).rejects.toThrow();
  });
});
