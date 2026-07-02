import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TranscriptSegment } from '@viral-clip-app/shared';

const execFileAsync = promisify(execFile);
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH ?? 'ffprobe';

export async function getVideoDimensions(
  inputPath: string,
): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0',
    inputPath,
  ]);
  const [width, height] = stdout.trim().split(',').map(Number);
  return { width, height };
}

function toSrtTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const ms = Math.round((clamped % 1) * 1000);
  const totalSeconds = Math.floor(clamped);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (value: number, width = 2) => value.toString().padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function buildSrt(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
): string {
  const duration = clipEnd - clipStart;

  return segments
    .map((segment) => ({
      start: Math.max(0, segment.start - clipStart),
      end: Math.min(duration, segment.end - clipStart),
      text: segment.text,
    }))
    .filter((segment) => segment.end > segment.start)
    .map(
      (segment, index) =>
        `${index + 1}\n${toSrtTimestamp(segment.start)} --> ${toSrtTimestamp(segment.end)}\n${segment.text}\n`,
    )
    .join('\n');
}

// ffmpeg's filtergraph mini-language treats ':' and '\' as syntax, so a
// Windows absolute path (e.g. C:\Users\...\clip.srt) needs both escaped
// before it can be used as a subtitles= filter argument.
export function escapeFfmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:');
}

export interface ReframeOptions {
  width: number;
  height: number;
  // Initial crop position - also the only position used when sendCmdPath is
  // null (static center-crop fallback, no detected face to track).
  x: number;
  y: number;
  // Path to a sendcmd command file (see reframe.ts's buildSendCmdScript) -
  // null when no face was detected anywhere in the clip, in which case the
  // crop is static at (x, y) for the whole clip instead of tracking a face.
  sendCmdPath: string | null;
}

export async function renderClip(options: {
  // Local file path - ffmpeg can't operate on an object storage key
  // directly, so the caller must download the source first.
  inputPath: string;
  startTime: number;
  endTime: number;
  // null when the clip has no overlapping transcript text - a valid case
  // (e.g. a musical/silent moment), not an error. Whisper/libass both choke
  // on an empty subtitle file, so the filter is omitted entirely rather than
  // pointed at one.
  srtPath: string | null;
  outputPath: string;
  // null skips cropping entirely (keeps the source aspect ratio) - not used
  // by the current pipeline (every clip gets reframed to 9:16), kept
  // optional for the same reason srtPath is: easy to test and a natural,
  // already-established pattern in this function's signature.
  reframe: ReframeOptions | null;
}): Promise<void> {
  const { inputPath, startTime, endTime, srtPath, outputPath, reframe } = options;
  const duration = endTime - startTime;

  const args = ['-y', '-ss', startTime.toString(), '-i', inputPath, '-t', duration.toString()];

  const filters: string[] = [];
  if (reframe) {
    if (reframe.sendCmdPath) {
      // sendcmd must precede the filter it targets in the chain - crop is
      // tagged @reframe so sendcmd's command file (one "TIME crop@reframe x
      // .., crop@reframe y ..;" line per interpolated point - see
      // reframe.ts) can address it.
      filters.push(`sendcmd=f=${escapeFfmpegFilterPath(reframe.sendCmdPath)}`);
      filters.push(
        `crop@reframe=w=${reframe.width}:h=${reframe.height}:x=${reframe.x}:y=${reframe.y}`,
      );
    } else {
      filters.push(`crop=w=${reframe.width}:h=${reframe.height}:x=${reframe.x}:y=${reframe.y}`);
    }
  }
  if (srtPath) {
    // After crop, not before - captions burn onto the final (possibly
    // reframed) frame, not the original wide one.
    filters.push(`subtitles='${escapeFfmpegFilterPath(srtPath)}'`);
  }
  if (filters.length > 0) {
    args.push('-vf', filters.join(','));
  }

  args.push('-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', outputPath);

  await execFileAsync(FFMPEG_PATH, args);
}
