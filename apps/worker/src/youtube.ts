import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
// Same "assume on PATH, allow an override" pattern as FFMPEG_PATH/FFPROBE_PATH
// in ffmpeg.ts - yt-dlp is a separate binary (Python-packaged, installed via
// pip alongside mediapipe in the worker image - see Dockerfile), not an npm
// dependency.
const YTDLP_PATH = process.env.YTDLP_PATH ?? 'yt-dlp';

// Downloads to an exact path (not a template) - callers pass a path from
// reserveScratchPath() ending in '.mp4', and --merge-output-format mp4
// guarantees yt-dlp actually writes (merging via ffmpeg if the best video/
// audio streams weren't already a single file) a real mp4 container there,
// so there's no need to discover the extension yt-dlp picked on its own.
export async function downloadYoutubeVideo(url: string, outputPath: string): Promise<void> {
  await execFileAsync(
    YTDLP_PATH,
    [
      '--no-playlist',
      '--quiet',
      '--no-warnings',
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
    ],
    // yt-dlp's own logging is suppressed above, but a long/high-res
    // download can still legitimately produce more combined stdout+stderr
    // than Node's 1MB default exec buffer - bump it rather than risk a
    // false "maxBuffer exceeded" failure on an otherwise-successful download.
    { maxBuffer: 1024 * 1024 * 50 },
  );
}
