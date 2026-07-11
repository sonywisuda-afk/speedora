import type { ObjectFeatures, ObjectSample, ObjectTrack } from '@speedora/contracts';
import { deriveObjectFeatures, detectObjects, trackObjects } from '@speedora/object-intelligence';
import { objectIntelligenceDeps } from '../../objectIntelligenceDeps';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Object Intelligence roadmap, Batch OI-1 (Foundation) - same "never fails the job" pattern as
// every other MediaPipe-based detector.
export const objectsNode: GraphNode<RenderGraphContext, ObjectSample[] | null> = {
  id: 'objects',
  deps: [],
  optional: true,
  fallback: null,
  label: 'object detection',
  dataLabel: 'object data',
  run: (_get, ctx) =>
    detectObjects(
      { sourcePath: ctx.sourcePath, startTime: ctx.startTime, endTime: ctx.endTime },
      objectIntelligenceDeps,
    ),
};

// Object Intelligence roadmap, Batch OI-1 - cross-frame tracking over Batch OI-1's own raw
// `objects` (a genuine multi-object tracker, see @speedora/object-intelligence's trackObjects()
// module comment). Same "raw/tracks/features" three-layer pattern as ocrText/ocrTracks/ocrFeatures.
export const objectTracksNode: GraphNode<RenderGraphContext, ObjectTrack[] | null> = {
  id: 'objectTracks',
  deps: ['objects'],
  optional: false,
  run: (get) => {
    const objects = get<ObjectSample[] | null>('objects');
    return objects ? trackObjects(objects) : null;
  },
};

export const objectFeaturesNode: GraphNode<RenderGraphContext, ObjectFeatures | null> = {
  id: 'objectFeatures',
  deps: ['objects', 'objectTracks'],
  optional: false,
  run: (get) => {
    const objects = get<ObjectSample[] | null>('objects');
    if (!objects) return null;
    return deriveObjectFeatures(get<ObjectTrack[] | null>('objectTracks') ?? [], objects.length);
  },
};

export const objectNodes = [objectsNode, objectTracksNode, objectFeaturesNode];
