import type { ImportFailureCategory, VideoImportMetadata } from '@speedora/contracts';
import { VideoImportError } from '../errors';
import { evaluateHealthStatus } from '../health';
import { withRetry } from '../retry';
import { reserveScratchPath } from '../scratch';
import type {
  DownloadOptions,
  EngineHealth,
  ImportDeps,
  VideoImportDownloadResult,
  VideoImportEngine,
} from '../types';

const ENGINE_NAME = 'yt-dlp';

// YouTube's default ("web") client increasingly returns "HTTP Error 403:
// Forbidden" on the actual video/audio data fetch - a moving-target anti-bot
// measure yt-dlp works around by impersonating a different client. The
// 'android' client's own auth flow sidesteps it; 'tv' was tried too but
// reports "DRM protected" for videos the web/android clients play back fine.
// Kept as its own constant (not config) since it's an extraction-mechanism
// workaround, not a deployment concern - see yt-dlp's own --extractor-args
// docs for the full client list if this needs to change again.
const PLAYER_CLIENT_ARGS = ['--extractor-args', 'youtube:player_client=android'];

// Much shorter than the download timeout - this never downloads any
// video/audio, just resolves metadata.
const METADATA_TIMEOUT_MS = 30 * 1000;

// yt-dlp's own progress line is meant for a human terminal, not a parser -
// it's carriage-return-overwritten and its exact wording isn't a stable
// contract. --progress-template lets yt-dlp emit a line we control instead;
// this prefix is the marker, kept out-of-band from any of yt-dlp's own log
// output so a parser can't mistake something else for a progress update.
const PROGRESS_LINE_PREFIX = 'SPEEDORA_PROGRESS ';
const PROGRESS_LINE_REGEX = /^SPEEDORA_PROGRESS\s+([\d.]+)%/;

// Prefer H.264 (avc1) video + AAC (mp4a) audio over anything else. YouTube's
// "best mp4" is often AV1 (av01), which a plain <video> element can't decode
// in many browsers (Firefox/Safari on Windows, older hardware) - so the
// timeline editor's source preview would show a dead player even though the
// file is fine. Falls back to the previous "best mp4, then best anything"
// chain if a given video somehow has no avc1 rendition.
const FORMAT_SELECTOR =
  'bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[vcodec^=avc1][acodec^=mp4a]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best';

function authArgs(deps: ImportDeps): string[] {
  const args: string[] = [];
  if (deps.config.cookiesFile) args.push('--cookies', deps.config.cookiesFile);
  if (deps.config.proxyUrl) args.push('--proxy', deps.config.proxyUrl);
  return args;
}

function truncate(text: string, maxLength = 500): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

// Best-effort classification of yt-dlp's own stderr text into one of the
// shared failure categories - not exhaustive (yt-dlp's wording isn't a
// stable contract either), falls back to 'extractor' for anything
// unrecognized, which is treated as non-retryable (a format/site-extraction
// issue a retry won't fix).
function categorizeExitFailure(stderr: string): ImportFailureCategory {
  // A real yt-dlp failure - private/unavailable/rate-limited/a genuine
  // extractor bug - always prints something to stderr explaining what
  // happened. A non-zero exit with EMPTY stderr means the process never got
  // that far: it was killed/crashed before it could report anything (seen in
  // production as exit code 3221225794 / 0xC0000409, STATUS_STACK_BUFFER_
  // OVERRUN, correlated with a Windows Defender scan running concurrently -
  // a transient environmental crash, not a site/extractor problem). Without
  // this check it fell through to 'extractor' (non-retryable), so a
  // one-off AV hiccup permanently failed the import with no automatic retry.
  if (stderr.trim().length === 0) return 'internal';
  if (/private video/i.test(stderr)) return 'private';
  // Confirmed against a real yt-dlp run (a nonexistent video id): the actual
  // message is "Video unavailable" - no "is" between the two words. The
  // original pattern here required "video is unavailable" and silently
  // missed this, miscategorizing it as 'extractor' instead - caught by a
  // real end-to-end import against real YouTube, not assumed from yt-dlp's
  // docs/source.
  if (/video (is )?unavailable|video has been removed|no longer available/i.test(stderr)) {
    return 'unavailable';
  }
  if (/sign in to confirm|age[- ]restrict/i.test(stderr)) return 'age_restricted';
  if (/http error 429|rate.?limit/i.test(stderr)) return 'rate_limited';
  if (/http error (403|5\d\d)|unable to download|network|timed out|econnreset/i.test(stderr)) {
    return 'network';
  }
  return 'extractor';
}

function buildDownloadArgs(url: string, outputPath: string, deps: ImportDeps): string[] {
  return [
    '--no-playlist',
    '--quiet',
    '--no-warnings',
    // Forces yt-dlp to still emit progress output despite --quiet above -
    // without this flag, --quiet silently swallows the custom
    // progress-template lines too, not just yt-dlp's own log noise.
    '--progress',
    // One full line per update (LF-terminated) rather than yt-dlp's default
    // carriage-return-overwritten single line - a stream reader needs
    // discrete, parseable lines.
    '--newline',
    '--progress-template',
    `download:${PROGRESS_LINE_PREFIX}%(progress._percent_str)s`,
    ...(deps.config.ffmpegPath ? ['--ffmpeg-location', deps.config.ffmpegPath] : []),
    ...PLAYER_CLIENT_ARGS,
    ...authArgs(deps),
    ...deps.config.extraArgs,
    '-f',
    FORMAT_SELECTOR,
    '--merge-output-format',
    'mp4',
    '-o',
    outputPath,
    url,
  ];
}

