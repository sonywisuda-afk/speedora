import type { SelectThumbnailTimestampOutput } from '@speedora/contracts';
import { selectThumbnailTimestamp } from '@speedora/thumbnail-selection';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// Phase 4 of the thumbnail roadmap (AI Thumbnail Selection) - Level 2
// (frame/timestamp) selection only, see @speedora/contracts'
// thumbnail-selection.ts for the full policy this node must not violate:
// this NEVER reads highlightScore/highlightRank (Level 1, computed
// separately by @speedora/fusion-engine after this graph resolves), only
// already-computed per-timestamp signals already flowing through this same
// graph. Pure/synchronous over already-resolved deps, same class as
// compositionFeaturesNode.
export const thumbnailSelectionNode: GraphNode<RenderGraphContext, SelectThumbnailTimestampOutput> =
  {
    id: 'thumbnailSelection',
    deps: [
      'faceLandmarks',
      'facialEmotions',
      'ocrTracks',
      'gestures',
      'motionEnergy',
      'sceneCutEvents',
      'primarySubjectSamples',
    ],
    optional: false,
    // Pre-Processing Settings roadmap (Phase 3) - ctx.thumbnailWeights is
    // undefined for every pre-Phase-3 render (and any render with no
    // preferredSignals set), in which case selectThumbnailTimestamp()'s own
    // `weights = DEFAULT_THUMBNAIL_WEIGHTS` parameter default applies -
    // passing `undefined` explicitly here is identical to omitting the
    // argument.
    run: (get, ctx) =>
      selectThumbnailTimestamp(
        {
          clipDurationSeconds: ctx.endTime - ctx.startTime,
          faceLandmarks: get('faceLandmarks'),
          facialEmotions: get('facialEmotions'),
          ocrTracks: get('ocrTracks'),
          gestures: get('gestures'),
          motionEnergy: get('motionEnergy'),
          sceneCutEvents: get('sceneCutEvents'),
          primarySubjectSamples: get('primarySubjectSamples'),
        },
        ctx.thumbnailWeights,
      ),
  };

export const thumbnailSelectionNodes = [thumbnailSelectionNode];
