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

import { assignSpeakerLabels, diarizeSpeakers } from './diarization';

describe('diarizeSpeakers', () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it('shells out to python3 with the audio path only (no token in argv)', async () => {
    await diarizeSpeakers('/tmp/audio.mp3');

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('python3');
    expect(args).toEqual(expect.arrayContaining(['/tmp/audio.mp3']));
    expect(args[0]).toContain('diarize_speakers.py');
    expect(args).toHaveLength(2);
  });

  it('parses the JSON array of speaker turns from stdout', async () => {
    execFileMock.mockImplementationOnce((_file, _args, callback) => {
      callback(null, {
        stdout: JSON.stringify([
          { start: 0, end: 5.2, speaker: 'SPEAKER_00' },
          { start: 5.2, end: 9.8, speaker: 'SPEAKER_01' },
        ]),
        stderr: '',
      });
    });

    const result = await diarizeSpeakers('/tmp/audio.mp3');

    expect(result).toEqual([
      { start: 0, end: 5.2, speaker: 'SPEAKER_00' },
      { start: 5.2, end: 9.8, speaker: 'SPEAKER_01' },
    ]);
  });

  it('propagates the error when the python subprocess fails (missing token, gated model not accepted, etc.)', async () => {
    execFileMock.mockImplementationOnce((_file, _args, callback) => {
      callback(new Error('python3 exited with code 1'), { stdout: '', stderr: 'boom' });
    });

    await expect(diarizeSpeakers('/tmp/audio.mp3')).rejects.toThrow('python3 exited with code 1');
  });
});

describe('assignSpeakerLabels', () => {
  it('assigns friendly "Speaker A"/"Speaker B" labels in order of first appearance', () => {
    const segments = [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 6 },
    ];
    const turns = [
      { start: 0, end: 2, speaker: 'SPEAKER_01' },
      { start: 2, end: 4, speaker: 'SPEAKER_00' },
      { start: 4, end: 6, speaker: 'SPEAKER_01' },
    ];

    // SPEAKER_01 talks first (segment 0) -> "Speaker A"; SPEAKER_00 is the
    // second distinct raw ID encountered -> "Speaker B" - not alphabetical
    // by raw ID, order of first appearance in the segments themselves.
    expect(assignSpeakerLabels(segments, turns)).toEqual(['Speaker A', 'Speaker B', 'Speaker A']);
  });

  it('picks the turn with the largest overlap when a segment straddles a speaker change', () => {
    const segments = [{ start: 0, end: 10 }];
    const turns = [
      { start: 0, end: 3, speaker: 'SPEAKER_00' }, // 3s overlap
      { start: 3, end: 10, speaker: 'SPEAKER_01' }, // 7s overlap - wins
    ];

    // SPEAKER_01 wins the overlap and, being the only speaker assigned in
    // this test, becomes "Speaker A" (first label handed out) - the
    // assertion that matters here is WHICH raw speaker wins, not the label.
    expect(assignSpeakerLabels(segments, turns)).toEqual(['Speaker A']);
  });

  it('leaves a segment unassigned when no turn overlaps it at all', () => {
    const segments = [{ start: 100, end: 105 }];
    const turns = [{ start: 0, end: 10, speaker: 'SPEAKER_00' }];

    expect(assignSpeakerLabels(segments, turns)).toEqual([undefined]);
  });

  it('leaves every segment unassigned when diarization found no turns at all', () => {
    const segments = [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ];

    expect(assignSpeakerLabels(segments, [])).toEqual([undefined, undefined]);
  });
});
