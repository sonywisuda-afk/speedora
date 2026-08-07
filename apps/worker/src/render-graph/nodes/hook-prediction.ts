import type {
  AudioFeatures,
  HookPauseFeatures,
  HookPredictionOutput,
  HookPredictionSegment,
  SpeakerFusionFeatures,
} from '@speedora/contracts';
import { derivePauseFeatures, predictHook } from '@speedora/hook-prediction';
import { openai } from '../../openai';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Re-anchors transcript segments/words onto the clip's own timeline (0 =
// this clip's start) - same convention as render-clip.worker.ts's
// toClipRelativeWords/toAudioActivityWindows (shared by @speedora/cutlist,
// @speedora/subtitles, FaceSample.t, and now this node).
function toHookPredictionSegments(
  transcript: RenderGraphContext['transcript'],
  startTime: number,
): HookPredictionSegment[] {
  return transcript.map((segment) => ({
    start: segment.start - startTime,
    end: segment.end - startTime,
    text: segment.text,
    emotion: segment.emotion ?? null,
    words:
      segment.words?.map((word) => ({
        word: word.word,
        start: word.start - startTime,
        end: word.end - startTime,
      })) ?? null,
  }));
}

// AI Intelligence v4, Phase 1 (Hook Prediction Engine - see docs/ai/
// intelligence-v4.md). Pure and cheap - reuses @speedora/cutlist's
// silence-gap math via @speedora/hook-prediction's derivePauseFeatures.
// Split into its own node (rather than folded into hookPredictionNode below)
// so this cheap, reliable half stays optional: false even though the LLM
// half is allowed to fail - same "adapter calls the pure piece it needs
// before the module's main entry" shape as nodes/face-speaker.ts.
export const hookPauseFeaturesNode: GraphNode<RenderGraphContext, HookPauseFeatures> = {
  id: 'hookPauseFeatures',
  deps: [],
  optional: false,
  run: (_get, ctx) => {
    const words = toHookPredictionSegments(ctx.transcript, ctx.startTime).flatMap(
      (segment) => segment.words ?? [],
    );
    return derivePauseFeatures(words, ctx.endTime - ctx.startTime);
  },
};

// The LLM-backed step - optional: true / fallback: null, same "external I/O
// allowed to fail without failing the job" convention as every other
// detector node (e.g. faceLandmarksNode in nodes/face-speaker.ts). Runs on
// every render regardless of isHookPredictionEnabled() - ADR D8: the flag
// gates GET /clips/:id/intelligence's exposure, not computation, so
// flipping it on later needs no backfill.
export const hookPredictionNode: GraphNode<RenderGraphContext, HookPredictionOutput | null> = {
  id: 'hookPrediction',
  deps: ['hookPauseFeatures', 'audioFeatures', 'speakerFusionFeatures'],
  optional: true,
  fallback: null,
  label: 'hook prediction',
  dataLabel: 'hook prediction data',
  run: (get, ctx) => {
    const pauseFeatures = get<HookPauseFeatures>('hookPauseFeatures');
    const audioFeatures = get<AudioFeatures>('audioFeatures');
    const speakerFusionFeatures = get<SpeakerFusionFeatures | null>('speakerFusionFeatures');

    return predictHook(
      {
        clipId: ctx.clipId,
        segments: toHookPredictionSegments(ctx.transcript, ctx.startTime),
        audioFeatures,
        pauseFeatures,
        dominantSpeakerConfidence: speakerFusionFeatures?.dominantSpeakerConfidence ?? null,
      },
      { openai },
    );
  },
};

export const hookPredictionNodes = [hookPauseFeaturesNode, hookPredictionNode];
