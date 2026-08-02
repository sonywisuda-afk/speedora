import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ImportDeps, SpawnedProcess, VideoImportEngineConfig } from '../types';
import { YtDlpEngine } from './ytDlpEngine';

// A minimal fake child process: real stdout/stderr streams (so the engine's
// own line-buffering logic runs unmodified) plus an EventEmitter's on/emit
// for the process-level 'error'/'close' events - same technique the old
// apps/worker/src/youtube.spec.ts used against node:child_process directly.
// Here it's simpler: ImportDeps.spawn is injected, so there's no need to
// jest.mock('node:child_process') at all.
function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: jest.Mock;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = jest.fn();
  return child;
}

type FakeChild = ReturnType<typeof createFakeChild>;

// download() awaits reserveScratchPath() (itself an await on deps.fs.mkdir)
// before ever calling deps.spawn - purely microtask-driven, never
// timer-driven, so this flush works the same whether or not
// jest.useFakeTimers() is active for a given test.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 15; i += 1) {
    await Promise.resolve();
  }
}

function createHarness(configOverrides: Partial<VideoImportEngineConfig> = {}) {
  let lastChild: FakeChild | undefined;
  const spawnMock = jest.fn<SpawnedProcess, [string, string[]]>(() => {
    lastChild = createFakeChild();
    return lastChild as unknown as SpawnedProcess;
  });
  const execFileMock = jest.fn<
    Promise<{ stdout: string; stderr: string }>,
    [string, string[], { timeoutMs: number }]
  >(async () => ({ stdout: '', stderr: '' }));
  const mkdirMock = jest.fn(async () => undefined);
  const unlinkMock = jest.fn(async () => undefined);
  const statMock = jest.fn(async () => ({ size: 0 }));
  let idCounter = 0;

  const deps: ImportDeps = {
    spawn: spawnMock as unknown as ImportDeps['spawn'],
    execFile: execFileMock,
    fs: { mkdir: mkdirMock, unlink: unlinkMock, stat: statMock },
    sleep: jest.fn(async () => undefined),
    now: jest.fn(() => 0),
    randomId: jest.fn(() => `id-${idCounter++}`),
    config: {
      binaryPath: 'yt-dlp',
      ffmpegPath: null,
      timeoutMs: 60 * 60 * 1000,
      retryPolicy: { maxAttempts: 1, baseDelayMs: 10, factor: 2, maxDelayMs: 100 },
      cookiesFile: null,
      proxyUrl: null,
      extraArgs: [],
      allowedDomains: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
      scratchDir: '/tmp/scratch',
      minVersion: null,
      maxFileSizeBytes: null,
      killGraceMs: 1000,
      ...configOverrides,
    },
  };

  return {
    deps,
    spawnMock,
    execFileMock,
    unlinkMock,
    statMock,
    getLastChild: () => {
      if (!lastChild) throw new Error('spawn was not called yet - did the test forget to flush?');
      return lastChild;
    },
  };
}

