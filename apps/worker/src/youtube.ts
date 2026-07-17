import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { limitExecFile } from './subprocessLimiter';

// Same "assume on PATH, allow an override" pattern as FFMPEG_PATH/FFPROBE_PATH
// in ffmpeg.ts - yt-dlp is a separate binary (Python-packaged, installed via
// pip alongside mediapipe in the worker image - see Dockerfile), not an npm
// dependency.
const YTDLP_PATH = process.env.YTDLP_PATH ?? 'yt-dlp';

// YouTube's default ("web") client increasingly returns "HTTP Error 403:
// Forbidden" on the actual video/audio data fetch (confirmed via a real
// yt-dlp run against a real video, even on yt-dlp's current release -
// this isn't a stale-binary problem) - a moving-target anti-bot measure
// yt-dlp works around by impersonating a different client. The 'android'
// client's own auth flow sidesteps it; 'tv' was tried too but reports
// "DRM protected" for videos the web/android clients play back fine, so
// it isn't a safe default. Kept as its own constant (not inlined) since
// this is exactly the kind of value likely to need swapping again the
// next time YouTube changes its blocking - see yt-dlp's own
// --extractor-args documentation for the full client list.
const YTDLP_PLAYER_CLIENT_ARGS = ['--extractor-args', 'youtube:player_client=android'];

const execFileAsync = limitExecFile(promisify(execFile));

// Bounded metadata-only lookup, same "generous but not unbounded" reasoning
// as ffmpeg.ts's timeouts - much shorter than YTDLP_TIMEOUT_MS below since
// this never downloads any video/audio, just resolves the title.
const YTDLP_TITLE_TIMEOUT_MS = 30 * 1000;

// Sprint 1-2 (Dashboard Redesign) - the Dashboard's Recent Projects grid
// needs a display title for imported videos, which Video.title otherwise
// has no source for (unlike a direct upload's file.originalname). Best-
// effort: a missing/renamed yt-dlp binary or a since-deleted/private video
// shouldn't fail the whole import - import-youtube.worker.ts treats a null
// return as "leave Video.title null", same "optional signal" fallback used
// throughout this codebase for anything that isn't the core pipeline.
export async function getYoutubeVideoTitle(url: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      YTDLP_PATH,
      ['--no-playlist', '--skip-download', '--print', 'title', ...YTDLP_PLAYER_CLIENT_ARGS, url],
      { timeout: YTDLP_TITLE_TIMEOUT_MS },
    );
    const title = stdout.trim();
    return title.length > 0 ? title : null;
  } catch {
    return null;
  }
}

// yt-dlp's own progress line ("[download]  12.3% of ...") is meant for a
// human terminal, not a parser - it's carriage-return-overwritten and its
// exact wording isn't a stable contract. --progress-template lets yt-dlp
// emit a line we control instead; PROGRESS_LINE_PREFIX is that marker, kept
// out-of-band from any of yt-dlp's own log output so a parser can't
// mistake something else for a progress update.
const PROGRESS_LINE_PREFIX = 'SPEEDORA_PROGRESS ';
const PROGRESS_LINE_REGEX = /^SPEEDORA_PROGRESS\s+([\d.]+)%/;

// Unlike every other subprocess call in this codebase (diarization,
// vocal emotion, ffmpeg trim/render), this one had NO timeout at all until
// now - a real gap, since a stalled/hung connection yt-dlp itself never
// notices leaves onProgress silently stuck (observed for real: a download
// sitting at importProgress 100 with no forward progress and no error).
// 60 minutes is generous for a large source on a slow connection while
// still bounding the worst case - ordinary downloads finish in a small
// fraction of this.
const YTDLP_TIMEOUT_MS = 60 * 60 * 1000;

// Downloads to an exact path (not a template) - callers pass a path from
// reserveScratchPath() ending in '.mp4', and --merge-output-format mp4
// guarantees yt-dlp actually writes (merging via ffmpeg if the best video/
// audio streams weren't already a single file) a real mp4 container there,
// so there's no need to discover the extension yt-dlp picked on its own.
//
// Uses spawn (streamed stdout), not execFile (buffered until exit) - the
// whole point of onProgress is real percentages while a large download is
// still in flight (see import-youtube.worker.ts's importProgress writes),
// which a buffered call can't provide.
export function downloadYoutubeVideo(
  url: string,
  outputPath: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_PATH, [
      '--no-playlist',
      '--quiet',
      '--no-warnings',
      // Forces yt-dlp to still emit progress output despite --quiet above -
      // discovered directly by testing --progress-template combined with
      // --quiet: without this flag, --quiet silently swallows the custom
      // progress-template lines too, not just yt-dlp's own log noise.
      '--progress',
      // One full line per update (LF-terminated) rather than yt-dlp's
      // default carriage-return-overwritten single line - a stream reader
      // needs discrete, parseable lines.
      '--newline',
      '--progress-template',
      `download:${PROGRESS_LINE_PREFIX}%(progress._percent_str)s`,
      // yt-dlp spawns its own ffmpeg subprocess to do the merge above and
      // only looks on the system PATH for it - it has no idea FFMPEG_PATH
      // (this project's own "assume on PATH, allow an override" env var)
      // exists. Without this, an environment where ffmpeg is only
      // reachable via FFMPEG_PATH (not the system PATH) downloads the
      // video/audio streams as two separate files instead of merging them,
      // so nothing ever ends up at `outputPath` and the caller's
      // subsequent readFile(outputPath) fails with ENOENT - discovered via
      // a real end-to-end import that silently produced two split files.
      ...(process.env.FFMPEG_PATH ? ['--ffmpeg-location', process.env.FFMPEG_PATH] : []),
      ...YTDLP_PLAYER_CLIENT_ARGS,
      // Prefer H.264 (avc1) video + AAC (mp4a) audio over anything else.
      // YouTube's "best mp4" is often AV1 (av01), which a plain <video>
      // element can't decode in many browsers (Firefox/Safari on Windows,
      // older hardware) - so the timeline editor's source preview would show
      // a dead player even though the file is fine. H.264/AAC is universally
      // playable and still plenty for repurposing into short clips. Falls
      // back to the previous "best mp4, then best anything" chain if a given
      // video somehow has no avc1 rendition.
      '-f',
      'bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[vcodec^=avc1][acodec^=mp4a]/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best',
      '--merge-output-format',
      'mp4',
      '-o',
      outputPath,
      url,
    ]);

    // Buffered only for the error message on a non-zero exit - unlike the
    // old execFile call, stdout is consumed line-by-line as it arrives
    // (below), never held in full, so a long download can't blow past any
    // buffer limit the way the old maxBuffer override was guarding against.
    let stderrOutput = '';
    let stdoutBuffer = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, YTDLP_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex: number;
      while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        const match = line.match(PROGRESS_LINE_REGEX);
        if (match) onProgress?.(parseFloat(match[1]));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`yt-dlp download exceeded ${YTDLP_TIMEOUT_MS}ms and was killed`));
        return;
      }
      if (exitCode === 0) {
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${exitCode}: ${stderrOutput.trim()}`));
      }
    });
  });
}
