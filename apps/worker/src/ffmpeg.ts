import { execFile } from 'node:child_process';
import { rename, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { computeCutJunctionTimestamps, type CutRange } from '@speedora/cutlist';
import { limitExecFile } from './subprocessLimiter';

const execFileAsync = limitExecFile(promisify(execFile));
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH ?? 'ffprobe';

// Runs an ffmpeg command that writes to `outputPath`, but has it actually
// write to a `.tmp` sibling and rename() onto the real path only once ffmpeg
// exits successfully - a plain direct write would leave a partial/corrupt
// file sitting at outputPath if ffmpeg is killed mid-write (a timeout, an
// OOM kill, a container restart), which is otherwise indistinguishable from
// a real, complete output to anything that reads outputPath afterward.
// rename() on the same filesystem (both paths live under the same scratch
// dir - see storage.ts's reserveScratchPath) is atomic, so nothing ever
// observes a half-written file at the final path. The tmp file is cleaned up
// on failure so a killed/timed-out run doesn't leak scratch space.
//
// The `.tmp` suffix means ffmpeg is writing to a path that doesn't end in
// `.mp4` - on ffmpeg 8.1.2 this was observed to break muxer format inference
// (GitHub issue #28) since ffmpeg picks the container format from the output
// filename's extension by default. Fixed by passing `-f mp4` explicitly so
// the format is stated, not guessed from a name ffmpeg never sees as ending
// in `.mp4` - both call sites below only ever produce H.264/AAC MP4 output
// (`-c:v libx264 -c:a aac`), so hardcoding it here instead of threading it
// through `buildArgs` is correct, not a premature generalization.
async function execFfmpegAtomically(
  buildArgs: () => string[],
  outputPath: string,
  timeoutMs: number,
): Promise<void> {
  const tmpOutputPath = `${outputPath}.tmp`;
  try {
    await execFileAsync(FFMPEG_PATH, [...buildArgs(), '-f', 'mp4', tmpOutputPath], {
      timeout: timeoutMs,
    });
    await rename(tmpOutputPath, outputPath);
  } catch (error) {
    await unlink(tmpOutputPath).catch(() => undefined);
    throw error;
  }
}

// trimCutRanges' own bound (see its call site below) - observed for real hanging well past 25
// minutes for an ordinary clip-length re-encode under load, with no ffmpeg output changing at all
// past a certain point. Same "bounded operation, ordinary rejection instead of an indefinite hang"
// reasoning as diarization.ts's/vocalEmotion.ts's timeouts - render-clip.worker.ts's caller treats
// a trim failure as "keep the untrimmed render" (see its own comment), not a job failure, so this
// only needs to be generous enough for a legitimate re-encode, not unbounded.
const TRIM_TIMEOUT_MS = 5 * 60 * 1000;

// renderClip's own bound (see its call site below) - the main crop+B-roll+subtitles encode,
// observed for real hanging over an hour under load with a complex filter graph (multiple B-roll
// overlays + dynamic crop + subtitles) on a longer clip. Unlike TRIM_TIMEOUT_MS this one has no
// graceful fallback available (there is no clip without this render succeeding), so a timeout here
// still fails the render-clip job - but a bounded, clean failure the caller's existing FAILED/retry
// path already handles, instead of a worker slot wedged for however long the machine happens to
// stay pathologically slow. More generous than TRIM_TIMEOUT_MS since this is strictly the more
// expensive of the two operations (full encode vs. a re-encode of already-rendered output).
const RENDER_TIMEOUT_MS = 15 * 60 * 1000;

// extractThumbnail's own bound - a single-frame extract has no legitimate
// reason to run long (unlike TRIM_TIMEOUT_MS/RENDER_TIMEOUT_MS, which exist
// because real multi-minute hangs were observed under load for much heavier
// operations). Both callers treat a thumbnail failure as fully optional (see
// transcribe.worker.ts/render-clip.worker.ts's own comments), so this just
// needs to be long enough for a legitimate extraction, not generous.
const THUMBNAIL_TIMEOUT_MS = 30 * 1000;

// extractAnimatedPreview's own bound - same "no legitimate reason to run
// long, both callers treat this as fully optional" reasoning as
// THUMBNAIL_TIMEOUT_MS above, just slightly more generous since this reads a
// few seconds of frames through a filter chain (fps + scale) rather than one.
const ANIMATED_PREVIEW_TIMEOUT_MS = 60 * 1000;

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

// ffmpeg's filtergraph mini-language treats ':' and '\' as syntax, so a
// Windows absolute path (e.g. C:\Users\...\clip.ass) needs both escaped
// before it can be used as a subtitles= filter argument.
export function escapeFfmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// Whisper's API rejects any upload larger than 25 MB, and a full-length
// video blows past that within a couple of minutes - so the transcribe job
// never sends the video itself. Extracting a compressed mono audio track
// first (the video stream contributes nothing to transcription) keeps the
// upload tiny while preserving the exact same timeline the timestamps refer
// to: at 16 kHz mono / 64 kbps mp3, ~25 MB covers roughly 54 minutes of
// source, versus the raw video failing almost immediately. Whisper
// downsamples to 16 kHz mono internally anyway, so nothing useful is lost.
// A source longer than that is split into windows by the transcribe job
// (see planTranscriptionChunks) and each window extracted separately via the
// optional `window` argument below.
const AUDIO_SAMPLE_RATE_HZ = 16000;
const AUDIO_BITRATE = '64k';

// A time window into the source, in seconds - used to extract just one chunk
// of a very long video's audio (see the transcribe job's chunking). Omitted
// for the common case, where the whole track is extracted in one go.
export interface AudioWindow {
  startSeconds: number;
  durationSeconds: number;
}

export async function extractAudio(
  inputPath: string,
  outputPath: string,
  window?: AudioWindow,
): Promise<void> {
  await execFileAsync(FFMPEG_PATH, [
    '-y',
    // -ss before -i seeks to the window start cheaply; the extracted chunk's
    // own timeline then restarts at 0, so the caller re-offsets its Whisper
    // timestamps by startSeconds to land back on absolute video time.
    ...(window ? ['-ss', String(window.startSeconds)] : []),
    '-i',
    inputPath,
    // -t after -i caps the output to the window length (omitted for a full
    // extraction, which just runs to the end of the source).
    ...(window ? ['-t', String(window.durationSeconds)] : []),
    // Drop the video stream entirely - only the audio matters for ASR.
    '-vn',
    // Mono, 16 kHz - speech doesn't benefit from stereo or a higher rate,
    // and both shrink the file (and match Whisper's own internal format).
    '-ac',
    '1',
    '-ar',
    String(AUDIO_SAMPLE_RATE_HZ),
    '-c:a',
    'libmp3lame',
    '-b:a',
    AUDIO_BITRATE,
    outputPath,
  ]);
}

// Extracts one frame at `atSeconds` into a small JPEG (thumbnail) - the
// Product Experience roadmap's real-thumbnail addition (transcribe.worker.ts
// for a Video's thumbnail, render-clip.worker.ts for a Clip's, both
// best-effort/never job-failing). `-y` overwrites an existing file at
// outputPath (a retry re-running this stage overwrites the same object-storage
// key rather than erroring). `-update 1` tells the image2 muxer this is a
// single still image, not a %03d-style sequence pattern - confirmed via a
// real (non-mocked) ffmpeg run that without it, ffmpeg still writes a valid
// image but emits a "does not contain an image sequence pattern" warning on
// every single extraction (harmless, but exactly the kind of ambiguous
// fallback a future ffmpeg version could turn into a hard error). `-vf
// scale=480:-1` keeps the file small - this is explicitly a thumbnail, not a
// full-res preview frame (see the caller comments for why higher-resolution/
// next/image serving is deliberately a separate, later phase). WebP
// (`-c:v libwebp -quality 80`, Phase 2 image-optimization roadmap) - real
// ffmpeg runs against a test video measured meaningfully smaller output than
// the JPEG this replaced, at equivalent visual quality; every browser this
// app plausibly targets has supported WebP for years, so no JPEG fallback
// markup is needed. No atomic-rename wrapper - unlike renderClip/
// trimCutRanges this writes a small, fast, non-resumed file, same simplicity
// as extractAudio/reencodeToH264 above.
export async function extractThumbnail(
  inputPath: string,
  outputPath: string,
  atSeconds: number,
): Promise<void> {
  await execFileAsync(
    FFMPEG_PATH,
    [
      '-y',
      '-ss',
      String(atSeconds),
      '-i',
      inputPath,
      '-vframes',
      '1',
      '-update',
      '1',
      '-vf',
      'scale=480:-1',
      '-c:v',
      'libwebp',
      '-quality',
      '80',
      outputPath,
    ],
    { timeout: THUMBNAIL_TIMEOUT_MS },
  );
}

// Phase 2 (image optimization roadmap) - a tiny (16px-wide) companion frame
// for the "blur placeholder" technique (a wide-CSS-blurred, near-invisible-
// detail preview shown while the real thumbnail loads). Same best-effort/
// never-job-failing callers, same timeout, same image2/WebP reasoning as
// extractThumbnail above - just a much smaller `scale`/lower `-quality` since
// blockiness/detail loss is invisible (arguably desirable) at this size.
// Deliberately a *separate* ffmpeg call rather than deriving this from
// extractThumbnail's own output - reads the higher-quality source frame
// directly rather than re-compressing an already-compressed thumbnail.
export async function extractBlurPlaceholder(
  inputPath: string,
  outputPath: string,
  atSeconds: number,
): Promise<void> {
  await execFileAsync(
    FFMPEG_PATH,
    [
      '-y',
      '-ss',
      String(atSeconds),
      '-i',
      inputPath,
      '-vframes',
      '1',
      '-update',
      '1',
      '-vf',
      'scale=16:-1',
      '-c:v',
      'libwebp',
      '-quality',
      '50',
      outputPath,
    ],
    { timeout: THUMBNAIL_TIMEOUT_MS },
  );
}

// Phase 3 (Hover Preview/Animated Thumbnail roadmap) - a short, muted,
// looping animated WebP, parameterized so both features share one
// extraction primitive instead of two near-identical ffmpeg functions (see
// the Phase 3 architecture plan): Animated Thumbnail uses a shorter/coarser
// config (background decoration, not stared at); Hover/Clip Preview uses a
// longer/smoother one (the main content of that interaction).
//
// Differs from extractThumbnail/extractBlurPlaceholder in more than just
// frame count - those pass `-vframes 1 -update 1` to force the image2-style
// muxer to accept a single still frame; this instead wants MULTIPLE frames,
// so it omits both flags and adds `-t <durationSeconds>` (how much source to
// read), `-an` (no audio - this is an <img>-rendered asset, never played
// through a decoder that has an audio track to ignore), and `-loop 0`
// (loop forever, not the libwebp default of playing once). `fps=<fps>`
// comes before `scale=<width>:-1` in the filter chain - filtering down to
// the target frame rate first, then scaling, is cheaper than the reverse
// for the same visual result.
//
// Verified for real (this ffmpeg 8.1.2 build's `ffprobe`/`ffplay` cannot
// read back multi-frame animated WebP at all - a known ffmpeg tooling
// limitation, not a sign of a broken file - so ffprobe-based verification,
// this codebase's usual real-verification tool, doesn't apply here). Real
// output was confirmed by loading it in an actual Chromium `<img>` over
// HTTP (matching how the browser actually consumes this asset) - correct
// naturalWidth/Height, and two screenshots taken 600ms apart differ,
// confirming genuine animation rather than a static single frame.
export async function extractAnimatedPreview(
  inputPath: string,
  outputPath: string,
  atSeconds: number,
  options: { durationSeconds: number; fps: number; width: number },
): Promise<void> {
  await execFileAsync(
    FFMPEG_PATH,
    [
      '-y',
      '-ss',
      String(atSeconds),
      '-i',
      inputPath,
      '-t',
      String(options.durationSeconds),
      '-vf',
      `fps=${options.fps},scale=${options.width}:-1`,
      '-an',
      '-c:v',
      'libwebp',
      '-loop',
      '0',
      '-quality',
      '60',
      outputPath,
    ],
    { timeout: ANIMATED_PREVIEW_TIMEOUT_MS },
  );
}

// Total duration of a media file in seconds, via ffprobe - the transcribe job
// uses it to decide whether the audio fits in one Whisper request or needs
// splitting into chunks. Returns NaN if the container has no reported
// duration (planTranscriptionChunks treats that as a single full-length pass).
export async function getMediaDurationSeconds(inputPath: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    inputPath,
  ]);
  return Number.parseFloat(stdout.trim());
}

