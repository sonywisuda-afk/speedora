import type { FaceLandmarkSample, OcrFeatures, OcrSample, OcrTextTrack } from '@speedora/contracts';
import type { FaceBoundingBoxSample } from '@speedora/ocr-intelligence';
import {
  classifyOcrTrack,
  deriveOcrFeatures,
  detectOcrText,
  trackOcrText,
} from '@speedora/ocr-intelligence';
import { ocrIntelligenceDeps } from '../../ocrIntelligenceDeps';
import type { GraphNode } from '../executor';
import type { RenderGraphContext } from '../context';

// OCR initiative Batch OCR-1 (AI Fusion roadmap) - same "never fails the job" pattern as every
// other detector. Raw detection only (text + bounding box + confidence per sampled frame).
export const ocrTextNode: GraphNode<RenderGraphContext, OcrSample[] | null> = {
  id: 'ocrText',
  deps: [],
  optional: true,
  fallback: null,
  label: 'OCR text detection',
  dataLabel: 'OCR data',
  run: (_get, ctx) =>
    detectOcrText(
      { sourcePath: ctx.sourcePath, startTime: ctx.startTime, endTime: ctx.endTime },
      ocrIntelligenceDeps,
    ),
};

// OCR-2's own narrow input contract, moved here (rather than staying render-clip.worker.ts's own
// module-level helper) since it's needed only by this node, which is the only place it can be
// called from without render-graph importing back from the worker file it's meant to be used by.
function toFaceBoundingBoxes(faceLandmarks: FaceLandmarkSample[]): FaceBoundingBoxSample[] {
  return faceLandmarks
    .filter(
      (
        sample,
      ): sample is FaceLandmarkSample & {
        boundingBox: NonNullable<FaceLandmarkSample['boundingBox']>;
      } => sample.boundingBox !== null,
    )
    .map((sample) => ({ t: sample.t, boundingBox: sample.boundingBox }));
}

// OCR initiative Batch OCR-2 - cross-frame tracking + rule-based classification over Batch OCR-1's
// own raw ocrText (pure TypeScript, not a Python-script change). nearFace resolves to null on
// every track (not false) when faceLandmarks itself is null - "no face data supplied at all".
export const ocrTracksNode: GraphNode<RenderGraphContext, OcrTextTrack[] | null> = {
  id: 'ocrTracks',
  deps: ['ocrText', 'faceLandmarks'],
  optional: false,
  run: (get) => {
    const ocrText = get<OcrSample[] | null>('ocrText');
    if (!ocrText) return null;
    const faceLandmarks = get<FaceLandmarkSample[] | null>('faceLandmarks');
    return trackOcrText(ocrText, faceLandmarks ? toFaceBoundingBoxes(faceLandmarks) : []).map(
      classifyOcrTrack,
    );
  },
};

export const ocrFeaturesNode: GraphNode<RenderGraphContext, OcrFeatures | null> = {
  id: 'ocrFeatures',
  deps: ['ocrText', 'ocrTracks'],
  optional: false,
  run: (get) => {
    const ocrText = get<OcrSample[] | null>('ocrText');
    if (!ocrText) return null;
    return deriveOcrFeatures(get<OcrTextTrack[] | null>('ocrTracks') ?? [], ocrText.length);
  },
};

export const ocrNodes = [ocrTextNode, ocrTracksNode, ocrFeaturesNode];
