import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TranscriptSegment } from '@viral-clip-app/shared';

const execFileAsync = promisify(execFile);
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';

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

export async function renderClip(options: {
  sourceUrl: string;
  startTime: number;
  endTime: number;
  // null when the clip has no overlapping transcript text - a valid case
  // (e.g. a musical/silent moment), not an error. Whisper/libass both choke
  // on an empty subtitle file, so the filter is omitted entirely rather than
  // pointed at one.
  srtPath: string | null;
  outputPath: string;
}): Promise<void> {
  const { sourceUrl, startTime, endTime, srtPath, outputPath } = options;
  const duration = endTime - startTime;

  const args = ['-y', '-ss', startTime.toString(), '-i', sourceUrl, '-t', duration.toString()];
  if (srtPath) {
    args.push('-vf', `subtitles='${escapeFfmpegFilterPath(srtPath)}'`);
  }
  args.push('-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', outputPath);

  await execFileAsync(FFMPEG_PATH, args);
}