// Downloads to an exact path (not a template) - reserveScratchPath() always
// returns a path ending in '.mp4', and --merge-output-format mp4 guarantees
// yt-dlp actually writes a real mp4 container there.
//
// Uses deps.spawn (streamed stdout), not deps.execFile (buffered until
// exit) - onProgress needs real percentages while a large download is still
// in flight.
function runOnce(
  url: string,
  outputPath: string,
  deps: ImportDeps,
  options: DownloadOptions | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = deps.spawn(deps.config.binaryPath, buildDownloadArgs(url, outputPath, deps));

    let stderrOutput = '';
    let stdoutBuffer = '';
    let outcome: 'timeout' | 'cancelled' | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const killChild = (reason: 'timeout' | 'cancelled') => {
      if (outcome) return;
      outcome = reason;
      child.kill('SIGTERM');
      graceTimer = setTimeout(() => child.kill('SIGKILL'), deps.config.killGraceMs);
    };

    const timer = setTimeout(() => killChild('timeout'), deps.config.timeoutMs);
    const onAbort = () => killChild('cancelled');
    options?.signal?.addEventListener('abort', onAbort);

    const stopWatching = () => {
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      options?.signal?.removeEventListener('abort', onAbort);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex: number;
      while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        const match = line.match(PROGRESS_LINE_REGEX);
        if (match) options?.onProgress?.(parseFloat(match[1]));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    child.on('error', (error) => {
      stopWatching();
      reject(
        new VideoImportError(`failed to start yt-dlp: ${error.message}`, {
          category: 'internal',
          engineName: ENGINE_NAME,
          retryable: false,
          cause: error,
        }),
      );
    });

    child.on('close', (exitCode) => {
      stopWatching();

      if (outcome === 'timeout') {
        reject(
          new VideoImportError(
            `yt-dlp download exceeded ${deps.config.timeoutMs}ms and was killed`,
            { category: 'timeout', engineName: ENGINE_NAME },
          ),
        );
        return;
      }
      if (outcome === 'cancelled') {
        reject(
          new VideoImportError('yt-dlp download was cancelled', {
            category: 'cancelled',
            engineName: ENGINE_NAME,
          }),
        );
        return;
      }
      if (exitCode === 0) {
        resolve();
        return;
      }
      const stderrExcerpt = truncate(stderrOutput.trim());
      reject(
        new VideoImportError(`yt-dlp exited with code ${exitCode}: ${stderrExcerpt}`, {
          category: categorizeExitFailure(stderrOutput),
          engineName: ENGINE_NAME,
          exitCode,
          stderrExcerpt,
        }),
      );
    });
  });
}

export const YtDlpEngine: VideoImportEngine = {
  name: ENGINE_NAME,

  // Sprint 1-2 (Dashboard Redesign) - the Dashboard's Recent Projects grid
  // needs a display title for imported videos. Best-effort: a missing/
  // renamed binary or a since-deleted/private video shouldn't fail the
  // whole import - a null title is a legitimate outcome, not an error.
  async fetchMetadata(url: string, deps: ImportDeps): Promise<VideoImportMetadata> {
    try {
      const { stdout } = await deps.execFile(
        deps.config.binaryPath,
        [
          '--no-playlist',
          '--skip-download',
          '--print',
          'title',
          ...PLAYER_CLIENT_ARGS,
          ...authArgs(deps),
          url,
        ],
        { timeoutMs: METADATA_TIMEOUT_MS },
      );
      const title = stdout.trim();
      return { title: title.length > 0 ? title : null };
    } catch {
      return { title: null };
    }
  },

  async download(
    input: { url: string },
    deps: ImportDeps,
    options?: DownloadOptions,
  ): Promise<VideoImportDownloadResult> {
    const startedAt = deps.now();

    const { result: outputPath, retries } = await withRetry(
      async () => {
        if (options?.signal?.aborted) {
          throw new VideoImportError('yt-dlp download was cancelled', {
            category: 'cancelled',
            engineName: ENGINE_NAME,
          });
        }

        const attemptOutputPath = await reserveScratchPath(deps);
        try {
          await runOnce(input.url, attemptOutputPath, deps, options);

          if (deps.config.maxFileSizeBytes !== null) {
            const { size } = await deps.fs.stat(attemptOutputPath);
            if (size > deps.config.maxFileSizeBytes) {
              throw new VideoImportError(
                `downloaded file (${size} bytes) exceeds the configured maximum (${deps.config.maxFileSizeBytes} bytes)`,
                { category: 'storage', engineName: ENGINE_NAME, retryable: false },
              );
            }
          }

          return attemptOutputPath;
        } catch (error) {
          await deps.fs.unlink(attemptOutputPath).catch(() => undefined);
          throw error;
        }
      },
      deps.config.retryPolicy,
      deps.sleep,
    );

    return {
      outputPath,
      durationMs: deps.now() - startedAt,
      retries,
    };
  },

  async checkVersion(deps: ImportDeps): Promise<EngineHealth> {
    try {
      const { stdout } = await deps.execFile(deps.config.binaryPath, ['--version'], {
        timeoutMs: METADATA_TIMEOUT_MS,
      });
      const version = stdout.trim() || null;
      return {
        engineName: ENGINE_NAME,
        engineVersion: version,
        status: evaluateHealthStatus(version, deps.config.minVersion),
      };
    } catch {
      return { engineName: ENGINE_NAME, engineVersion: null, status: 'unreachable' };
    }
  },
};
