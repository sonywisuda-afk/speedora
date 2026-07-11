import type {
  ActiveSpeakerSample,
  CompositionFeatures,
  FaceLandmarkSample,
  ObjectSample,
  ObjectTrack,
  PrimarySubjectSample,
} from '@speedora/contracts';
import { deriveCompositionFeatures } from '@speedora/composition-intelligence';
import { selectPrimarySubject } from '@speedora/primary-subject';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Composition Intelligence roadmap, Batch RB-1/RB-2 (see docs/ai/composition-intelligence.md) - a
// COMPOSITE signal, same "no fresh detector, combine what's already computed" shape as
// editingRhythmFeatures. Primary Subject Selection (@speedora/primary-subject) runs over this
// clip's own already-computed faceLandmarks/activeSpeakerSamples/objectTracks to decide, per
// sampled instant, which tracked entity is "the subject" - never a new detector, only a choice
// among existing candidates.
export const primarySubjectSamplesNode: GraphNode<RenderGraphContext, PrimarySubjectSample[]> = {
  id: 'primarySubjectSamples',
  deps: ['faceLandmarks', 'objects', 'activeSpeakerSamples', 'objectTracks'],
  optional: false,
  run: (get) => {
    const faceLandmarks = get<FaceLandmarkSample[] | null>('faceLandmarks');
    const objects = get<ObjectSample[] | null>('objects');
    // A UNION of both signals' own `t` values, not an either-or fallback - face detection "ran
    // but found nothing" (an empty array, the common case for a clip with no visible face) is
    // truthy and would silently defeat a `faceLandmarks?.map(...) ?? objects?.map(...)` fallback
    // even when `objects` has real per-frame data to offer, since `??` only triggers on
    // null/undefined, not on an empty (but present) array.
    const sampleTimestamps = Array.from(
      new Set([
        ...(faceLandmarks ?? []).map((sample) => sample.t),
        ...(objects ?? []).map((sample) => sample.t),
      ]),
    ).sort((a, b) => a - b);

    return selectPrimarySubject({
      sampleTimestamps,
      faceLandmarks,
      activeSpeakerSamples: get<ActiveSpeakerSample[] | null>('activeSpeakerSamples'),
      objectTracks: get<ObjectTrack[] | null>('objectTracks'),
    });
  },
};

export const compositionFeaturesNode: GraphNode<RenderGraphContext, CompositionFeatures> = {
  id: 'compositionFeatures',
  deps: ['primarySubjectSamples'],
  optional: false,
  run: (get, ctx) =>
    deriveCompositionFeatures({
      frameSize: { width: ctx.reframe.outputWidth, height: ctx.reframe.outputHeight },
      samples: get<PrimarySubjectSample[]>('primarySubjectSamples').map((sample) => ({
        t: sample.t,
        subjectBox: sample.box,
        subjectTrackId: sample.trackId,
        facingYaw: sample.facingYaw,
      })),
    }),
};

export const compositionNodes = [primarySubjectSamplesNode, compositionFeaturesNode];
