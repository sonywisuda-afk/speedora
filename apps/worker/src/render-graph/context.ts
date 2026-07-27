import type { ClipScores, SpeakerTurn, ThumbnailWeights } from '@speedora/contracts';
import type { AudioActivityWindow } from '@speedora/facial-intelligence';
import type { RenderClipJobData } from '@speedora/shared';

// The ambient, already-resolved context every render-clip graph node's `run` receives. Grown
// incrementally, one field at a time, as more of render-clip.worker.ts's detectors/derive
// functions migrate into the graph (see ARCHITECTURE.md's "Composing multiple modules" section)
// - only fields genuinely needed by an already-migrated node belong here, not the full eventual
// shape speculatively up front.
export interface RenderGraphContext {
  clipId: string;
  sourcePath: string;
  startTime: number;
  endTime: number;
  transcript: RenderClipJobData['transcript'];
  scores: ClipScores | null;
  // Precomputed once here rather than recomputed per node - both are pure/deterministic over
  // (transcript, startTime), and the pre-graph code called the audio-activity-windows one 3
  // separate times for this exact reason (see ARCHITECTURE.md's "Composing multiple modules"
  // section for why that's a deliberate, explicitly-flagged efficiency fix, not an accident).
  audioActivityWindows: AudioActivityWindow[];
  speakerTurns: SpeakerTurn[];
  // Built by buildReframePlan() BEFORE the graph runs (captions/rendering need it regardless of
  // any AI signal) - only the two dimensions compositionFeaturesNode needs for its aspect-ratio-
  // aware thresholds are threaded through, not the full ReframeOptions shape (crop path, sendCmd
  // script path, etc. are rendering-only concerns with no graph node that needs them).
  reframe: { outputWidth: number; outputHeight: number };
  // Pre-Processing Settings roadmap (Phase 2) - resolved once from
  // Video.processingOptions.sceneAnalysis before the graph runs (see
  // render-clip.worker.ts). Read by scene.ts's raw detector nodes to decide
  // whether to do their real detection work at all - true (run it) for
  // every field matches every pre-Phase-2 render exactly.
  sceneAnalysis: {
    detectSceneCuts: boolean;
    detectMotionEnergy: boolean;
    detectCameraMotion: boolean;
  };
  // Pre-Processing Settings roadmap (Phase 3) - resolved once from
  // Video.processingOptions.thumbnail.preferredSignals before the graph
  // runs (see render-clip.worker.ts). undefined (the common case) means
  // thumbnailSelectionNode passes no override at all, so
  // selectThumbnailTimestamp() falls back to its own DEFAULT_THUMBNAIL_WEIGHTS
  // parameter default unchanged - identical behavior to every pre-Phase-3
  // render.
  thumbnailWeights?: ThumbnailWeights;
}
