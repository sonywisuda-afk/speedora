import type {
  AudioFeatures,
  EditingRhythmFeatures,
  MotionEnergyFeatures,
  MotionEnergySample,
  SceneFeatures,
} from '@speedora/contracts';
import { deriveAudioFeatures } from '@speedora/audio-intelligence';
import { deriveEditingRhythmFeatures } from '@speedora/editing-rhythm';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Always computed - deriveAudioFeatures degrades gracefully to null fields on missing rmsDb/peakDb
// data, same as every other deriveXFeatures in this pipeline. Depends only on ctx.transcript, not
// on any other node.
export const audioFeaturesNode: GraphNode<RenderGraphContext, AudioFeatures> = {
  id: 'audioFeatures',
  deps: [],
  optional: false,
  run: (_get, ctx) =>
    deriveAudioFeatures(
      ctx.transcript.map((segment) => ({
        rmsDb: segment.rmsDb ?? null,
        peakDb: segment.peakDb ?? null,
        speakingRateWordsPerSecond: segment.speakingRateWordsPerSecond ?? null,
      })),
    ),
};

// Taxonomy category F (Editing Rhythm) - a COMPOSITE signal, per explicit user architectural
// rule: its own package (@speedora/editing-rhythm) combines OTHER signals' already-computed
// output (sceneCuts/motionEnergy raw timelines, plus the sceneFeatures/motionEnergyFeatures/
// audioFeatures aggregates) rather than running a fresh subprocess/ffmpeg call of its own.
export const editingRhythmFeaturesNode: GraphNode<RenderGraphContext, EditingRhythmFeatures> = {
  id: 'editingRhythmFeatures',
  deps: ['sceneCuts', 'motionEnergy', 'sceneFeatures', 'motionEnergyFeatures', 'audioFeatures'],
  optional: false,
  run: (get, ctx) =>
    deriveEditingRhythmFeatures({
      clipDurationSeconds: ctx.endTime - ctx.startTime,
      sceneCuts: get<number[]>('sceneCuts'),
      motionEnergySamples: get<MotionEnergySample[]>('motionEnergy'),
      cutsPerMinute: get<SceneFeatures>('sceneFeatures').cutsPerMinute,
      averageMotionEnergy: get<MotionEnergyFeatures>('motionEnergyFeatures').averageMotionEnergy,
      averageSpeakingRateWordsPerSecond:
        get<AudioFeatures>('audioFeatures').averageSpeakingRateWordsPerSecond,
    }),
};

export const audioEditingNodes = [audioFeaturesNode, editingRhythmFeaturesNode];
