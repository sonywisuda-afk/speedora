import type { VideoImportMetadata } from '@speedora/contracts';

// Deployment-specific plumbing (subprocess execution, filesystem, retry/
// timeout numbers) lives here, not in packages/contracts - same "keep the
// contract narrow, keep deps out of the schema file" rule the reframe
// module's DetectFacesDeps follows.

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
}

export interface VideoImportEngineConfig {
  binaryPath: string;
  // Passed through to yt-dlp as --ffmpeg-location, same reasoning as
  // ffmpeg.ts's own FFMPEG_PATH handling - yt-dlp spawns its own ffmpeg for
  // merging video+audio and only looks on the system PATH by default.
  ffmpegPath: string | null;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  cookiesFile: string | null;
  proxyUrl: string | null;
  extraArgs: string[];
  allowedDomains: string[];
  scratchDir: string;
  minVersion: string | null;
  maxFileSizeBytes: number | null;
  killGraceMs: number;
}

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

export interface FileStat {
  size: number;
}

// The minimal slice of node:child_process's ChildProcess this package
// actually touches - lets tests fake a child process without depending on
// the real class shape.
export interface SpawnedProcess {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: (exitCode: number | null) => void): unknown;
}

// Every external call (subprocess, filesystem, clock, randomness) goes
// through this - the package itself never reads process.env/__dirname or
// calls node:child_process/node:fs directly, per ARCHITECTURE.md's
// stateless-module checklist. The adapter (apps/worker) constructs the real
// implementations; tests construct fakes.
export interface ImportDeps {
  spawn(command: string, args: string[]): SpawnedProcess;
  execFile(
    command: string,
    args: string[],
    options: { timeoutMs: number },
  ): Promise<ExecFileResult>;
  fs: {
    mkdir(path: string): Promise<void>;
    unlink(path: string): Promise<void>;
    stat(path: string): Promise<FileStat>;
  };
  sleep(ms: number): Promise<void>;
  now(): number;
  randomId(): string;
  config: VideoImportEngineConfig;
}

export type EngineHealthStatus = 'healthy' | 'stale' | 'unreachable';

export interface EngineHealth {
  engineName: string;
  engineVersion: string | null;
  status: EngineHealthStatus;
}

export interface DownloadOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

// Narrower than the full contracts.VideoImportResult - metadata/engineName
// are composed by the adapter (which already calls fetchMetadata separately
// and knows which engine it resolved), keeping download()'s own error
// surface independent from metadata-fetch's best-effort swallowed errors,
// same separation the original youtube.ts had between
// downloadYoutubeVideo/getYoutubeVideoTitle.
export interface VideoImportDownloadResult {
  outputPath: string;
  durationMs: number;
  retries: number;
}

export interface VideoImportEngine {
  readonly name: string;

  fetchMetadata(url: string, deps: ImportDeps): Promise<VideoImportMetadata>;

  download(
    input: { url: string },
    deps: ImportDeps,
    options?: DownloadOptions,
  ): Promise<VideoImportDownloadResult>;

  checkVersion(deps: ImportDeps): Promise<EngineHealth>;
}