// The first video stream's codec name (e.g. 'h264', 'av1', 'vp9') - used by
// the re-encode migration to find sources a browser <video> can't play.
// Returns '' for a file with no video stream.
export async function getVideoCodec(inputPath: string): Promise<string> {
  const { stdout } = await execFileAsync(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name',
    '-of',
    'csv=p=0',
    inputPath,
  ]);
  return stdout.trim();
}

// Re-encodes any source into H.264/AAC mp4 - browser-universal, unlike the
// AV1 that older YouTube imports were stored as (see youtube.ts, which now
// prefers H.264 for new imports). Used by the reencode-existing-sources
// migration to backfill those older videos so the timeline editor's <video>
// preview plays everywhere. Same duration/frame timing, so existing clip and
// transcript timestamps stay valid; the render pipeline already re-encodes to
// H.264 for output, so this doesn't change final clip quality. +faststart
// moves the moov atom to the front for progressive playback while streaming.
export async function reencodeToH264(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync(FFMPEG_PATH, [
    '-y',
    '-i',
    inputPath,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

export interface ReframeOptions {
  // The clip's FINAL, constant encoded frame size - always crop's base
  // dimensions from computeCropDimensions, never the zoomed-in size. Also
  // what buildAss sizes/positions captions for (see render-clip.worker.ts) -
  // captions must be laid out against the frame the viewer actually sees,
  // not a transient crop window that shrinks during a Fase 11 zoom punch-in.
  outputWidth: number;
  outputHeight: number;
  // Crop filter's initial (t=0) declared width/height/x/y - equal to
  // outputWidth/outputHeight unless an emphasis word's zoom happens to be
  // active right at the clip's start, in which case these start already
  // zoomed-in and the scale filter (below) normalizes back up to
  // outputWidth/outputHeight regardless. Also the only values used when
  // sendCmdPath is null (static center-crop fallback, no detected face or
  // emphasis word to react to).
  width: number;
  height: number;
  x: number;
  y: number;
  // Path to a sendcmd command file (see reframe.ts's buildSendCmdScript) -
  // null when there's neither a detected face nor an emphasis word anywhere
  // in the clip, in which case the crop is static at (x, y, width, height)
  // for the whole clip instead of panning/zooming.
  sendCmdPath: string | null;
}

// Fase 15 (Auto B-roll) - one already-prepared cutaway (trimmed, scaled/
// cropped to the clip's output size, alpha-faded in/out - see
// trimAndFadeInBRoll/fadeOutBRoll below) composited over the main video for
// a short window. startTime/endTime are clip-relative seconds (0 = clip
// start), same convention as ReframeOptions/subtitles.
export interface BRollOverlay {
  filePath: string;
  startTime: number;
  endTime: number;
}

export async function renderClip(options: {
  // Local file path - ffmpeg can't operate on an object storage key
  // directly, so the caller must download the source first.
  inputPath: string;
  startTime: number;
  endTime: number;
  // null when the clip has no overlapping transcript text - a valid case
  // (e.g. a musical/silent moment), not an error. libass chokes on a
  // subtitle file with zero events, so the filter is omitted entirely
  // rather than pointed at one.
  subtitlesPath: string | null;
  outputPath: string;
  // null skips cropping entirely (keeps the source aspect ratio) - not used
  // by the current pipeline (every clip gets reframed to 9:16), kept
  // optional for the same reason subtitlesPath is: easy to test and a
  // natural, already-established pattern in this function's signature.
  reframe: ReframeOptions | null;
  // null/empty for the common case (no B-roll moment found, or B-roll
  // unavailable/not configured) - see broll.ts's findBRollMoments.
  broll?: BRollOverlay[] | null;
}): Promise<void> {
  const { inputPath, startTime, endTime, subtitlesPath, outputPath, reframe, broll } = options;
  const duration = endTime - startTime;

  const args = ['-y', '-ss', startTime.toString(), '-i', inputPath, '-t', duration.toString()];

  const mainChainFilters: string[] = [];
  if (reframe) {
    if (reframe.sendCmdPath) {
      // sendcmd must precede the filter it targets in the chain - crop is
      // tagged @reframe so sendcmd's command file (one "TIME crop@reframe x
      // .., crop@reframe y ..;" line per interpolated point - see
      // reframe.ts) can address it.
      // Single-quoted, same as the subtitles filter below - an escaped but
      // unquoted Windows path (C\:/Users/...) makes ffmpeg's filtergraph
      // parser choke with "No option name near '/Users/...'" once the
      // sendcmd file's path itself is deep enough to look like several
      // path segments after the drive letter; quoting sidesteps that
      // entirely (confirmed against a real ffmpeg.exe on Windows).
      mainChainFilters.push(`sendcmd=f='${escapeFfmpegFilterPath(reframe.sendCmdPath)}'`);
      mainChainFilters.push(
        `crop@reframe=w=${reframe.width}:h=${reframe.height}:x=${reframe.x}:y=${reframe.y}`,
      );
      // The crop window's w/h can shrink below outputWidth/outputHeight
      // during a Fase 11 zoom punch-in (sendcmd varies them over time) -
      // scale re-samples whatever size the crop produced at each frame back
      // up to the fixed encoded output size, so the punch-in reads as a
      // camera zoom rather than the output resolution itself changing.
      mainChainFilters.push(`scale=${reframe.outputWidth}:${reframe.outputHeight}`);
    } else {
      mainChainFilters.push(
        `crop=w=${reframe.width}:h=${reframe.height}:x=${reframe.x}:y=${reframe.y}`,
      );
    }
  }

  if (!broll || broll.length === 0) {
    // The common case: a single simple filter chain on the one input
    // stream, exactly as before Fase 15 - -vf's shorthand syntax needs no
    // input/output labels at all, unlike -filter_complex below.
    const filters = [...mainChainFilters];
    if (subtitlesPath) {
      // After crop, not before - captions burn onto the final (possibly
      // reframed) frame, not the original wide one.
      filters.push(`subtitles='${escapeFfmpegFilterPath(subtitlesPath)}'`);
    }
    if (filters.length > 0) {
      args.push('-vf', filters.join(','));
    }
  } else {
    // -filter_complex is needed as soon as there's more than one input
    // stream to combine (the main clip plus one extra `-i` per B-roll
    // cutaway) - -vf's shorthand only ever operates on a single implicit
    // input. Each stage gets an explicit bracketed label rather than
    // relying on -vf's implicit chaining.
    for (const overlay of broll) {
      args.push('-i', overlay.filePath);
    }

    const complexParts: string[] = [];
    let currentLabel = '0:v';
    if (mainChainFilters.length > 0) {
      complexParts.push(`[${currentLabel}]${mainChainFilters.join(',')}[main0]`);
      currentLabel = 'main0';
    }

    broll.forEach((overlay, i) => {
      const inputIndex = i + 1; // input 0 is the main clip
      const brollLabel = `broll${i}`;
      const nextLabel = `main${i + 1}`;
      // setpts shifts the cutaway's own (already 0-based) timeline so it
      // starts exactly at overlay.startTime on the MAIN video's timeline -
      // overlay's `enable` window then just needs to match that same
      // start/end, not independently re-derive it.
      complexParts.push(
        `[${inputIndex}:v]setpts=PTS-STARTPTS+${overlay.startTime}/TB[${brollLabel}]`,
      );
      complexParts.push(
        `[${currentLabel}][${brollLabel}]overlay=enable='between(t,${overlay.startTime},${overlay.endTime})'[${nextLabel}]`,
      );
      currentLabel = nextLabel;
    });

    if (subtitlesPath) {
      complexParts.push(
        `[${currentLabel}]subtitles='${escapeFfmpegFilterPath(subtitlesPath)}'[withsubs]`,
      );
      currentLabel = 'withsubs';
    }

    args.push('-filter_complex', complexParts.join(';'));
    // Audio always comes from the main input - none of the B-roll cutaway
    // inputs' own audio (if any) is ever referenced/mapped.
    args.push('-map', `[${currentLabel}]`, '-map', '0:a');
  }

  args.push('-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart');

  await execFfmpegAtomically(() => args, outputPath, RENDER_TIMEOUT_MS);
}

// Fase 15 (Auto B-roll), pass 1 of 2 - trims a downloaded stock clip to
// BROLL_DURATION_SECONDS, scales+crops it to exactly fill the target output
// frame size (same crop-to-fill approach as computeCropDimensions, just
// applied to arbitrary stock footage instead of the source video), and
// fades its alpha channel IN over the first BROLL_FADE_SECONDS.
//
// Output is qtrle (QuickTime Animation, lossless, alpha-capable) in a .mov
// container - NOT libx264/mp4, which cannot carry an alpha channel at all.
// This intermediate file is never the final deliverable (only
// renderClip()'s -filter_complex ever reads it back), so the much larger
// file size versus H.264 doesn't matter.
//
// Split into two passes (this one, and fadeOutBRoll below) rather than one
// filter chain with both a fade-in AND fade-out - chaining two `fade`
// filter instances in a single ffmpeg invocation was verified (against a
// real ffmpeg 8.1.2 build) to blacken the ENTIRE output, not just the
// intended fade windows - see ffmpeg.spec.ts/CLAUDE.md's Fase 14 section
// for the same discovery applied to the silence-cut dip transition. A
// single `fade` filter alone is safe; two chained are not.
//
// assetType (Fase 16 - Multi-Provider Stock Assets) comes straight from the
// StockAsset that was downloaded to inputPath - this function (and the
// rest of the render pipeline) never needs to know which provider an asset
// came from, only whether it's a 'video' (played/trimmed normally) or an
// 'image' (Unsplash-only case: looped via `-loop 1` + an explicit
// `-f image2` to produce a video stream of the right duration from one
// still frame - `-f image2` sidesteps relying on the downloaded file
// having a recognizable image extension, which a stock API's URL often
// doesn't).
//
// Normalization (Fase 17) - Pexels/Pixabay/Unsplash each hand back footage
// at whatever resolution/framerate/color space THEIR source happened to be
// encoded at, which vary wildly across providers and even across results
// from the same provider. Besides the resolution normalization already
// happening via scale+crop above (always the CLIP's own output size, not
// a hardcoded constant - a fixed "1080p" would be wrong for a clip whose
// actual output is some other size), two more properties get forced to a
// single known standard here so every cutaway matches regardless of
// source:
// - `fps=BROLL_TARGET_FPS`: stock footage arrives anywhere from ~24fps to
//   60fps (Pexels commonly returns 60fps clips) - normalizing avoids
//   relying on ffmpeg's overlay/framesync to reconcile mismatched frame
//   rates on the fly, and keeps every cutaway's motion smoothness
//   consistent with the rest of the clip regardless of which provider it
//   came from.
// - `colorspace=iall=...:all=BROLL_COLOR_SPACE:range=tv`: forces a single
//   known color matrix/primaries/transfer + "tv" (limited, 16-235) range
//   on every asset, regardless of what its own source declared (or failed
//   to declare) - without this, switching between the main clip and a
//   B-roll cutaway can show a visible contrast/brightness jump purely from
//   mismatched color metadata, not any real content difference. `iall=`
//   (assumed INPUT color space) is mandatory, not just `all=` (output) -
//   verified directly against a real ffmpeg build: the colorspace filter
//   throws `Unsupported input primaries 2 (unknown)` and fails the whole
//   pass outright when fed footage with incomplete/unspecified color
//   metadata (common for web-distributed stock video) and no explicit
//   `iall=` override to fall back on.
const BROLL_TARGET_FPS = 30;
const BROLL_COLOR_SPACE = 'bt709';

export async function trimAndFadeInBRoll(
  inputPath: string,
  outputPath: string,
  outputWidth: number,
  outputHeight: number,
  durationSeconds: number,
  fadeSeconds: number,
  assetType: 'video' | 'image',
): Promise<void> {
  const inputArgs =
    assetType === 'image' ? ['-f', 'image2', '-loop', '1', '-i', inputPath] : ['-i', inputPath];

  await execFileAsync(FFMPEG_PATH, [
    '-y',
    ...inputArgs,
    '-t',
    durationSeconds.toString(),
    '-vf',
    `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,` +
      `crop=${outputWidth}:${outputHeight},fps=${BROLL_TARGET_FPS},` +
      `colorspace=iall=${BROLL_COLOR_SPACE}:all=${BROLL_COLOR_SPACE}:range=tv,` +
      `format=yuva420p,fade=t=in:st=0:d=${fadeSeconds}:alpha=1`,
    '-c:v',
    'qtrle',
    '-an',
    outputPath,
  ]);
}

// Fase 15 (Auto B-roll), pass 2 of 2 - fades trimAndFadeInBRoll's output
// alpha channel back OUT over the last fadeSeconds, on ITS OWN (already
// trimmed to durationSeconds), qtrle-preserved alpha channel. A single
// `fade` filter instance, same "only ever one per invocation" reasoning as
// pass 1's comment.
export async function fadeOutBRoll(
  inputPath: string,
  outputPath: string,
  durationSeconds: number,
  fadeSeconds: number,
): Promise<void> {
  await execFileAsync(FFMPEG_PATH, [
    '-y',
    '-i',
    inputPath,
    '-vf',
    `fade=t=out:st=${durationSeconds - fadeSeconds}:d=${fadeSeconds}:alpha=1`,
    '-c:v',
    'qtrle',
    '-an',
    outputPath,
  ]);
}

// Fase 8 (Content Intelligence) follow-up: removes silence gaps/filler words
// from an ALREADY-RENDERED clip (crop + burned-in captions already applied
// by renderClip() above) - a second pass, not folded into renderClip's own
// filtergraph. Cuts are computed in the same clip-relative timeline
// renderClip's own output uses (0 = this input file's start), so no time
// remapping is needed at all: captions/crop for a cut range are baked into
// the exact pixels being removed, so they simply vanish along with that
// range rather than needing to be re-timed onto a compressed timeline. This
// is what keeps this a clean, low-risk second pass instead of requiring
// renderClip's crop-path/subtitle timing to understand cuts at all.
//
// select/aselect's `between(t,a,b)` is evaluated per-frame/per-sample against
// each cut range; `not(sum of all of them)` keeps everything outside every
// cut. setpts/asetpts recompute continuous timestamps afterward - the
// standard idiom for this filter pair, since select alone leaves gaps in the
// timeline that play back as a frozen/silent stall rather than a jump cut.
// cuts must be non-empty - `not()` (an empty select expression) is invalid
// ffmpeg syntax and errors at filter-graph init, so the caller is
// responsible for only invoking this when there's actually something to
// remove (render-clip.worker.ts skips this whole pass otherwise).
//
// Fase 14 (Smart Transitions) - a quick dip-to-black is anchored at every
// junction computeCutJunctionTimestamps() finds (see cutlist.ts), softening
// what would otherwise be a hard, un-cushioned jump cut. Deliberately a
// "dip" (a real, commonly-used editing style, e.g. for pacing beats between
// talking-head sentences), not a true crossfade/dissolve between the
// retained content on each side - a real crossfade would need
// trimCutRanges' whole select-based single-pass removal replaced with a
// segment-trim + xfade concatenation chain, a much larger, riskier rewrite
// of an already-shipped feature (Fase 9) than this fase's scope justifies.
//
// VIDEO ONLY, not audio - verified directly against a real ffmpeg build
// (8.1.2-full_build) before shipping either half:
// - Chaining two `fade` filter instances in one -vf (needed for a dip's
//   fade-out THEN fade-in) reliably blackens the ENTIRE output, not just
//   the intended window - reproduced with plain `-vf`, `-filter_complex`
//   with explicit labeled pads, near/far-apart junctions, and frame-number
//   vs time-based fade args - a real bug/limitation in this exact build,
//   not a syntax mistake. Fixed by using a SINGLE `eq` filter instance
//   instead: `eq=eval=frame:brightness=<expr>`, where <expr> is a
//   time-varying triangular dip (0 far from any junction, -1 exactly at
//   one) combined across all junctions via nested min() - confirmed
//   correct frame-by-frame (normal colors well before/after, smoothly
//   dimmed approaching a junction, fully recovered past it).
// - The equivalent for audio (`volume=eval=frame:volume=<expr>` with a
//   conditional dip expression) was ALSO tested directly and found
//   unreliable: a linear expression referencing `t` (e.g. a ramp) varies
//   correctly across the file, but a conditional narrow-window dip
//   (`if(between(t,a,b),...)` or `if(lt(abs(t-x),f),...)`) triggers
//   inconsistently - measured via `volumedetect` on real output, the
//   targeted window showed at most a few dB of change instead of the
//   expected large reduction, most likely because this filter's per-frame
//   expression re-evaluation operates on internal audio frame block sizes
//   too coarse to reliably resolve a sub-second window. Rather than ship
//   an audio "dip" that only partially/inconsistently applies, audio stays
//   a plain hard cut (unchanged from Fase 9) - the cut point is silence or
//   a discarded filler word to begin with, so it's already far less
//   perceptually jarring than the visual jump cut this fase is fixing.
const TRANSITION_FADE_SECONDS = 0.15;

// A single triangular dip centered at `t`: 0 outside [t-fade, t+fade], -1
// exactly at t, linear in between. Written as an ffmpeg eval-expression
// string (evaluated per output frame against the filter's own `t`
// variable), not computed in JS - it has to run inside ffmpeg's own
// per-frame evaluator to see every output frame's exact timestamp.
function dipExpression(t: number, fadeSeconds: number): string {
  return `if(lt(abs(t-${t}),${fadeSeconds}),-(${fadeSeconds}-abs(t-${t}))/${fadeSeconds},0)`;
}

// Combines multiple junctions' dips into one expression via nested min() -
// dips are always <= 0, so the most negative (deepest) one active at any
// instant wins. A single eq filter instance handles any number of
// junctions this way, sidestepping the multi-fade-instance bug entirely
// rather than needing one filter per junction.
function combinedDipExpression(junctions: number[], fadeSeconds: number): string | null {
  if (junctions.length === 0) return null;
  return junctions
    .map((t) => dipExpression(t, fadeSeconds))
    .reduce((acc, term) => `min(${acc},${term})`);
}

export async function trimCutRanges(
  inputPath: string,
  outputPath: string,
  cuts: CutRange[],
  totalOutputDuration: number,
): Promise<void> {
  const cutExpr = cuts.map((cut) => `between(t,${cut.start},${cut.end})`).join('+');
  const keepExpr = `not(${cutExpr})`;

  // A junction right at the very start/end of the output has nothing on
  // one side to dip to/from, so it's skipped rather than dipping against
  // nothing.
  const junctions = computeCutJunctionTimestamps(cuts).filter(
    (t) => t >= TRANSITION_FADE_SECONDS && t <= totalOutputDuration - TRANSITION_FADE_SECONDS,
  );

  const videoFilters = [`select='${keepExpr}'`, 'setpts=N/FRAME_RATE/TB'];
  const dipExpr = combinedDipExpression(junctions, TRANSITION_FADE_SECONDS);
  if (dipExpr) {
    videoFilters.push(`eq=eval=frame:brightness='${dipExpr}'`);
  }

  await execFfmpegAtomically(
    () => [
      '-y',
      '-i',
      inputPath,
      '-vf',
      videoFilters.join(','),
      '-af',
      `aselect='${keepExpr}',asetpts=N/SR/TB`,
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
    ],
    outputPath,
    TRIM_TIMEOUT_MS,
  );
}
