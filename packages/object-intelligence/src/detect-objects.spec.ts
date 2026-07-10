import { detectObjects, type ExecFileFn } from './detect-objects';

// No node:child_process mocking at all - the subprocess call is injected via
// deps.execFile, same pattern as facial-intelligence/gesture-intelligence.
function fakeDeps(execFile: ExecFileFn) {
  return {
    execFile,
    pythonPath: 'python3',
    scriptPath: '/app/scripts/detect_objects.py',
    modelPath: '/app/models/efficientdet_lite0.tflite',
  };
}

describe('detectObjects', () => {
  it('shells out with the video path, time range, sample interval, and model path', async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: '[]', stderr: '' });

    await detectObjects(
      { sourcePath: '/tmp/source.mp4', startTime: 10, endTime: 20 },
      fakeDeps(execFile),
    );

    expect(execFile).toHaveBeenCalledWith('python3', [
      '/app/scripts/detect_objects.py',
      '/tmp/source.mp4',
      '10',
      '20',
      '1',
      '/app/models/efficientdet_lite0.tflite',
    ]);
  });

  it('parses the JSON array of object samples from stdout', async () => {
    const execFile = jest.fn().mockResolvedValue({
      stdout: JSON.stringify([
        {
          t: 0,
          objects: [
            {
              category: 'person',
              boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
              confidence: 0.91,
            },
          ],
        },
        { t: 1, objects: [] },
      ]),
      stderr: '',
    });

    const result = await detectObjects(
      { sourcePath: '/tmp/source.mp4', startTime: 0, endTime: 2 },
      fakeDeps(execFile),
    );

    expect(result).toEqual([
      {
        t: 0,
        objects: [
          {
            category: 'person',
            boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
            confidence: 0.91,
          },
        ],
      },
      { t: 1, objects: [] },
    ]);
  });

  it('propagates the error when the python subprocess fails', async () => {
    const execFile = jest.fn().mockRejectedValue(new Error('python3 exited with code 1'));

    await expect(
      detectObjects(
        { sourcePath: '/tmp/source.mp4', startTime: 0, endTime: 5 },
        fakeDeps(execFile),
      ),
    ).rejects.toThrow('python3 exited with code 1');
  });

  it('throws when stdout is not valid JSON matching the output contract', async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: 'not json', stderr: '' });

    await expect(
      detectObjects(
        { sourcePath: '/tmp/source.mp4', startTime: 0, endTime: 5 },
        fakeDeps(execFile),
      ),
    ).rejects.toThrow();
  });

  it('rejects a malformed input against the detectObjectsInputSchema contract', async () => {
    const execFile = jest.fn().mockResolvedValue({ stdout: '[]', stderr: '' });

    await expect(
      detectObjects({ sourcePath: '' } as never, fakeDeps(execFile)),
    ).rejects.toThrow();
  });
});
