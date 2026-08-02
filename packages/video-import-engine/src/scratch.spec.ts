import { reserveScratchPath } from './scratch';
import type { ImportDeps } from './types';

function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(`simulated ${code}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function createDeps(overrides: Partial<ImportDeps['fs']> = {}): ImportDeps {
  return {
    spawn: jest.fn() as unknown as ImportDeps['spawn'],
    execFile: jest.fn() as unknown as ImportDeps['execFile'],
    fs: {
      mkdir: jest.fn(async () => undefined),
      unlink: jest.fn(async () => undefined),
      stat: jest.fn(async () => ({ size: 0 })),
      ...overrides,
    },
    sleep: jest.fn(async () => undefined),
    now: jest.fn(() => 0),
    randomId: jest.fn(() => 'random-id'),
    config: {
      binaryPath: 'yt-dlp',
      ffmpegPath: null,
      timeoutMs: 1000,
      retryPolicy: { maxAttempts: 1, baseDelayMs: 10, factor: 2, maxDelayMs: 100 },
      cookiesFile: null,
      proxyUrl: null,
      extraArgs: [],
      allowedDomains: [],
      scratchDir: '/tmp/scratch',
      minVersion: null,
      maxFileSizeBytes: null,
      killGraceMs: 1000,
    },
  };
}

describe('reserveScratchPath', () => {
  it('returns a path inside the scratch dir using randomId()', async () => {
    const deps = createDeps();

    const result = await reserveScratchPath(deps);

    expect(result).toContain('random-id.mp4');
    expect(deps.fs.mkdir).toHaveBeenCalledWith('/tmp/scratch');
  });

  it('reclassifies an ENOSPC mkdir failure into a disk VideoImportError', async () => {
    const deps = createDeps({ mkdir: jest.fn(async () => Promise.reject(errnoError('ENOSPC'))) });

    await expect(reserveScratchPath(deps)).rejects.toMatchObject({
      name: 'VideoImportError',
      category: 'disk',
      retryable: false,
    });
  });

  it('reclassifies an EACCES mkdir failure into a permission VideoImportError', async () => {
    const deps = createDeps({ mkdir: jest.fn(async () => Promise.reject(errnoError('EACCES'))) });

    await expect(reserveScratchPath(deps)).rejects.toMatchObject({
      name: 'VideoImportError',
      category: 'permission',
      retryable: false,
    });
  });

  it('rethrows an unrecognized mkdir failure unclassified', async () => {
    const rawError = new Error('unexpected failure');
    const deps = createDeps({ mkdir: jest.fn(async () => Promise.reject(rawError)) });

    await expect(reserveScratchPath(deps)).rejects.toBe(rawError);
  });
});
