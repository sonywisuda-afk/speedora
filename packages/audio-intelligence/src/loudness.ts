import {
  analyzeAudioLoudnessInputSchema,
  analyzeAudioLoudnessOutputSchema,
  type AnalyzeAudioLoudnessInput,
  type AnalyzeAudioLoudnessOutput,
  type LoudnessMeasurement,
} from '@speedora/contracts';

export type ExecFileFn = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface AnalyzeAudioLoudnessDeps {
  execFile: ExecFileFn;
  // Which ffmpeg binary to invoke - a deployment concern (PATH vs
  // FFMPEG_PATH env var), same reasoning as @speedora/reframe's
  // DetectFacesDeps.pythonPath: this module should never read
  // process.env itself. The adapter (apps/worker/src/
  // audioIntelligenceDeps.ts) computes and injects this.
  ffmpegPath: string;
}

// ffmpeg's astats filter prints one block of level stats to stderr per
// invocation. Applied to an already -ss/-to-trimmed input, the LAST "RMS
// level dB"/"Peak level dB" occurrence is always the most aggregated
// reading: multi-channel input gets an additional "Overall" section
// printed last, and mono input (which is all this project ever extracts -
// see extractAudio() in apps/worker/src/ffmpeg.ts) only has one section to
// begin with - so "last match" is correct either way without needing to
// special-case channel count.
const RMS_PATTERN = /RMS level dB:\s*(-?\d+(?:\.\d+)?)/g;
const PEAK_PATTERN = /Peak level dB:\s*(-?\d+(?:\.\d+)?)/g;

function lastMatch(pattern: RegExp, text: string): number | null {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  let last: number | null = null;
  while ((match = pattern.exec(text)) !== null) {
    last = Number.parseFloat(match[1]);
  }
  return last;
}

async function analyzeOneSegment(
  audioPath: string,
  segment: { start: number; end: number },
  deps: AnalyzeAudioLoudnessDeps,
): Promise<LoudnessMeasurement> {
  try {
    const { stderr } = await deps.execFile(deps.ffmpegPath, [
      '-ss',
      segment.start.toString(),
      '-to',
      segment.end.toString(),
      '-i',
      audioPath,
      '-af',
      'astats',
      '-f',
      'null',
      '-',
    ]);
    return { rmsDb: lastMatch(RMS_PATTERN, stderr), peakDb: lastMatch(PEAK_PATTERN, stderr) };
  } catch {
    // One segment's ffmpeg call failing (corrupt slice, zero-length range,
    // etc.) never fails the whole analysis - same per-item isolation as
    // detectVocalEmotions' per-segment null (transcribe.worker.ts).
    return { rmsDb: null, peakDb: null };
  }
}

// Runs ffmpeg's astats filter once per segment against the given audio
// file, reading each segment's own RMS/peak level in dB. One subprocess
// call per segment (not one call with frame-level metadata parsing) -
// simpler and more directly maps "this segment's time range" to "this
// segment's stats" than correlating astats' per-frame metadata output
// back to timestamps would be.
//
// KNOWN GAP: the astats stderr format this parses is based on documented
// ffmpeg output, not verified against a real ffmpeg binary - this
// sandbox has no ffmpeg on PATH to test against. Unlike every other
// subprocess-based module in this codebase (reframe's face detection,
// diarization, vocal emotion - all verified end-to-end against real
// tools in an earlier session), this parsing logic is only unit-tested
// against a hand-built fixture string. Treat as unverified until run
// against a real ffmpeg binary.
export async function analyzeAudioLoudness(
  input: AnalyzeAudioLoudnessInput,
  deps: AnalyzeAudioLoudnessDeps,
): Promise<AnalyzeAudioLoudnessOutput> {
  const { audioPath, segments } = analyzeAudioLoudnessInputSchema.parse(input);
  const results = await Promise.all(
    segments.map((segment) => analyzeOneSegment(audioPath, segment, deps)),
  );
  return analyzeAudioLoudnessOutputSchema.parse({ segments: results });
}
