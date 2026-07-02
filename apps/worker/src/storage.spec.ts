import * as os from 'node:os';
import * as path from 'node:path';

const mkdirMock = jest.fn();
const unlinkMock = jest.fn();

jest.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  unlink: (...args: unknown[]) => unlinkMock(...args),
}));

import { cleanupTempFile, reserveScratchPath } from './storage';

describe('reserveScratchPath', () => {
  beforeEach(() => {
    mkdirMock.mockReset().mockResolvedValue(undefined);
  });

  it('returns a path under os.tmpdir()/viral-clip-app with the given prefix and extension', async () => {
    const result = await reserveScratchPath('source', '.mp4');

    const expectedDir = path.join(os.tmpdir(), 'viral-clip-app');
    expect(result.startsWith(expectedDir)).toBe(true);
    expect(path.basename(result)).toMatch(/^source-[0-9a-f-]{36}\.mp4$/);
  });

  it('ensures the scratch directory exists before returning', async () => {
    await reserveScratchPath('captions', '.srt');

    expect(mkdirMock).toHaveBeenCalledWith(path.join(os.tmpdir(), 'viral-clip-app'), {
      recursive: true,
    });
  });

  it('generates a unique path on every call', async () => {
    const a = await reserveScratchPath('output', '.mp4');
    const b = await reserveScratchPath('output', '.mp4');

    expect(a).not.toBe(b);
  });
});

describe('cleanupTempFile', () => {
  it('unlinks the given path', async () => {
    unlinkMock.mockResolvedValue(undefined);

    await cleanupTempFile('/tmp/viral-clip-app/source-abc.mp4');

    expect(unlinkMock).toHaveBeenCalledWith('/tmp/viral-clip-app/source-abc.mp4');
  });

  it('swallows errors (e.g. file already gone) instead of throwing', async () => {
    unlinkMock.mockRejectedValue(new Error('ENOENT'));

    await expect(cleanupTempFile('/tmp/viral-clip-app/missing.mp4')).resolves.toBeUndefined();
  });
});
