import {
  detectSceneCutsInputSchema,
  detectSceneCutsOutputSchema,
  type DetectSceneCutsInput,
  type DetectSceneCutsOutput,
} from '@speedora/contracts';

export type ExecFileFn = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface DetectSceneCutsDeps {
  execFile: ExecFileFn;
  // Same deployment-plumbing reasoning as @speedora/audio-intelligence's
  // AnalyzeAudioLoudnessDeps.ffmpegPath - never read from process.env
  // inside this module itself.
  ffmpegPath: string;
}

// ffmpeg's own frame-to-frame "scene change" score is 0-1; 0.4 is the
// conventional default recommended in ffmpeg's own documentation/community
// examples for typical hard-cut detection - not something this project
// calibrated itself.
const DEFAULT_THRESHOLD = 0.4;

// ffmpeg's showinfo filter prints one line per frame that passes the
// `select` filter, each containing a "pts_time:<seconds>" field - this is
// the presentation timestamp of that frame, already relative to wherever
// -ss/-i seeked to (this project always puts -ss before -i, i.e. input
// seeking) rather than absolute source-video time.
const PTS_TIME_PATTERN = /pts_time:\s*(-?\d+(?:\.\d+)?)/g;

function parsePtsTimes(stderr: string): number[] {
  PTS_TIME_PATTERN.lastIndex = 0;
  const cuts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = PTS_TIME_PATTERN.exec(stderr)) !== null) {
    cuts.push(Number.parseFloat(match[1]));
  }
  return cuts;
}

// Detects hard shot/scene cuts within [startTime, endTime) of videoPath via
// ffmpeg's built-in scene-detection filter (select='gt(scene,threshold)')
// plus showinfo to print each passing frame's timestamp - no ML model, no
// new dependency (ffmpeg is already required by this project). One
// subprocess call for the whole range (not one per transcript segment like
// @speedora/audio-intelligence - scene cuts aren't tied to speech
// segments at all).
//
// PENDING REAL-MACHINE VERIFICATION: this sandbox has no ffmpeg on PATH.
// The showinfo stderr format parsed here is based on documented ffmpeg
// output, not a real run - in particular, whether -ss before -i really
// resets pts_time to 0 at the seek point (rather than reporting absolute
// source-video time) is exactly the kind of detail that needs confirming
// against a real ffmpeg binary before this is trusted in production. If
// pts_time turns out to be absolute instead, the fix is to subtract
// startTime from each parsed value here.
export async function detectSceneCuts(
  input: DetectSceneCutsInput,
  deps: DetectSceneCutsDeps,
): Promise<DetectSceneCutsOutput> {
  const { videoPath, startTime, endTime, threshold } = detectSceneCutsInputSchema.parse(input);
  const sceneThreshold = threshold ?? DEFAULT_THRESHOLD;

  try {
    const { stderr } = await deps.execFile(deps.ffmpegPath, [
      '-ss',
      startTime.toString(),
      '-to',
      endTime.toString(),
      '-i',
      videoPath,
      '-vf',
      `select='gt(scene,${sceneThreshold})',showinfo`,
      '-f',
      'null',
      '-',
    ]);
    return detectSceneCutsOutputSchema.parse({ cuts: parsePtsTimes(stderr) });
  } catch {
    // A failed ffmpeg call never fails the whole clip - same "optional
    // signal" pattern as detectFaces (packages/reframe) and
    // analyzeAudioLoudness (packages/audio-intelligence): no cuts detected
    // is indistinguishable from "couldn't analyze", both mean the caller
    // gets no scene-cut data for this clip.
    return detectSceneCutsOutputSchema.parse({ cuts: [] });
  }
}