describe('YtDlpEngine.download', () => {
  it('downloads to the reserved scratch path and resolves with duration/retries', async () => {
    const { deps, spawnMock, getLastChild } = createHarness();

    const promise = YtDlpEngine.download({ url: 'https://www.youtube.com/watch?v=abc' }, deps);
    await flushMicrotasks();
    getLastChild().emit('close', 0);
    const result = await promise;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [file, args] = spawnMock.mock.calls[0];
    expect(file).toBe('yt-dlp');
    expect(args).toEqual(
      expect.arrayContaining([
        '--merge-output-format',
        'mp4',
        '-o',
        path.join('/tmp/scratch', 'id-0.mp4'),
        'https://www.youtube.com/watch?v=abc',
      ]),
    );
    expect(result).toEqual({
      outputPath: path.join('/tmp/scratch', 'id-0.mp4'),
      durationMs: 0,
      retries: 0,
    });
  });

  it('prefers H.264 (avc1) video so the source preview plays in every browser', async () => {
    const { deps, spawnMock, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    getLastChild().emit('close', 0);
    await promise;

    const [, args] = spawnMock.mock.calls[0];
    const format = args[args.indexOf('-f') + 1];
    expect(format.startsWith('bv*[vcodec^=avc1]')).toBe(true);
  });

  it('passes --ffmpeg-location, --cookies and --proxy only when configured', async () => {
    const { deps, spawnMock, getLastChild } = createHarness({
      ffmpegPath: '/opt/ffmpeg',
      cookiesFile: '/cookies.txt',
      proxyUrl: 'http://proxy:8080',
    });
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    getLastChild().emit('close', 0);
    await promise;

    const [, args] = spawnMock.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining([
        '--ffmpeg-location',
        '/opt/ffmpeg',
        '--cookies',
        '/cookies.txt',
        '--proxy',
        'http://proxy:8080',
      ]),
    );
  });

  it('does not pass --ffmpeg-location/--cookies/--proxy when unset', async () => {
    const { deps, spawnMock, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    getLastChild().emit('close', 0);
    await promise;

    const [, args] = spawnMock.mock.calls[0];
    expect(args).not.toContain('--ffmpeg-location');
    expect(args).not.toContain('--cookies');
    expect(args).not.toContain('--proxy');
  });

  it('reports progress percentages parsed from --progress-template output', async () => {
    const { deps, getLastChild } = createHarness();
    const onProgress = jest.fn();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps, { onProgress });
    await flushMicrotasks();
    const child = getLastChild();
    child.stdout.write('SPEEDORA_PROGRESS  45.2%\n');
    child.emit('close', 0);
    await promise;

    expect(onProgress).toHaveBeenCalledWith(45.2);
  });

  it('rejects with a "network" category when yt-dlp exits non-zero with an HTTP 403', async () => {
    const { deps, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    const child = getLastChild();
    child.stderr.write('ERROR: unable to download video data: HTTP Error 403: Forbidden\n');
    child.emit('close', 1);

    await expect(promise).rejects.toMatchObject({
      name: 'VideoImportError',
      category: 'network',
      exitCode: 1,
      retryable: true,
    });
  });

  it('categorizes a private-video failure', async () => {
    const { deps, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    const child = getLastChild();
    child.stderr.write("ERROR: Private video. Sign in if you've been invited.\n");
    child.emit('close', 1);

    await expect(promise).rejects.toMatchObject({ category: 'private', retryable: false });
  });

  it('categorizes a real yt-dlp "Video unavailable" failure (no "is" between the words)', async () => {
    // Confirmed against a real yt-dlp run against a nonexistent video id -
    // the actual wording has no "is", which an earlier version of this
    // regex required and silently missed, miscategorizing it as
    // 'extractor' instead.
    const { deps, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    const child = getLastChild();
    child.stderr.write('ERROR: [youtube] zzzzzzzzzz0: Video unavailable\n');
    child.emit('close', 1);

    await expect(promise).rejects.toMatchObject({ category: 'unavailable', retryable: false });
  });

  it('categorizes a non-zero exit with empty stderr as internal and retryable (a crashed process, not an extractor failure)', async () => {
    // Real production case: yt-dlp.exe exited 3221225794 (0xC0000409,
    // STATUS_STACK_BUFFER_OVERRUN) with nothing on stderr, correlated with a
    // Windows Defender scan running at the same time - a transient crash,
    // not a site/extractor problem, so it must be retried rather than
    // permanently failing the import (see categorizeExitFailure's comment).
    const { deps, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    const child = getLastChild();
    child.emit('close', 3221225794);

    await expect(promise).rejects.toMatchObject({
      category: 'internal',
      exitCode: 3221225794,
      retryable: true,
    });
  });

  it('categorizes a spawn-level error (e.g. missing binary) as internal and non-retryable', async () => {
    const { deps, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    getLastChild().emit('error', new Error('spawn yt-dlp ENOENT'));

    await expect(promise).rejects.toMatchObject({ category: 'internal', retryable: false });
  });

  it('kills the child (SIGTERM then SIGKILL after the grace period) and rejects as timeout', async () => {
    jest.useFakeTimers();
    try {
      const { deps, getLastChild } = createHarness({ timeoutMs: 1000, killGraceMs: 500 });
      const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
      await flushMicrotasks();
      const child = getLastChild();

      jest.advanceTimersByTime(1000);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      jest.advanceTimersByTime(500);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      child.emit('close', null);
      await expect(promise).rejects.toMatchObject({ category: 'timeout', retryable: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it('kills the child and rejects as cancelled when the caller aborts, without retrying', async () => {
    const { deps, spawnMock, getLastChild } = createHarness({
      retryPolicy: { maxAttempts: 3, baseDelayMs: 1, factor: 2, maxDelayMs: 10 },
    });
    const controller = new AbortController();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps, {
      signal: controller.signal,
    });
    await flushMicrotasks();
    const child = getLastChild();

    controller.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', null);

    await expect(promise).rejects.toMatchObject({ category: 'cancelled', retryable: false });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure with exponential backoff and succeeds on the second attempt', async () => {
    const { deps, spawnMock } = createHarness({
      retryPolicy: { maxAttempts: 3, baseDelayMs: 20, factor: 2, maxDelayMs: 100 },
    });
    const children: FakeChild[] = [];
    spawnMock.mockImplementation(() => {
      const child = createFakeChild();
      children.push(child);
      return child as unknown as SpawnedProcess;
    });

    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);

    await flushMicrotasks();
    expect(children).toHaveLength(1);
    children[0].stderr.write('HTTP Error 403: Forbidden\n');
    children[0].emit('close', 1);

    await flushMicrotasks();
    expect(children).toHaveLength(2);
    children[1].emit('close', 0);

    const result = await promise;
    expect(result.retries).toBe(1);
    expect(deps.sleep).toHaveBeenCalledWith(20);
  });

  // Download Reliability Framework - the following categorization tests are
  // written from documented/expected yt-dlp wording, not confirmed against a
  // real failing download in this environment (unlike the 'unavailable' and
  // 'internal' tests above, which were caught/fixed from real production
  // runs) - flagged here and in the final report as needing production log
  // confirmation.

  it('categorizes "confirm your age" as age_restricted, not authentication', async () => {
    const { deps, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    const child = getLastChild();
    child.stderr.write('ERROR: Sign in to confirm your age\n');
    child.emit('close', 1);

    await expect(promise).rejects.toMatchObject({ category: 'age_restricted', retryable: false });
  });

  it('categorizes the anti-bot "sign in to confirm" wording as authentication, not age_restricted', async () => {
    const { deps, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    const child = getLastChild();
    child.stderr.write("ERROR: Sign in to confirm you're not a bot\n");
    child.emit('close', 1);

    await expect(promise).rejects.toMatchObject({ category: 'authentication', retryable: false });
  });

  it('categorizes a geo-restriction failure', async () => {
    const { deps, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    const child = getLastChild();
    child.stderr.write('ERROR: The uploader has not made this video available in your country\n');
    child.emit('close', 1);

    await expect(promise).rejects.toMatchObject({ category: 'geo_restricted', retryable: false });
  });

  it('categorizes an ENOSPC failure surfaced through yt-dlp stderr as disk', async () => {
    const { deps, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    const child = getLastChild();
    child.stderr.write('ERROR: unable to write data: [Errno 28] No space left on device\n');
    child.emit('close', 1);

    await expect(promise).rejects.toMatchObject({ category: 'disk', retryable: false });
  });

  it('categorizes an EACCES failure surfaced through yt-dlp stderr as permission', async () => {
    const { deps, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    const child = getLastChild();
    child.stderr.write('ERROR: unable to open for writing: [Errno 13] Permission denied\n');
    child.emit('close', 1);

    await expect(promise).rejects.toMatchObject({ category: 'permission', retryable: false });
  });

  it('categorizes an invalid-URL failure', async () => {
    const { deps, getLastChild } = createHarness();
    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    const child = getLastChild();
    child.stderr.write('ERROR: zzz is not a valid URL\n');
    child.emit('close', 1);

    await expect(promise).rejects.toMatchObject({ category: 'invalid_url', retryable: false });
  });

  it('rejects with a "storage" category and cleans up the file when it exceeds the configured max size', async () => {
    const { deps, getLastChild, unlinkMock, statMock } = createHarness({ maxFileSizeBytes: 100 });
    statMock.mockResolvedValue({ size: 200 });

    const promise = YtDlpEngine.download({ url: 'https://youtu.be/abc' }, deps);
    await flushMicrotasks();
    getLastChild().emit('close', 0);

    await expect(promise).rejects.toMatchObject({ category: 'storage', retryable: false });
    expect(unlinkMock).toHaveBeenCalledWith(path.join('/tmp/scratch', 'id-0.mp4'));
  });
});

describe('YtDlpEngine.fetchMetadata', () => {
  it('resolves the trimmed title', async () => {
    const { deps, execFileMock } = createHarness();
    execFileMock.mockResolvedValue({ stdout: 'My Cool Video\n', stderr: '' });

    const metadata = await YtDlpEngine.fetchMetadata('https://youtu.be/abc', deps);

    expect(metadata).toEqual({ title: 'My Cool Video' });
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('yt-dlp');
    expect(args).toEqual([
      '--no-playlist',
      '--skip-download',
      '--print',
      'title',
      '--extractor-args',
      'youtube:player_client=android',
      'https://youtu.be/abc',
    ]);
  });

  it('resolves null when yt-dlp fails (missing binary, private/deleted video, etc.)', async () => {
    const { deps, execFileMock } = createHarness();
    execFileMock.mockRejectedValue(new Error('yt-dlp exited with code 1'));

    const metadata = await YtDlpEngine.fetchMetadata('https://youtu.be/abc', deps);

    expect(metadata).toEqual({ title: null });
  });

  it('resolves null when yt-dlp prints an empty title', async () => {
    const { deps, execFileMock } = createHarness();
    execFileMock.mockResolvedValue({ stdout: '   \n', stderr: '' });

    const metadata = await YtDlpEngine.fetchMetadata('https://youtu.be/abc', deps);

    expect(metadata).toEqual({ title: null });
  });
});

describe('YtDlpEngine.checkVersion', () => {
  it('reports healthy when the version meets the configured minimum', async () => {
    const { deps, execFileMock } = createHarness({ minVersion: '2024.01.01' });
    execFileMock.mockResolvedValue({ stdout: '2025.06.30\n', stderr: '' });

    const health = await YtDlpEngine.checkVersion(deps);

    expect(health).toEqual({
      engineName: 'yt-dlp',
      engineVersion: '2025.06.30',
      status: 'healthy',
    });
  });

  it('reports stale when the version is older than the configured minimum', async () => {
    const { deps, execFileMock } = createHarness({ minVersion: '2025.06.30' });
    execFileMock.mockResolvedValue({ stdout: '2024.01.01\n', stderr: '' });

    const health = await YtDlpEngine.checkVersion(deps);

    expect(health.status).toBe('stale');
  });

  it('reports unreachable when the binary cannot be executed', async () => {
    const { deps, execFileMock } = createHarness();
    execFileMock.mockRejectedValue(new Error('ENOENT'));

    const health = await YtDlpEngine.checkVersion(deps);

    expect(health).toEqual({ engineName: 'yt-dlp', engineVersion: null, status: 'unreachable' });
  });
});
