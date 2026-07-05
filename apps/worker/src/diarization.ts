import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PYTHON_PATH = process.env.PYTHON_PATH ?? 'python3';
const SCRIPT_PATH = path.join(__dirname, '../scripts/diarize_speakers.py');

export interface SpeakerTurn {
  start: number;
  end: number;
  speaker: string;
}

// Shells out to scripts/diarize_speakers.py exactly like faceDetection.ts
// shells out to detect_faces.py - pyannote.audio's own story is
// Python-first, no maintained Node equivalent. audioPath must be a local
// file (same constraint as ffmpeg/MediaPipe - no seeking directly against
// object storage).
//
// HUGGINGFACE_TOKEN is read by the Python script itself from its inherited
// environment (execFile passes the parent process's env by default) -
// deliberately NOT passed as a CLI arg, so it never appears in argv/process
// listings/error logs the way a plain string argument could.
//
// Throws (doesn't swallow) when the token is missing or the gated model's
// terms haven't been accepted on Hugging Face - the caller
// (transcribe.worker.ts) is responsible for catching this and falling back
// to "no speaker labels" for the whole video, same "don't fail the job over
// an optional signal" pattern as detectFaces's caller in
// render-clip.worker.ts.
export async function diarizeSpeakers(audioPath: string): Promise<SpeakerTurn[]> {
  const { stdout } = await execFileAsync(PYTHON_PATH, [SCRIPT_PATH, audioPath]);
  return JSON.parse(stdout) as SpeakerTurn[];
}

// "Speaker A", "Speaker B", ... in order of first appearance - friendlier
// than pyannote's raw "SPEAKER_00"/"SPEAKER_01" IDs, which are meaningless
// to an end user and not stable/comparable across different videos anyway
// (so there's no reason to expose the raw ID at all). Falls back to a
// plain number past Z - 26+ distinct speakers in one clip is not a realistic
// case this needs to look nice for.
function friendlyLabel(index: number): string {
  return index < 26 ? `Speaker ${String.fromCharCode(65 + index)}` : `Speaker ${index + 1}`;
}

// One label per segment, aligned by index to `segments` - undefined for a
// segment no diarization turn overlaps at all (diarization was skipped
// entirely, giving turns=[], or there's a gap in turn coverage). The
// overlap-majority approach: each segment gets whichever speaker's turn
// covers the largest slice of its own [start, end) - segments are Whisper's
// own sentence-ish chunks, which only rarely straddle an actual speaker
// change, so "largest overlap wins" is a reasonable single label per segment
// rather than needing per-word speaker assignment.
export function assignSpeakerLabels(
  segments: Array<{ start: number; end: number }>,
  turns: SpeakerTurn[],
): Array<string | undefined> {
  const rawToLabel = new Map<string, string>();

  return segments.map((segment) => {
    let bestOverlapSeconds = 0;
    let bestSpeaker: string | undefined;
    for (const turn of turns) {
      const overlap = Math.min(segment.end, turn.end) - Math.max(segment.start, turn.start);
      if (overlap > bestOverlapSeconds) {
        bestOverlapSeconds = overlap;
        bestSpeaker = turn.speaker;
      }
    }
    if (bestSpeaker === undefined) return undefined;

    if (!rawToLabel.has(bestSpeaker)) {
      rawToLabel.set(bestSpeaker, friendlyLabel(rawToLabel.size));
    }
    return rawToLabel.get(bestSpeaker);
  });
}
