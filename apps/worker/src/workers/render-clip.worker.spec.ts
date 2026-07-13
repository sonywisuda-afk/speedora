import { CaptionStyle, Prisma, VideoStatus } from '@speedora/database';
import type { ClipScores, TranscriptSegment } from '@speedora/shared';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

// Returns a path-tagged fake stream (not a real Readable) - enough for
// uploadObjectMock assertions to tell which scratch file (untrimmed
// "output" vs. trimmed) actually got streamed, without needing a real
// filesystem.
const createReadStreamMock = jest.fn((...args: unknown[]) => ({ fakeStream: args[0] }));
jest.mock('node:fs', () => ({
  createWriteStream: jest.fn().mockReturnValue({ fake: 'writable' }),
  createReadStream: (...args: unknown[]) => createReadStreamMock(...args),
}));

const pipelineMock = jest.fn();
jest.mock('node:stream/promises', () => ({
  pipeline: (...args: unknown[]) => pipelineMock(...args),
}));

const writeFileMock = jest.fn();
const statMock = jest.fn();
const readFileMock = jest.fn().mockResolvedValue(Buffer.from('fake-blur-bytes'));
jest.mock('node:fs/promises', () => ({
  writeFile: (...args: unknown[]) => writeFileMock(...args),
  stat: (...args: unknown[]) => statMock(...args),
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

const renderClipMock = jest.fn();
const getVideoDimensionsMock = jest.fn();
const trimCutRangesMock = jest.fn();
const trimAndFadeInBRollMock = jest.fn();
const fadeOutBRollMock = jest.fn();
const extractThumbnailMock = jest.fn();
const extractBlurPlaceholderMock = jest.fn();
jest.mock('../ffmpeg', () => ({
  renderClip: (...args: unknown[]) => renderClipMock(...args),
  getVideoDimensions: (...args: unknown[]) => getVideoDimensionsMock(...args),
  trimCutRanges: (...args: unknown[]) => trimCutRangesMock(...args),
  trimAndFadeInBRoll: (...args: unknown[]) => trimAndFadeInBRollMock(...args),
  fadeOutBRoll: (...args: unknown[]) => fadeOutBRollMock(...args),
  extractThumbnail: (...args: unknown[]) => extractThumbnailMock(...args),
  extractBlurPlaceholder: (...args: unknown[]) => extractBlurPlaceholderMock(...args),
}));

const findBRollMomentsMock = jest.fn();
const downloadStockAssetMock = jest.fn();
jest.mock('../broll', () => ({
  BROLL_DURATION_SECONDS: 2.5,
  BROLL_FADE_SECONDS: 0.3,
  findBRollMoments: (...args: unknown[]) => findBRollMomentsMock(...args),
  downloadStockAsset: (...args: unknown[]) => downloadStockAssetMock(...args),
}));

const searchAssetsMock = jest.fn();
jest.mock('../assets/stockAssetService', () => ({
  stockAssetService: { searchAssets: (...args: unknown[]) => searchAssetsMock(...args) },
}));

const buildAssMock = jest.fn();
jest.mock('@speedora/subtitles', () => ({
  buildAss: (...args: unknown[]) => buildAssMock(...args),
}));

// deriveSceneFeatures/deriveMotionEnergyFeatures/deriveCameraMotionFeatures
// are pure functions (no subprocess/side effects), so they're left real
// here (via jest.requireActual) rather than mocked - same precedent as
// cutlist's functions in this same spec file and computeSpeakingRate in
// transcribe.worker.spec.ts. Only detectSceneCuts/classifySceneCutTypes/
// analyzeMotionEnergy/detectCameraMotion (the ffmpeg/Python subprocess
// calls) are mocked.
const detectSceneCutsMock = jest.fn();
const classifySceneCutTypesMock = jest.fn();
const analyzeMotionEnergyMock = jest.fn();
const detectCameraMotionMock = jest.fn();
jest.mock('@speedora/scene-intelligence', () => ({
  ...jest.requireActual('@speedora/scene-intelligence'),
  detectSceneCuts: (...args: unknown[]) => detectSceneCutsMock(...args),
  classifySceneCutTypes: (...args: unknown[]) => classifySceneCutTypesMock(...args),
  analyzeMotionEnergy: (...args: unknown[]) => analyzeMotionEnergyMock(...args),
  detectCameraMotion: (...args: unknown[]) => detectCameraMotionMock(...args),
}));

// Same reasoning as above - deriveFacialEmotionFeatures/
// deriveFaceLandmarkFeatures are pure, left real.
const detectFacialEmotionMock = jest.fn();
const detectFaceLandmarksMock = jest.fn();
jest.mock('@speedora/facial-intelligence', () => ({
  ...jest.requireActual('@speedora/facial-intelligence'),
  detectFacialEmotion: (...args: unknown[]) => detectFacialEmotionMock(...args),
  detectFaceLandmarks: (...args: unknown[]) => detectFaceLandmarksMock(...args),
}));

// Same reasoning as above - deriveGestureFeatures is pure, left real.
const detectGesturesMock = jest.fn();
jest.mock('@speedora/gesture-intelligence', () => ({
  ...jest.requireActual('@speedora/gesture-intelligence'),
  detectGestures: (...args: unknown[]) => detectGesturesMock(...args),
}));

// OCR initiative Batch OCR-2 - trackOcrText/classifyOcrTrack/
// deriveOcrFeatures are pure, left real (same reasoning as
// derive*Features elsewhere); only the subprocess-calling detectOcrText
// is mocked.
const detectOcrTextMock = jest.fn();
jest.mock('@speedora/ocr-intelligence', () => ({
  ...jest.requireActual('@speedora/ocr-intelligence'),
  detectOcrText: (...args: unknown[]) => detectOcrTextMock(...args),
}));

// Object Intelligence roadmap, Batch OI-1 - trackObjects/
// deriveObjectFeatures are pure, left real (same reasoning as
// derive*Features elsewhere); only the subprocess-calling detectObjects
// is mocked.
const detectObjectsMock = jest.fn();
jest.mock('@speedora/object-intelligence', () => ({
  ...jest.requireActual('@speedora/object-intelligence'),
  detectObjects: (...args: unknown[]) => detectObjectsMock(...args),
}));

const detectFacesMock = jest.fn();
const computeCropDimensionsMock = jest.fn();
const buildCropPathMock = jest.fn();
const buildSendCmdScriptMock = jest.fn();
const findEmphasisWordsMock = jest.fn();
jest.mock('@speedora/reframe', () => ({
  detectFaces: (...args: unknown[]) => detectFacesMock(...args),
  computeCropDimensions: (...args: unknown[]) => computeCropDimensionsMock(...args),
  buildCropPath: (...args: unknown[]) => buildCropPathMock(...args),
  buildSendCmdScript: (...args: unknown[]) => buildSendCmdScriptMock(...args),
  findEmphasisWords: (...args: unknown[]) => findEmphasisWordsMock(...args),
}));

let scratchCounter = 0;
const reserveScratchPathMock = jest.fn((prefix: string, ext: string) => {
  scratchCounter += 1;
  return Promise.resolve(`/tmp/speedora/${prefix}-${scratchCounter}${ext}`);
});
const cleanupTempFileMock = jest.fn();
jest.mock('../storage', () => ({
  reserveScratchPath: (...args: [string, string]) => reserveScratchPathMock(...args),
  cleanupTempFile: (...args: unknown[]) => cleanupTempFileMock(...args),
}));

const getObjectStreamMock = jest.fn();
const uploadObjectMock = jest.fn();
jest.mock('@speedora/storage', () => ({
  getObjectStream: (...args: unknown[]) => getObjectStreamMock(...args),
  uploadObject: (...args: unknown[]) => uploadObjectMock(...args),
}));

const clipUpdateMock = jest.fn();
const clipFindManyMock = jest.fn();
const clipFindUniqueMock = jest.fn();
const videoUpdateMock = jest.fn();
const videoStatusEventCreateMock = jest.fn();
const activityEventCreateMock = jest.fn();
// $transaction now has two call shapes to support in this file: the
// array form (still used by updateVideoStatus() on the FAILED path, see
// video-status.ts) and the new interactive callback form the render-clip
// worker itself uses for its final clip-update + conditional
// video-RENDERED transaction. The callback form's `tx` exposes the exact
// same mocks as `prisma` itself, so assertions don't need to know or care
// which one the real code went through.
const transactionMock = jest.fn((arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => {
  if (typeof arg === 'function') {
    return arg({
      clip: {
        update: (...a: unknown[]) => clipUpdateMock(...a),
        findMany: (...a: unknown[]) => clipFindManyMock(...a),
      },
      video: { update: (...a: unknown[]) => videoUpdateMock(...a) },
      videoStatusEvent: { create: (...a: unknown[]) => videoStatusEventCreateMock(...a) },
    });
  }
  return Promise.all(arg);
});
jest.mock('../prisma', () => ({
  prisma: {
    clip: {
      update: (...args: unknown[]) => clipUpdateMock(...args),
      findMany: (...args: unknown[]) => clipFindManyMock(...args),
      findUnique: (...args: unknown[]) => clipFindUniqueMock(...args),
    },
    video: { update: (...args: unknown[]) => videoUpdateMock(...args) },
    // Fase 3 (DB+JSON-contract roadmap) - updateVideoStatus() writes here
    // too, atomically alongside video.update() via $transaction.
    videoStatusEvent: { create: (...args: unknown[]) => videoStatusEventCreateMock(...args) },
    // Sprint 1-2 (Dashboard Redesign) - recordActivityEvent()'s write for
    // the CLIP_GENERATED event, called against the plain `prisma` import
    // (not `tx`), same as videoStatusEvent above.
    activityEvent: { create: (...args: unknown[]) => activityEventCreateMock(...args) },
    $transaction: (...args: [Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)]) =>
      transactionMock(...args),
  },
}));

import { cameraMotionDeps } from '../cameraMotionDeps';
import { faceLandmarksDeps } from '../faceLandmarksDeps';
import { facialIntelligenceDeps } from '../facialIntelligenceDeps';
import { gestureIntelligenceDeps } from '../gestureIntelligenceDeps';
import { objectIntelligenceDeps } from '../objectIntelligenceDeps';
import { ocrIntelligenceDeps } from '../ocrIntelligenceDeps';
import { sceneIntelligenceDeps } from '../sceneIntelligenceDeps';
import { createRenderClipWorker } from './render-clip.worker';

interface RenderClipJobData {
  clipId: string;
  videoId: string;
  sourceUrl: string;
  startTime: number;
  endTime: number;
  transcript: TranscriptSegment[];
  captionStyle: CaptionStyle;
  keywords: string[];
  scores: ClipScores | null;
}

// Real deriveAudioFeatures()/deriveFacialEmotionFeatures() output for the
// "nothing available" case - baseJobData's transcript never carries
// rmsDb/peakDb/speakingRateWordsPerSecond, and most tests here don't set up
// any classified facial emotion samples either.
const noAudioFeatures = {
  averageRmsDb: null,
  peakDb: null,
  averageSpeakingRateWordsPerSecond: null,
  speakingRateStdDev: null,
};
const noMotionEnergyFeatures = {
  averageMotionEnergy: null,
  peakMotionEnergy: null,
  staticRatio: null,
  dynamicRatio: null,
  peakCount: null,
  peakTimestamps: null,
  peakRatePerMinute: null,
  motionVariability: null,
};
const noCameraMotionFeatures = {
  panScore: null,
  tiltScore: null,
  zoomScore: null,
  shakeScore: null,
  dominantMotionType: null,
  dominantDirection: null,
  motionTypeDiversity: null,
  smoothnessScore: null,
};
// deriveEditingRhythmFeatures is left real (not mocked) in this spec file,
// same "pure function, no subprocess" precedent as deriveSceneFeatures/
// deriveMotionEnergyFeatures/deriveCameraMotionFeatures - this is its
// actual computed output for baseJobData's default scenario (10s clip
// duration, zero cuts, zero motion samples, no audio rmsDb data):
// cutsPerMinute=0 (a real 0, not null, since duration > 0) is the only
// non-null tempo component -> tempoScore=0; fewer than two cuts -> pacing/
// acceleration stay null.
const defaultEditingRhythmFeatures = {
  tempoScore: 0,
  pacingScore: null,
  accelerationScore: null,
};
const noFacialFeatures = {
  dominantEmotion: null,
  emotionTransitions: 0,
  peakConfidence: null,
  stability: null,
};
const noGestureFeatures = {
  dominantGesture: null,
  gestureTransitions: 0,
  peakConfidence: null,
  stability: null,
};
const noFaceLandmarkFeatures = {
  blinkRate: null,
  averageSmile: null,
  averageMouthOpen: null,
  averageAbsoluteYaw: null,
  averageAbsolutePitch: null,
  positionScore: null,
  sizeScore: null,
  visibilityScore: null,
  eyeContactRate: null,
  dominantLookingDirection: null,
  averageSharpness: null,
  averageBrightness: null,
  occlusionRate: null,
  speakerChangeCount: null,
  dominantSpeakerConsistency: null,
  speakerAudioSyncRate: null,
  averageLipVelocity: null,
  speakingIntensity: null,
  pauseCount: null,
  articulationRate: null,
  averageMouthWidth: null,
  averageCheekRaise: null,
  averageEyeSquint: null,
  genuineSmileRate: null,
  blinkFrequencyPerMinute: null,
  prolongedClosureCount: null,
  gazeStabilityScore: null,
  averageBrowActivity: null,
  averageHeadMovementRate: null,
  dominantAffect: null,
  affectConfidence: null,
};
const noTrackingQualityMetrics = {
  trackFragmentationRate: null,
  idSwitchCount: null,
  lostTrackDurationSeconds: null,
  reidentificationSuccessRate: null,
  faceVisibilityRatio: null,
  faceOcclusionRatio: null,
  averageLandmarkConfidence: null,
  landmarkJitterScore: null,
  kalmanCorrectionRatio: null,
  trackingConfidence: null,
  tracks: [],
};
// OCR-2's deriveOcrFeatures([], 0) output (mock's default ocrText: []
// means zero samples, not zero-text-but-samples-taken) - all null.
const noOcrFeatures = {
  subtitleCoverageRate: null,
  slidePresenceRate: null,
  captionRate: null,
  logoPresenceRate: null,
  priceMentionRate: null,
  nameMentionRate: null,
  dominantTextCategory: null,
  averageTextBlockCount: null,
};
// Object Intelligence roadmap, Batch OI-1 - deriveObjectFeatures()'s
// all-null return for totalSamples === 0 (the default detectObjectsMock
// resolves an empty array, same "analysis ran, found nothing" case as
// noOcrFeatures above, but object features go all-null at zero samples
// rather than real zeroes - see deriveObjectFeatures's own comment).
const noObjectFeatures = {
  objectCount: null,
  dominantObject: null,
  averageObjectsPerFrame: null,
  averageTrackingConfidence: null,
  averagePersistence: null,
  averageMotionSpeed: null,
  averageOcclusionScore: null,
  averageInteractionConfidence: null,
  averageAttentionScore: null,
  averageAttentionConfidence: null,
};
// Composition Intelligence roadmap, Batch RB-1/RB-2 -
// deriveCompositionFeatures()'s all-null return for zero primary-subject
// samples - every test in this file leaves faceLandmarks/objects empty or
// null, so selectPrimarySubject always has an empty sample-timestamp grid
// to work with, same "analysis found nothing" case as noObjectFeatures
// above.
const noCompositionFeatures = {
  ruleOfThirdsScore: null,
  headroomScore: null,
  leadRoomScore: null,
  centeringScore: null,
  subjectLossRatio: null,
  compositionStability: null,
  framingConsistency: null,
};
// Real computeHighlightScore() (v2, Fase 31) output for a clip with zero
// scene cuts (the baseline scene score, 0.2 normalized) and no audio/
// facial/gesture signal - most tests here don't set up cuts/audio/facial/
// gesture data. editingRhythm's tempoScore (0, from zero cuts/motion/
// speaking-rate) also contributes at its own weight - unlike before the
// scene 0.30->0.25 / editingRhythm 0->0.05 weight-calibration change
// (see weights.ts's own comment), editingRhythm now actually moves the
// score (its weighted contribution here happens to be 0 only because
// tempoScore's own normalized value is 0, not because its weight is 0).
const baselineHighlight = {
  highlightScore: 17,
  highlightConfidence: 0.3,
  highlightBreakdown: [
    {
      signal: 'scene',
      feature: 'cutsPerMinute',
      rawValue: 0,
      normalizedValue: 0.2,
      weight: 0.25,
      weightedContribution: 0.05,
    },
    {
      signal: 'editingRhythm',
      feature: 'tempoScore',
      rawValue: 0,
      normalizedValue: 0,
      weight: 0.05,
      weightedContribution: 0,
    },
  ],
  highlightExplainability: {
    topFactors: [
      {
        signal: 'scene',
        feature: 'cutsPerMinute',
        weightedContribution: 0.05,
        description: 'low visual dynamism (0.0 cuts/min)',
      },
      {
        signal: 'editingRhythm',
        feature: 'tempoScore',
        weightedContribution: 0,
        description: 'low overall editing tempo',
      },
    ],
  },
  highlightReason: 'Low visual dynamism (0.0 cuts/min); low overall editing tempo.',
  highlightPrediction: {
    bucket: 'uncertain',
    rationale:
      'Score is 17 but confidence is low (30%) - too few signals were available to trust this prediction.',
  },
  highlightRecommendation: {
    action: 'review_manually',
    message: 'Signals are mixed or incomplete - review this clip manually before publishing.',
  },
};

// Fase 32 - all nine ClipScores dimensions set uniformly so the wiring
// test below only needs to prove job.data.scores flows through to the
// llm signal correctly, not re-derive per-dimension math already covered
// by @speedora/fusion-engine's own "llm signal" tests.
const FULL_LLM_SCORES: ClipScores = {
  hookStrength: 80,
  educationalValue: 80,
  practicalValue: 80,
  curiosity: 80,
  emotion: 80,
  storytelling: 80,
  novelty: 80,
  trustAuthority: 80,
  ctaStrength: 80,
};

function getProcessor() {
  createRenderClipWorker();
  return (Worker as unknown as jest.Mock).mock.calls[0][1] as (job: {
    data: RenderClipJobData;
  }) => Promise<unknown>;
}

const baseJobData: RenderClipJobData = {
  clipId: 'clip-1',
  videoId: 'video-1',
  sourceUrl: 'videos/abc.mp4',
  startTime: 10,
  endTime: 20,
  transcript: [{ start: 10, end: 12, text: 'hi' }],
  captionStyle: CaptionStyle.DEFAULT,
  keywords: [],
  scores: null,
};

describe('render-clip worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    scratchCounter = 0;
    getObjectStreamMock.mockResolvedValue({ fake: 'readable' });
    pipelineMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    renderClipMock.mockResolvedValue(undefined);
    trimCutRangesMock.mockResolvedValue(undefined);
    // Fails by default (not "succeeds with nothing") so the many existing
    // exact-literal clipUpdateMock assertions below don't all need a
    // thumbnailUrl key added - same "opt in to exercise the success path"
    // convention as findBRollMomentsMock/detectFacesMock above. Dedicated
    // tests further down override this to exercise both outcomes.
    extractThumbnailMock.mockRejectedValue(new Error('not configured for this test'));
    uploadObjectMock.mockResolvedValue(undefined);
    clipUpdateMock.mockResolvedValue({});
    // Clip exists and isn't rendered yet by default - individual tests
    // override this to exercise the orphaned-job (deleted-clip) and
    // already-rendered (idempotency) skip paths. video.ownerId (Sprint 1-2,
    // Dashboard Redesign) feeds the CLIP_GENERATED activity event.
    clipFindUniqueMock.mockResolvedValue({ outputUrl: null, video: { ownerId: 'user-1' } });
    videoUpdateMock.mockResolvedValue({});
    videoStatusEventCreateMock.mockResolvedValue({});
    activityEventCreateMock.mockResolvedValue({});
    // Sprint 1-2 (Dashboard Redesign) - Clip.outputSizeBytes.
    statMock.mockResolvedValue({ size: 654321 });
    cleanupTempFileMock.mockResolvedValue(undefined);
    getVideoDimensionsMock.mockResolvedValue({ width: 320, height: 240 });
    computeCropDimensionsMock.mockReturnValue({ width: 136, height: 240 });
    detectFacesMock.mockResolvedValue([{ t: 0, box: null }]);
    detectSceneCutsMock.mockResolvedValue({ cuts: [] });
    classifySceneCutTypesMock.mockResolvedValue({ events: [] });
    analyzeMotionEnergyMock.mockResolvedValue({ samples: [] });
    detectCameraMotionMock.mockResolvedValue([]);
    detectFacialEmotionMock.mockResolvedValue([]);
    detectFaceLandmarksMock.mockResolvedValue([]);
    detectGesturesMock.mockResolvedValue([]);
    detectOcrTextMock.mockResolvedValue([]);
    detectObjectsMock.mockResolvedValue([]);
    findEmphasisWordsMock.mockReturnValue([]);
    buildCropPathMock.mockReturnValue(null); // no face/emphasis -> static center-crop by default
    buildSendCmdScriptMock.mockReturnValue('0 crop@reframe x 10, crop@reframe y 0;');
    buildAssMock.mockReturnValue('');
    // No B-roll moments by default - individual tests override this to
    // exercise the B-roll-succeeds path.
    findBRollMomentsMock.mockReturnValue([]);
    searchAssetsMock.mockResolvedValue(null);
    downloadStockAssetMock.mockResolvedValue(undefined);
    trimAndFadeInBRollMock.mockResolvedValue(undefined);
    fadeOutBRollMock.mockResolvedValue(undefined);
  });

  it('downloads the source, renders with captions, uploads the result, and marks the video RENDERED once all clips are done', async () => {
    buildAssMock.mockReturnValue(
      '[Script Info]\n...\nDialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,hi',
    );
    clipFindManyMock.mockResolvedValue([
      { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      { id: 'clip-2', outputUrl: 'renders/clip-2.mp4', highlightScore: null },
    ]);

    const processor = getProcessor();
    const result = await processor({ data: baseJobData });

    expect(reserveScratchPathMock).toHaveBeenCalledWith('source', '.mp4');
    expect(reserveScratchPathMock).toHaveBeenCalledWith('captions', '.ass');
    expect(reserveScratchPathMock).toHaveBeenCalledWith('output', '.mp4');
    expect(getObjectStreamMock).toHaveBeenCalledWith('videos/abc.mp4');
    expect(pipelineMock).toHaveBeenCalled();
    expect(buildAssMock).toHaveBeenCalledWith({
      segments: baseJobData.transcript,
      clipStart: 10,
      clipEnd: 20,
      style: CaptionStyle.DEFAULT,
      videoWidth: 136,
      videoHeight: 240,
    });
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining('captions'),
      expect.stringContaining('Dialogue:'),
    );
    expect(renderClipMock).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: 10, endTime: 20 }),
    );
    expect(uploadObjectMock).toHaveBeenCalledWith(
      'renders/clip-1.mp4',
      { fakeStream: expect.stringContaining('output') },
      'video/mp4',
    );
    expect(statMock).toHaveBeenCalledWith(expect.stringContaining('output'));
    expect(clipUpdateMock).toHaveBeenCalledWith({
      where: { id: 'clip-1', outputUrl: null },
      data: {
        outputUrl: 'renders/clip-1.mp4',
        outputSizeBytes: 654321,
        storyboardFrameUrls: [],
        sceneCuts: [],
        sceneCutEvents: [],
        facialEmotions: [],
        gestures: [],
        audioFeatures: noAudioFeatures,
        sceneFeatures: {
          cutCount: 0,
          cutsPerMinute: 0,
          averageSegmentSeconds: 10,
          hardCutCount: 0,
          fadeCount: 0,
          dissolveCount: 0,
        },
        motionEnergy: [],
        motionEnergyFeatures: noMotionEnergyFeatures,
        cameraMotion: [],
        cameraMotionFeatures: noCameraMotionFeatures,
        editingRhythmFeatures: defaultEditingRhythmFeatures,
        facialFeatures: noFacialFeatures,
        gestureFeatures: noGestureFeatures,
        faceLandmarks: [],
        faceLandmarkFeatures: noFaceLandmarkFeatures,
        trackingQualityMetrics: noTrackingQualityMetrics,
        activeSpeakerSamples: [],
        speakerFaceAssociations: [],
        lipSyncVerifications: [],
        speakerTimeline: Prisma.JsonNull,
        speakerTimelineFeatures: Prisma.JsonNull,
        speakerConfidenceScores: Prisma.JsonNull,
        speakerEngagementScores: Prisma.JsonNull,
        speakerImportanceScores: Prisma.JsonNull,
        speakerHighlightMoments: Prisma.JsonNull,
        ocrText: [],
        ocrTracks: [],
        ocrFeatures: noOcrFeatures,
        objects: [],
        objectTracks: [],
        objectFeatures: noObjectFeatures,
        compositionFeatures: noCompositionFeatures,
        llmFeatures: Prisma.JsonNull,
        ...baselineHighlight,
      },
    });
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.RENDERED },
    });
    // Sprint 1-2 (Dashboard Redesign) - Activity Timeline entry.
    expect(activityEventCreateMock).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'CLIP_GENERATED',
        videoId: 'video-1',
        clipId: 'clip-1',
        metadata: undefined,
      },
    });
    // source + captions + output + thumbnail + 5 storyboard frames (reserved
    // even though this default beforeEach makes extraction fail) - no
    // reframe-cmds file (no face detected).
    expect(cleanupTempFileMock).toHaveBeenCalledTimes(9);
    expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
  });

  it('skips an orphaned job for a clip that was deleted while queued, without doing any work', async () => {
    clipFindUniqueMock.mockResolvedValue(null);

    const processor = getProcessor();
    const result = await processor({ data: baseJobData });

    expect(result).toEqual({ clipId: 'clip-1', outputUrl: '' });
    // No source download, no rendering, no writes - the job is a pure no-op
    // once the clip (or its parent video, cascade-deleting it) is gone.
    expect(getObjectStreamMock).not.toHaveBeenCalled();
    expect(renderClipMock).not.toHaveBeenCalled();
    expect(uploadObjectMock).not.toHaveBeenCalled();
    expect(clipUpdateMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalled();
  });

  it('skips a job for a clip already rendered, without a duplicate FFmpeg pass (concurrent-reprocessing guard)', async () => {
    clipFindUniqueMock.mockResolvedValue({ outputUrl: 'renders/clip-1.mp4' });

    const processor = getProcessor();
    const result = await processor({ data: baseJobData });

    expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    expect(getObjectStreamMock).not.toHaveBeenCalled();
    expect(renderClipMock).not.toHaveBeenCalled();
    expect(uploadObjectMock).not.toHaveBeenCalled();
    expect(clipUpdateMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalled();
  });

  it('treats a P2025 (no row matched outputUrl: null) on the final clip update as a benign concurrent-execution race, not a job failure', async () => {
    clipFindManyMock.mockResolvedValue([
      { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
    ]);
    // Simulates a second execution of this same job (e.g. BullMQ stalled-job
    // recovery) losing the optimistic-concurrency race - the clip's
    // outputUrl was already set by the other, still-in-flight/finished
    // execution by the time this one's update runs, so the where clause's
    // outputUrl: null matches zero rows.
    clipUpdateMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('No record found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      }),
    );

    const processor = getProcessor();
    const result = await processor({ data: baseJobData });

    expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    // No video-status transition from this losing execution - the winning
    // execution (whose update actually matched) owns that decision instead.
    expect(videoUpdateMock).not.toHaveBeenCalled();
    expect(videoStatusEventCreateMock).not.toHaveBeenCalled();
    // Not reported as a failure - this is an expected, benign race outcome,
    // not an error.
    expect(captureExceptionMock).not.toHaveBeenCalled();
    // The losing execution returns before reaching the activity-event write
    // - only the winning execution (whose update actually matched) records
    // CLIP_GENERATED.
    expect(activityEventCreateMock).not.toHaveBeenCalled();
  });

  // computeFileMd5Hex streams renderedPath through node:crypto's real
  // createHash('md5') via the mocked pipeline() above - since pipelineMock
  // never actually feeds any bytes through it (it's a jest.fn() that just
  // resolves), the resulting digest is deterministically the MD5 of empty
  // input in every test: d41d8cd98f00b204e9800998ecf8427e.
  const EMPTY_MD5 = 'd41d8cd98f00b204e9800998ecf8427e';

  it('does not fail the job when the upload ETag matches the local checksum', async () => {
    clipFindManyMock.mockResolvedValue([
      { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
    ]);
    uploadObjectMock.mockResolvedValue(`"${EMPTY_MD5}"`);

    const processor = getProcessor();
    const result = await processor({ data: baseJobData });

    expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('fails the job without marking the clip rendered when the upload ETag does not match the local checksum', async () => {
    uploadObjectMock.mockResolvedValue('"deadbeefdeadbeefdeadbeefdeadbeef"');

    const processor = getProcessor();

    await expect(processor({ data: baseJobData })).rejects.toThrow(
      /failed checksum verification/,
    );

    // The corrupted upload must never be reflected in the clip/video state -
    // this is a hard failure, not a benign race like the P2025 case above.
    expect(clipUpdateMock).not.toHaveBeenCalled();
    expect(videoUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: VideoStatus.RENDERED }) }),
    );
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it('skips checksum verification without failing the job when the upload returns no ETag', async () => {
    clipFindManyMock.mockResolvedValue([
      { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
    ]);
    uploadObjectMock.mockResolvedValue(undefined);

    const processor = getProcessor();
    const result = await processor({ data: baseJobData });

    expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
  });

  it("passes the job's captionStyle through to buildAss", async () => {
    clipFindManyMock.mockResolvedValue([
      { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
    ]);

    const processor = getProcessor();
    await processor({ data: { ...baseJobData, captionStyle: CaptionStyle.KARAOKE } });

    expect(buildAssMock).toHaveBeenCalledWith(
      expect.objectContaining({ style: CaptionStyle.KARAOKE }),
    );
  });

  it('does not mark the video RENDERED when sibling clips are still pending', async () => {
    clipFindManyMock.mockResolvedValue([
      { id: 'clip-1', outputUrl: 'renders/clip-1.mp4' },
      { id: 'clip-2', outputUrl: null },
    ]);

    const processor = getProcessor();
    await processor({ data: baseJobData });

    expect(videoUpdateMock).not.toHaveBeenCalled();
  });

  it('skips writing a subtitle file when there is no overlapping transcript text', async () => {
    clipFindManyMock.mockResolvedValue([
      { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
    ]);

    const processor = getProcessor();
    await processor({ data: baseJobData });

    expect(reserveScratchPathMock).not.toHaveBeenCalledWith('captions', '.ass');
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(renderClipMock).toHaveBeenCalledWith(expect.objectContaining({ subtitlesPath: null }));
    // source + output + thumbnail + 5 storyboard frames, no captions, no reframe-cmds.
    expect(cleanupTempFileMock).toHaveBeenCalledTimes(8);
  });

  describe('silence/filler cut pass (Fase 8 follow-up)', () => {
    it('skips the trim pass entirely when the clip has no long pauses or filler words', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);

      const processor = getProcessor();
      await processor({
        data: {
          ...baseJobData,
          // Words run edge-to-edge and end right at the clip's own boundary
          // (endTime=10.6) - no gap between them and no trailing silence
          // either, so there's genuinely nothing to cut.
          startTime: 10,
          endTime: 10.6,
          transcript: [
            {
              start: 10,
              end: 10.6,
              text: 'hi there',
              words: [
                { word: 'hi', start: 10, end: 10.3 },
                { word: 'there', start: 10.3, end: 10.6 },
              ],
            },
          ],
        },
      });

      expect(trimCutRangesMock).not.toHaveBeenCalled();
      expect(uploadObjectMock).toHaveBeenCalledWith(
        'renders/clip-1.mp4',
        { fakeStream: expect.stringContaining('output') },
        'video/mp4',
      );
      // No extra "trimmed" scratch file reserved/cleaned up.
      expect(reserveScratchPathMock).not.toHaveBeenCalledWith('trimmed', '.mp4');
    });

    it('runs a second trim pass and uploads its output when the clip has a long silence gap', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);

      const processor = getProcessor();
      await processor({
        data: {
          ...baseJobData,
          startTime: 10,
          endTime: 20,
          transcript: [
            {
              start: 10,
              end: 20,
              text: 'hi there',
              // Clip-relative (startTime=10): "hi" ends at 0.3s, "there"
              // starts at 9.5s (near the clip's own 10s end, so there's no
              // separate trailing-silence cut to also account for) - an
              // isolated 9.2s gap, well over the 0.7s silence threshold.
              words: [
                { word: 'hi', start: 10, end: 10.3 },
                { word: 'there', start: 19.5, end: 19.8 },
              ],
            },
          ],
        },
      });

      expect(trimCutRangesMock).toHaveBeenCalledTimes(1);
      const [inputArg, outputArg, cuts] = trimCutRangesMock.mock.calls[0];
      expect(inputArg).toContain('output');
      expect(outputArg).toContain('trimmed');
      expect(cuts).toEqual([{ start: 0.45, end: 9.35 }]);
      expect(uploadObjectMock).toHaveBeenCalledWith(
        'renders/clip-1.mp4',
        { fakeStream: expect.stringContaining('trimmed') },
        'video/mp4',
      );
      expect(cleanupTempFileMock).toHaveBeenCalledWith(expect.stringContaining('trimmed'));
    });

    it('cuts an um/uh-family filler word out of the clip', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);

      const processor = getProcessor();
      await processor({
        data: {
          ...baseJobData,
          // Short clip whose words run edge-to-edge with no gaps and end
          // right at the clip's own boundary (endTime=10.95) - isolates
          // this test to only the filler-word cut, with no incidental
          // silence-gap cut (between words or trailing) also firing.
          startTime: 10,
          endTime: 10.95,
          transcript: [
            {
              start: 10,
              end: 10.95,
              text: 'um hi there',
              words: [
                { word: 'um', start: 10, end: 10.3 },
                { word: 'hi', start: 10.3, end: 10.6 },
                { word: 'there', start: 10.6, end: 10.9 },
              ],
            },
          ],
        },
      });

      expect(trimCutRangesMock).toHaveBeenCalledTimes(1);
      const [, , cuts] = trimCutRangesMock.mock.calls[0];
      expect(cuts).toEqual([{ start: 0, end: 0.3 }]);
    });
  });

  describe('thumbnail extraction (Product Experience roadmap)', () => {
    it('extracts a frame from the midpoint of the RENDERED output, uploads it, and records the key', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      extractThumbnailMock.mockResolvedValue(undefined);
      extractBlurPlaceholderMock.mockRejectedValue(new Error('not the focus of this test'));

      const processor = getProcessor();
      await processor({ data: baseJobData });

      // baseJobData is startTime: 10, endTime: 20 - midpoint of the clip's
      // own duration is 5s into the rendered (already-trimmed-to-clip-length)
      // output, not an absolute source-video timestamp.
      expect(extractThumbnailMock).toHaveBeenCalledWith(
        expect.stringContaining('output'),
        expect.stringContaining('thumbnail'),
        5,
      );
      expect(uploadObjectMock).toHaveBeenCalledWith(
        'thumbnails/clip-1.webp',
        { fakeStream: expect.stringContaining('thumbnail') },
        'image/webp',
      );
      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ thumbnailUrl: 'thumbnails/clip-1.webp' }),
        }),
      );
      expect(cleanupTempFileMock).toHaveBeenCalledWith(expect.stringContaining('thumbnail'));
    });

    it('keeps rendering successfully and omits thumbnailUrl when extraction fails', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      extractThumbnailMock.mockRejectedValue(new Error('ffmpeg exited with code 1'));

      const processor = getProcessor();
      const result = await processor({ data: baseJobData });

      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
      expect(uploadObjectMock).not.toHaveBeenCalledWith(
        expect.stringContaining('thumbnails/'),
        expect.anything(),
        'image/webp',
      );
      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ thumbnailUrl: expect.anything() }),
        }),
      );
    });

    it('also extracts a blur placeholder from the rendered output and inlines it as a data URL', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      extractThumbnailMock.mockResolvedValue(undefined);
      extractBlurPlaceholderMock.mockResolvedValue(undefined);
      readFileMock.mockResolvedValue(Buffer.from('tiny-webp-bytes'));

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(extractBlurPlaceholderMock).toHaveBeenCalledWith(
        expect.stringContaining('output'),
        expect.stringContaining('thumbnail-blur'),
        5,
      );
      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            thumbnailBlurDataUrl: `data:image/webp;base64,${Buffer.from('tiny-webp-bytes').toString('base64')}`,
          }),
        }),
      );
      expect(cleanupTempFileMock).toHaveBeenCalledWith(expect.stringContaining('thumbnail-blur'));
    });

    it('keeps the real thumbnail even when only the blur placeholder extraction fails', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      extractThumbnailMock.mockResolvedValue(undefined);
      extractBlurPlaceholderMock.mockRejectedValue(new Error('ffmpeg exited with code 1'));

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ thumbnailUrl: 'thumbnails/clip-1.webp' }),
        }),
      );
      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ thumbnailBlurDataUrl: expect.anything() }),
        }),
      );
    });
  });

  describe('storyboard extraction (Phase 3, Hover Preview/Storyboard roadmap)', () => {
    it('extracts 5 evenly-spaced frames from the RENDERED output and records the keys that succeeded', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      extractThumbnailMock.mockResolvedValue(undefined);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      // baseJobData is startTime: 10, endTime: 20 - a 10s clip, so fractions
      // [0.1, 0.3, 0.5, 0.7, 0.9] land at [1, 3, 5, 7, 9]s into the rendered
      // (already-trimmed-to-clip-length) output.
      expect(extractThumbnailMock).toHaveBeenCalledWith(
        expect.stringContaining('output'),
        expect.stringContaining('storyboard-0'),
        1,
      );
      expect(extractThumbnailMock).toHaveBeenCalledWith(
        expect.stringContaining('output'),
        expect.stringContaining('storyboard-4'),
        9,
      );
      expect(uploadObjectMock).toHaveBeenCalledWith(
        'storyboards/clip-1-0.webp',
        expect.objectContaining({ fakeStream: expect.stringContaining('storyboard-0') }),
        'image/webp',
      );
      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            storyboardFrameUrls: [
              'storyboards/clip-1-0.webp',
              'storyboards/clip-1-1.webp',
              'storyboards/clip-1-2.webp',
              'storyboards/clip-1-3.webp',
              'storyboards/clip-1-4.webp',
            ],
          }),
        }),
      );
    });

    it('records only the frames that succeeded when some extractions fail, never fabricating a fixed count', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      extractThumbnailMock.mockImplementation(async (input, output) => {
        if (typeof output === 'string' && output.includes('storyboard-1')) {
          throw new Error('ffmpeg exited with code 1');
        }
      });

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            storyboardFrameUrls: [
              'storyboards/clip-1-0.webp',
              'storyboards/clip-1-2.webp',
              'storyboards/clip-1-3.webp',
              'storyboards/clip-1-4.webp',
            ],
          }),
        }),
      );
    });
  });

  describe('smart reframe', () => {
    it('falls back to a static center-crop when no face is detected anywhere in the clip', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      buildCropPathMock.mockReturnValue(null);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(getVideoDimensionsMock).toHaveBeenCalledWith(expect.stringContaining('source'));
      expect(detectFacesMock).toHaveBeenCalledWith(
        { sourcePath: expect.stringContaining('source'), startTime: 10, endTime: 20 },
        expect.objectContaining({ pythonPath: expect.any(String) }),
      );
      expect(renderClipMock).toHaveBeenCalledWith(
        expect.objectContaining({
          reframe: {
            outputWidth: 136,
            outputHeight: 240,
            width: 136,
            height: 240,
            x: Math.round((320 - 136) / 2),
            y: Math.round((240 - 240) / 2),
            sendCmdPath: null,
          },
        }),
      );
      // No reframe-cmds scratch file created for a static crop.
      expect(reserveScratchPathMock).not.toHaveBeenCalledWith('reframe-cmds', '.txt');
    });

    it('writes a sendcmd file and passes a moving reframe plan when a face is detected', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      const cropPath = [
        { t: 0, x: 10, y: 0, width: 136, height: 240 },
        { t: 0.2, x: 20, y: 0, width: 136, height: 240 },
      ];
      buildCropPathMock.mockReturnValue(cropPath);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(reserveScratchPathMock).toHaveBeenCalledWith('reframe-cmds', '.txt');
      expect(buildSendCmdScriptMock).toHaveBeenCalledWith(cropPath, 'crop@reframe');
      expect(writeFileMock).toHaveBeenCalledWith(
        expect.stringContaining('reframe-cmds'),
        '0 crop@reframe x 10, crop@reframe y 0;',
      );
      expect(renderClipMock).toHaveBeenCalledWith(
        expect.objectContaining({
          reframe: expect.objectContaining({
            outputWidth: 136,
            outputHeight: 240,
            width: 136,
            height: 240,
            x: 10,
            y: 0,
            sendCmdPath: expect.stringContaining('reframe-cmds'),
          }),
        }),
      );
      // source + output + reframe-cmds + thumbnail + 5 storyboard frames (no captions this time).
      expect(cleanupTempFileMock).toHaveBeenCalledTimes(9);
    });

    it('falls back to a static center-crop without failing the job when face detection itself throws', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectFacesMock.mockRejectedValue(new Error('python3 not found'));

      const processor = getProcessor();
      const result = await processor({ data: baseJobData });

      expect(renderClipMock).toHaveBeenCalledWith(
        expect.objectContaining({ reframe: expect.objectContaining({ sendCmdPath: null }) }),
      );
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    });
  });

  describe('Auto B-roll (Fase 15/16)', () => {
    const sunsetAsset = {
      id: 'pexels-123',
      url: 'https://example.com/sunset.mp4',
      thumbnail: 'https://example.com/sunset-thumb.jpg',
      sourceName: 'pexels',
      resolution: { width: 640, height: 1136 },
      type: 'video',
    };

    it('searches (via StockAssetService), downloads, and prepares a cutaway for each found moment, passing them to renderClip', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      findBRollMomentsMock.mockReturnValue([{ keyword: 'sunset', t: 2 }]);
      searchAssetsMock.mockResolvedValue(sunsetAsset);

      const processor = getProcessor();
      await processor({ data: { ...baseJobData, keywords: ['sunset'] } });

      expect(searchAssetsMock).toHaveBeenCalledWith('sunset');
      expect(downloadStockAssetMock).toHaveBeenCalledWith(
        'https://example.com/sunset.mp4',
        expect.stringContaining('broll-raw'),
      );
      expect(trimAndFadeInBRollMock).toHaveBeenCalledWith(
        expect.stringContaining('broll-raw'),
        expect.stringContaining('broll-fadein'),
        136,
        240,
        2.5,
        0.3,
        'video',
      );
      expect(fadeOutBRollMock).toHaveBeenCalledWith(
        expect.stringContaining('broll-fadein'),
        expect.stringContaining('broll-final'),
        2.5,
        0.3,
      );
      expect(renderClipMock).toHaveBeenCalledWith(
        expect.objectContaining({
          broll: [
            {
              filePath: expect.stringContaining('broll-final'),
              startTime: 2,
              endTime: 4.5,
            },
          ],
        }),
      );
      // The raw download + fade-in intermediate are cleaned up right away;
      // the final overlay file is only cleaned up after renderClip uses it
      // (source + output + the final broll file = 3).
      expect(cleanupTempFileMock).toHaveBeenCalledWith(expect.stringContaining('broll-raw'));
      expect(cleanupTempFileMock).toHaveBeenCalledWith(expect.stringContaining('broll-fadein'));
      expect(cleanupTempFileMock).toHaveBeenCalledWith(expect.stringContaining('broll-final'));
    });

    it('reserves a .jpg scratch path and passes assetType "image" for an Unsplash photo asset', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      findBRollMomentsMock.mockReturnValue([{ keyword: 'sunset', t: 2 }]);
      searchAssetsMock.mockResolvedValue({ ...sunsetAsset, sourceName: 'unsplash', type: 'image' });

      const processor = getProcessor();
      await processor({ data: { ...baseJobData, keywords: ['sunset'] } });

      expect(reserveScratchPathMock).toHaveBeenCalledWith('broll-raw', '.jpg');
      expect(trimAndFadeInBRollMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        136,
        240,
        2.5,
        0.3,
        'image',
      );
    });

    it('passes an empty broll array to renderClip when no provider has matching stock footage', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      findBRollMomentsMock.mockReturnValue([{ keyword: 'sunset', t: 2 }]);
      searchAssetsMock.mockResolvedValue(null);

      const processor = getProcessor();
      await processor({ data: { ...baseJobData, keywords: ['sunset'] } });

      expect(downloadStockAssetMock).not.toHaveBeenCalled();
      expect(renderClipMock).toHaveBeenCalledWith(expect.objectContaining({ broll: [] }));
    });

    it('skips just the failing moment (does not fail the job) when downloading a cutaway throws', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      findBRollMomentsMock.mockReturnValue([{ keyword: 'sunset', t: 2 }]);
      searchAssetsMock.mockResolvedValue(sunsetAsset);
      downloadStockAssetMock.mockRejectedValue(new Error('network error'));

      const processor = getProcessor();
      const result = await processor({ data: { ...baseJobData, keywords: ['sunset'] } });

      expect(renderClipMock).toHaveBeenCalledWith(expect.objectContaining({ broll: [] }));
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    });
  });

  describe('Scene Intelligence (Fase 26)', () => {
    it('calls detectSceneCuts with the source path and clip time range, persisting the resulting cuts', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectSceneCutsMock.mockResolvedValue({ cuts: [1.5, 4.2] });

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(detectSceneCutsMock).toHaveBeenCalledWith(
        { videoPath: expect.stringContaining('source'), startTime: 10, endTime: 20 },
        sceneIntelligenceDeps,
      );
      expect(clipUpdateMock).toHaveBeenCalledWith({
        where: { id: 'clip-1', outputUrl: null },
        data: {
          outputUrl: 'renders/clip-1.mp4',
          outputSizeBytes: 654321,
          storyboardFrameUrls: [],
          sceneCuts: [1.5, 4.2],
          sceneCutEvents: [],
          facialEmotions: [],
          gestures: [],
          audioFeatures: noAudioFeatures,
          sceneFeatures: {
            cutCount: 2,
            cutsPerMinute: 12,
            averageSegmentSeconds: 10 / 3,
            hardCutCount: 2,
            fadeCount: 0,
            dissolveCount: 0,
          },
          motionEnergy: [],
          motionEnergyFeatures: noMotionEnergyFeatures,
          cameraMotion: [],
          cameraMotionFeatures: noCameraMotionFeatures,
          // cuts=[1.5, 4.2] on a 10s clip: cutsPerMinute=12 is the only
          // tempo component (0.6); both cuts fall before the 5s midpoint
          // (accelerationScore=-1, fully first-half-concentrated); pacing
          // computed for real from the two cuts' actual segment lengths.
          editingRhythmFeatures: {
            tempoScore: 0.6,
            pacingScore: 0.6478752062616411,
            accelerationScore: -1,
          },
          facialFeatures: noFacialFeatures,
          gestureFeatures: noGestureFeatures,
          faceLandmarks: [],
          faceLandmarkFeatures: noFaceLandmarkFeatures,
          trackingQualityMetrics: noTrackingQualityMetrics,
          activeSpeakerSamples: [],
          speakerFaceAssociations: [],
          lipSyncVerifications: [],
          speakerTimeline: Prisma.JsonNull,
          speakerTimelineFeatures: Prisma.JsonNull,
          speakerConfidenceScores: Prisma.JsonNull,
          speakerEngagementScores: Prisma.JsonNull,
          speakerImportanceScores: Prisma.JsonNull,
          speakerHighlightMoments: Prisma.JsonNull,
          ocrText: [],
          ocrTracks: [],
          ocrFeatures: noOcrFeatures,
          objects: [],
          objectTracks: [],
          objectFeatures: noObjectFeatures,
          compositionFeatures: noCompositionFeatures,
          llmFeatures: Prisma.JsonNull,
          highlightScore: 64,
          highlightConfidence: 0.3,
          highlightBreakdown: [
            {
              signal: 'scene',
              feature: 'cutsPerMinute',
              rawValue: 12,
              normalizedValue: 0.6799999999999999,
              weight: 0.25,
              weightedContribution: 0.16999999999999998,
            },
            {
              signal: 'editingRhythm',
              feature: 'tempoScore',
              rawValue: 0.6,
              normalizedValue: 0.6,
              weight: 0.016666666666666666,
              weightedContribution: 0.01,
            },
            {
              signal: 'editingRhythm',
              feature: 'pacingScore',
              rawValue: 0.6478752062616411,
              normalizedValue: 0.6478752062616411,
              weight: 0.016666666666666666,
              weightedContribution: 0.010797920104360684,
            },
            {
              signal: 'editingRhythm',
              feature: 'accelerationScore',
              rawValue: -1,
              normalizedValue: 0,
              weight: 0.016666666666666666,
              weightedContribution: 0,
            },
          ],
          highlightExplainability: {
            topFactors: [
              {
                signal: 'scene',
                feature: 'cutsPerMinute',
                weightedContribution: 0.16999999999999998,
                description: 'moderate visual dynamism (12.0 cuts/min)',
              },
              {
                signal: 'editingRhythm',
                feature: 'pacingScore',
                weightedContribution: 0.010797920104360684,
                description: 'moderate pacing regularity (how evenly cuts were spaced)',
              },
              {
                signal: 'editingRhythm',
                feature: 'tempoScore',
                weightedContribution: 0.01,
                description: 'moderate overall editing tempo',
              },
            ],
          },
          highlightReason:
            'Moderate visual dynamism (12.0 cuts/min); moderate pacing regularity (how evenly cuts were spaced); moderate overall editing tempo.',
          highlightPrediction: {
            bucket: 'uncertain',
            rationale:
              'Score is 64 but confidence is low (30%) - too few signals were available to trust this prediction.',
          },
          highlightRecommendation: {
            action: 'review_manually',
            message:
              'Signals are mixed or incomplete - review this clip manually before publishing.',
          },
        },
      });
    });

    it('persists an empty sceneCuts array without failing the job when scene cut detection throws', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectSceneCutsMock.mockRejectedValue(new Error('ffmpeg not found'));

      const processor = getProcessor();
      const result = await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith({
        where: { id: 'clip-1', outputUrl: null },
        data: {
          outputUrl: 'renders/clip-1.mp4',
          outputSizeBytes: 654321,
          storyboardFrameUrls: [],
          sceneCuts: [],
          sceneCutEvents: [],
          facialEmotions: [],
          gestures: [],
          audioFeatures: noAudioFeatures,
          sceneFeatures: {
            cutCount: 0,
            cutsPerMinute: 0,
            averageSegmentSeconds: 10,
            hardCutCount: 0,
            fadeCount: 0,
            dissolveCount: 0,
          },
          motionEnergy: [],
          motionEnergyFeatures: noMotionEnergyFeatures,
          cameraMotion: [],
          cameraMotionFeatures: noCameraMotionFeatures,
          editingRhythmFeatures: defaultEditingRhythmFeatures,
          facialFeatures: noFacialFeatures,
          gestureFeatures: noGestureFeatures,
          faceLandmarks: [],
          faceLandmarkFeatures: noFaceLandmarkFeatures,
          trackingQualityMetrics: noTrackingQualityMetrics,
          activeSpeakerSamples: [],
          speakerFaceAssociations: [],
          lipSyncVerifications: [],
          speakerTimeline: Prisma.JsonNull,
          speakerTimelineFeatures: Prisma.JsonNull,
          speakerConfidenceScores: Prisma.JsonNull,
          speakerEngagementScores: Prisma.JsonNull,
          speakerImportanceScores: Prisma.JsonNull,
          speakerHighlightMoments: Prisma.JsonNull,
          ocrText: [],
          ocrTracks: [],
          ocrFeatures: noOcrFeatures,
          objects: [],
          objectTracks: [],
          objectFeatures: noObjectFeatures,
          compositionFeatures: noCompositionFeatures,
          llmFeatures: Prisma.JsonNull,
          ...baselineHighlight,
        },
      });
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    });
  });

  describe('Batch SC-1 (Scene Intelligence taxonomy expansion)', () => {
    it('calls classifySceneCutTypes with the detected cuts and persists the classified events plus the cut-type breakdown', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectSceneCutsMock.mockResolvedValue({ cuts: [1.5, 4.2, 7.0] });
      classifySceneCutTypesMock.mockResolvedValue({
        events: [
          { t: 1.5, type: 'hard_cut' },
          { t: 4.2, type: 'fade' },
          { t: 7.0, type: 'hard_cut' },
        ],
      });

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(classifySceneCutTypesMock).toHaveBeenCalledWith(
        {
          videoPath: expect.stringContaining('source'),
          startTime: 10,
          endTime: 20,
          cuts: [1.5, 4.2, 7.0],
        },
        sceneIntelligenceDeps,
      );
      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sceneCutEvents: [
              { t: 1.5, type: 'hard_cut' },
              { t: 4.2, type: 'fade' },
              { t: 7.0, type: 'hard_cut' },
            ],
            sceneFeatures: expect.objectContaining({
              cutCount: 3,
              hardCutCount: 2,
              fadeCount: 1,
              dissolveCount: 0,
            }),
          }),
        }),
      );
    });

    it('persists Prisma.JsonNull sceneCutEvents (falling back to counting every cut as a hard cut) without failing the job when classification throws', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectSceneCutsMock.mockResolvedValue({ cuts: [1.5, 4.2] });
      classifySceneCutTypesMock.mockRejectedValue(new Error('ffmpeg not found'));

      const processor = getProcessor();
      const result = await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sceneCutEvents: Prisma.JsonNull,
            sceneFeatures: expect.objectContaining({
              cutCount: 2,
              hardCutCount: 2,
              fadeCount: 0,
              dissolveCount: 0,
            }),
          }),
        }),
      );
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    });
  });

  describe('Batch SC-2 (Scene Intelligence taxonomy expansion - motion energy)', () => {
    it('calls analyzeMotionEnergy with the source path and clip time range, persisting the samples and derived features', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      analyzeMotionEnergyMock.mockResolvedValue({
        samples: [
          { t: 0, motionEnergy: 2 },
          { t: 1, motionEnergy: 10 },
        ],
      });

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(analyzeMotionEnergyMock).toHaveBeenCalledWith(
        { videoPath: expect.stringContaining('source'), startTime: 10, endTime: 20 },
        sceneIntelligenceDeps,
      );
      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            motionEnergy: [
              { t: 0, motionEnergy: 2 },
              { t: 1, motionEnergy: 10 },
            ],
            motionEnergyFeatures: {
              averageMotionEnergy: 6,
              peakMotionEnergy: 10,
              staticRatio: 0.5,
              dynamicRatio: 0.5,
              // clip duration is 10s (startTime 10, endTime 20); neither
              // sample clears the mean+1.5*stddev peak threshold (12).
              peakCount: 0,
              peakTimestamps: [],
              peakRatePerMinute: 0,
              // mean 6, stddev 4 (sqrt(((2-6)^2+(10-6)^2)/2)) -> CoV 4/6.
              motionVariability: 4 / 6,
            },
          }),
        }),
      );
    });

    it('persists an empty motionEnergy array and all-null features (not a failed job) when analysis throws', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      analyzeMotionEnergyMock.mockRejectedValue(new Error('ffmpeg not found'));

      const processor = getProcessor();
      const result = await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            motionEnergy: [],
            motionEnergyFeatures: noMotionEnergyFeatures,
            cameraMotion: [],
            cameraMotionFeatures: noCameraMotionFeatures,
          }),
        }),
      );
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    });
  });

  describe('Batch SC-3 (Scene Intelligence taxonomy expansion - directional camera motion)', () => {
    it('calls detectCameraMotion with the source path and clip time range, persisting the samples and derived features', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectCameraMotionMock.mockResolvedValue([
        { t: 0, dx: null, dy: null, scale: null, rotation: null, ecc: null },
        { t: 1, dx: 0.05, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
        { t: 2, dx: 0.05, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
      ]);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(detectCameraMotionMock).toHaveBeenCalledWith(
        { sourcePath: expect.stringContaining('source'), startTime: 10, endTime: 20 },
        cameraMotionDeps,
      );
      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cameraMotion: [
              { t: 0, dx: null, dy: null, scale: null, rotation: null, ecc: null },
              { t: 1, dx: 0.05, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
              { t: 2, dx: 0.05, dy: 0, scale: 1.0, rotation: 0, ecc: 0.9 },
            ],
            cameraMotionFeatures: {
              panScore: 1,
              tiltScore: 0,
              zoomScore: 0,
              shakeScore: 0,
              dominantMotionType: 'pan',
              dominantDirection: 'right',
              // Both classifiable samples are 'pan' - a single category has
              // zero entropy.
              motionTypeDiversity: 0,
              // Identical dx/dy across both classifiable samples - zero
              // frame-to-frame delta, perfectly smooth.
              smoothnessScore: 1,
            },
          }),
        }),
      );
    });

    it('persists Prisma.JsonNull cameraMotion/cameraMotionFeatures (not a failed job) when detection throws', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectCameraMotionMock.mockRejectedValue(new Error('python3 not found'));

      const processor = getProcessor();
      const result = await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cameraMotion: Prisma.JsonNull,
            cameraMotionFeatures: Prisma.JsonNull,
          }),
        }),
      );
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    });
  });

  describe('Facial Intelligence (Fase 27)', () => {
    it('calls detectFacialEmotion with the source path and clip time range, persisting the resulting samples', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectFacialEmotionMock.mockResolvedValue([
        { t: 0, emotion: 'happy', score: 0.9 },
        { t: 1, emotion: null, score: null },
      ]);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(detectFacialEmotionMock).toHaveBeenCalledWith(
        { sourcePath: expect.stringContaining('source'), startTime: 10, endTime: 20 },
        facialIntelligenceDeps,
      );
      expect(clipUpdateMock).toHaveBeenCalledWith({
        where: { id: 'clip-1', outputUrl: null },
        data: {
          outputUrl: 'renders/clip-1.mp4',
          outputSizeBytes: 654321,
          storyboardFrameUrls: [],
          sceneCuts: [],
          sceneCutEvents: [],
          facialEmotions: [
            { t: 0, emotion: 'happy', score: 0.9 },
            { t: 1, emotion: null, score: null },
          ],
          gestures: [],
          audioFeatures: noAudioFeatures,
          sceneFeatures: {
            cutCount: 0,
            cutsPerMinute: 0,
            averageSegmentSeconds: 10,
            hardCutCount: 0,
            fadeCount: 0,
            dissolveCount: 0,
          },
          motionEnergy: [],
          motionEnergyFeatures: noMotionEnergyFeatures,
          cameraMotion: [],
          cameraMotionFeatures: noCameraMotionFeatures,
          editingRhythmFeatures: defaultEditingRhythmFeatures,
          facialFeatures: {
            dominantEmotion: 'happy',
            emotionTransitions: 0,
            peakConfidence: 0.9,
            stability: null,
          },
          gestureFeatures: noGestureFeatures,
          faceLandmarks: [],
          faceLandmarkFeatures: noFaceLandmarkFeatures,
          trackingQualityMetrics: noTrackingQualityMetrics,
          activeSpeakerSamples: [],
          speakerFaceAssociations: [],
          lipSyncVerifications: [],
          speakerTimeline: Prisma.JsonNull,
          speakerTimelineFeatures: Prisma.JsonNull,
          speakerConfidenceScores: Prisma.JsonNull,
          speakerEngagementScores: Prisma.JsonNull,
          speakerImportanceScores: Prisma.JsonNull,
          speakerHighlightMoments: Prisma.JsonNull,
          ocrText: [],
          ocrTracks: [],
          ocrFeatures: noOcrFeatures,
          objects: [],
          objectTracks: [],
          objectFeatures: noObjectFeatures,
          compositionFeatures: noCompositionFeatures,
          llmFeatures: Prisma.JsonNull,
          highlightScore: 46,
          highlightConfidence: 0.45,
          highlightBreakdown: [
            {
              signal: 'scene',
              feature: 'cutsPerMinute',
              rawValue: 0,
              normalizedValue: 0.2,
              weight: 0.25,
              weightedContribution: 0.05,
            },
            {
              signal: 'editingRhythm',
              feature: 'tempoScore',
              rawValue: 0,
              normalizedValue: 0,
              weight: 0.05,
              weightedContribution: 0,
            },
            {
              signal: 'facial',
              feature: 'dominantEmotionWeight',
              rawValue: null,
              normalizedValue: 0.9,
              weight: 0.1,
              weightedContribution: 0.09000000000000001,
            },
            {
              signal: 'facial',
              feature: 'peakConfidence',
              rawValue: 0.9,
              normalizedValue: 0.9,
              weight: 0.1,
              weightedContribution: 0.09000000000000001,
            },
          ],
          highlightExplainability: {
            topFactors: [
              {
                signal: 'facial',
                feature: 'dominantEmotionWeight',
                weightedContribution: 0.09000000000000001,
                description: 'dominant facial expression was happy',
              },
              {
                signal: 'facial',
                feature: 'peakConfidence',
                weightedContribution: 0.09000000000000001,
                description: 'high facial classification confidence (90%)',
              },
              {
                signal: 'scene',
                feature: 'cutsPerMinute',
                weightedContribution: 0.05,
                description: 'low visual dynamism (0.0 cuts/min)',
              },
            ],
          },
          highlightReason:
            'Dominant facial expression was happy; high facial classification confidence ' +
            '(90%); low visual dynamism (0.0 cuts/min).',
          highlightPrediction: {
            bucket: 'uncertain',
            rationale: 'Score of 46 is in the middle range - not clearly strong or weak.',
          },
          highlightRecommendation: {
            action: 'review_manually',
            message:
              'Signals are mixed or incomplete - review this clip manually before publishing.',
          },
        },
      });
    });

    it('persists Prisma.JsonNull (not an empty array) without failing the job when facial emotion detection throws', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectFacialEmotionMock.mockRejectedValue(new Error('python3 not found'));

      const processor = getProcessor();
      const result = await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith({
        where: { id: 'clip-1', outputUrl: null },
        data: {
          outputUrl: 'renders/clip-1.mp4',
          outputSizeBytes: 654321,
          storyboardFrameUrls: [],
          sceneCuts: [],
          sceneCutEvents: [],
          facialEmotions: Prisma.JsonNull,
          gestures: [],
          audioFeatures: noAudioFeatures,
          sceneFeatures: {
            cutCount: 0,
            cutsPerMinute: 0,
            averageSegmentSeconds: 10,
            hardCutCount: 0,
            fadeCount: 0,
            dissolveCount: 0,
          },
          motionEnergy: [],
          motionEnergyFeatures: noMotionEnergyFeatures,
          cameraMotion: [],
          cameraMotionFeatures: noCameraMotionFeatures,
          editingRhythmFeatures: defaultEditingRhythmFeatures,
          facialFeatures: Prisma.JsonNull,
          gestureFeatures: noGestureFeatures,
          faceLandmarks: [],
          faceLandmarkFeatures: noFaceLandmarkFeatures,
          trackingQualityMetrics: noTrackingQualityMetrics,
          activeSpeakerSamples: [],
          speakerFaceAssociations: [],
          lipSyncVerifications: [],
          speakerTimeline: Prisma.JsonNull,
          speakerTimelineFeatures: Prisma.JsonNull,
          speakerConfidenceScores: Prisma.JsonNull,
          speakerEngagementScores: Prisma.JsonNull,
          speakerImportanceScores: Prisma.JsonNull,
          speakerHighlightMoments: Prisma.JsonNull,
          ocrText: [],
          ocrTracks: [],
          ocrFeatures: noOcrFeatures,
          objects: [],
          objectTracks: [],
          objectFeatures: noObjectFeatures,
          compositionFeatures: noCompositionFeatures,
          llmFeatures: Prisma.JsonNull,
          ...baselineHighlight,
        },
      });
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    });
  });

  describe('Gesture Intelligence (Fase 30)', () => {
    it('calls detectGestures with the source path and clip time range, persisting the resulting samples', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectGesturesMock.mockResolvedValue([
        { t: 0, gesture: 'thumb_up', confidence: 0.9 },
        { t: 1, gesture: null, confidence: null },
      ]);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(detectGesturesMock).toHaveBeenCalledWith(
        { sourcePath: expect.stringContaining('source'), startTime: 10, endTime: 20 },
        gestureIntelligenceDeps,
      );
      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            gestures: [
              { t: 0, gesture: 'thumb_up', confidence: 0.9 },
              { t: 1, gesture: null, confidence: null },
            ],
            gestureFeatures: {
              dominantGesture: 'thumb_up',
              gestureTransitions: 0,
              peakConfidence: 0.9,
              stability: null,
            },
            // Gesture's default weight is 0 (see @speedora/fusion-engine's
            // weights.ts) - real gesture data doesn't change the score or
            // confidence versus the no-gesture baseline (highlightBreakdown
            // does gain two extra weight:0 gesture entries, not asserted
            // exactly here - see @speedora/fusion-engine's own tests for
            // that).
            highlightScore: baselineHighlight.highlightScore,
            highlightConfidence: baselineHighlight.highlightConfidence,
            highlightReason: baselineHighlight.highlightReason,
          }),
        }),
      );
    });

    it('persists Prisma.JsonNull (not an empty array) without failing the job when gesture detection throws', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectGesturesMock.mockRejectedValue(new Error('python3 not found'));

      const processor = getProcessor();
      const result = await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            gestures: Prisma.JsonNull,
            gestureFeatures: Prisma.JsonNull,
          }),
        }),
      );
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    });
  });

  describe('Face Intelligence Batch 1 - Face Landmarks', () => {
    it('calls detectFaceLandmarks with the source path and clip time range, persisting the resulting samples', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectFaceLandmarksMock.mockResolvedValue([
        {
          t: 0,
          blendshapes: {
            eyeBlinkLeft: 0.1,
            eyeBlinkRight: 0.1,
            mouthSmileLeft: 0.6,
            mouthSmileRight: 0.6,
            jawOpen: 0.2,
            cheekSquintLeft: 0.1,
            cheekSquintRight: 0.1,
            eyeSquintLeft: 0.1,
            eyeSquintRight: 0.1,
            browDownLeft: 0.1,
            browDownRight: 0.1,
            browInnerUp: 0.1,
            browOuterUpLeft: 0.1,
            browOuterUpRight: 0.1,
          },
          rotation: { pitch: 2, yaw: -4, roll: 1 },
          boundingBox: { xCenter: 0.5, yCenter: 0.5, width: 0.3, height: 0.4 },
          leftIris: { x: 0.45, y: 0.5, z: -0.02 },
          rightIris: { x: 0.55, y: 0.5, z: -0.02 },
          leftEyeInnerCorner: { x: 0.47, y: 0.5, z: -0.01 },
          leftEyeOuterCorner: { x: 0.4, y: 0.5, z: -0.01 },
          rightEyeInnerCorner: { x: 0.53, y: 0.5, z: -0.01 },
          rightEyeOuterCorner: { x: 0.6, y: 0.5, z: -0.01 },
          sharpness: 300,
          brightness: 140,
          mouthContrastRatio: 0.9,
          faceDescriptor: [1, 1, 1, 1, 1, 1, 1, 1, 1],
          trackId: 0,
          mouthWidth: 0.5,
        },
      ]);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(detectFaceLandmarksMock).toHaveBeenCalledWith(
        { sourcePath: expect.stringContaining('source'), startTime: 10, endTime: 20 },
        faceLandmarksDeps,
      );
      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            faceLandmarkFeatures: {
              blinkRate: 0,
              averageSmile: 0.6,
              averageMouthOpen: 0.2,
              averageAbsoluteYaw: 4,
              averageAbsolutePitch: 2,
              positionScore: 1,
              sizeScore: 0.12,
              visibilityScore: 1,
              // Iris roughly centered in both eye sockets (leftIris/
              // rightIris landmarks in the mock sample above) and head
              // rotation well within the forward-facing threshold - see
              // deriveFaceLandmarkFeatures's Batch 2 heuristic.
              eyeContactRate: 1,
              dominantLookingDirection: 'center',
              averageSharpness: 300,
              averageBrightness: 140,
              occlusionRate: 0,
              // Single sample, single trackId - no changes, fully consistent.
              speakerChangeCount: 0,
              dominantSpeakerConsistency: 1,
              // baseJobData's transcript segment carries no rmsDb (see its
              // own comment above) - no audio-timing data at all, so this
              // is null (not merely inconclusive) per
              // deriveFaceLandmarkFeatures's own contract.
              speakerAudioSyncRate: null,
              // Batch 5A - single sample only: <2 samples-with-blendshapes
              // means no delta to measure velocity/articulation from, but
              // jawOpen(0.2) is already above MOUTH_ACTIVITY_THRESHOLD so
              // speakingIntensity resolves to that one active sample's
              // value, and no sustained low-activity run exists to count
              // as a pause.
              averageLipVelocity: null,
              speakingIntensity: 0.2,
              pauseCount: 0,
              articulationRate: null,
              // Batch 5B - averageMouthWidth from the mock sample's own
              // mouthWidth(0.5); averageCheekRaise/averageEyeSquint from
              // cheekSquintLeft/Right and eyeSquintLeft/Right (0.1 each).
              // This one sample IS smiling (average mouthSmile 0.6 >=
              // SMILE_ACTIVE_THRESHOLD) but cheek-raise/eye-squint (0.1)
              // fall short of their own thresholds (0.3) - a posed, not
              // genuine, smile.
              averageMouthWidth: 0.5,
              averageCheekRaise: 0.1,
              averageEyeSquint: 0.1,
              genuineSmileRate: 0,
              // Batch 5C - single sample only: <2 samples-with-blendshapes
              // means no blink-frequency rate can be computed, and only 1
              // gaze-offset reading means no frame-to-frame stability
              // comparison is possible either. The one sample's own blink
              // blendshapes are both below BLINK_THRESHOLD (not blinking),
              // so its single-sample run never reaches
              // PROLONGED_CLOSURE_MIN_SAMPLES.
              blinkFrequencyPerMinute: null,
              prolongedClosureCount: 0,
              gazeStabilityScore: null,
              // Batch 5D - averageBrowActivity from the mock's own brow
              // blendshapes (0.1 each). Smile alone (0.6 >=
              // POSITIVE_AFFECT_THRESHOLD) resolves dominantAffect to
              // 'positive_affect' before energy/expressiveness get a say.
              // All 3 component scores (positivity/energy/expressiveness)
              // end up available for this single sample, so
              // affectConfidence is 1.
              averageBrowActivity: 0.1,
              averageHeadMovementRate: null,
              dominantAffect: 'positive_affect',
              affectConfidence: 1,
            },
            // faceGeometry's default weight is 0 (see @speedora/fusion-
            // engine's weights.ts) - same "collected, not yet scored"
            // convention as gesture above - real data doesn't change the
            // score/confidence versus the no-signal baseline.
            highlightScore: baselineHighlight.highlightScore,
            highlightConfidence: baselineHighlight.highlightConfidence,
            highlightReason: baselineHighlight.highlightReason,
          }),
        }),
      );
    });

    it('persists Prisma.JsonNull (not an empty array) without failing the job when face landmark detection throws', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectFaceLandmarksMock.mockRejectedValue(new Error('python3 not found'));

      const processor = getProcessor();
      const result = await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            faceLandmarks: Prisma.JsonNull,
            faceLandmarkFeatures: Prisma.JsonNull,
            trackingQualityMetrics: Prisma.JsonNull,
          }),
        }),
      );
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    });
  });

  describe('OCR Batch OCR-1 - Text Detection', () => {
    it('calls detectOcrText with the source path and clip time range, persisting the resulting samples', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectOcrTextMock.mockResolvedValue([
        {
          t: 0,
          textBlocks: [
            {
              text: 'hello world',
              boundingBox: { xCenter: 0.5, yCenter: 0.85, width: 0.6, height: 0.05 },
              confidence: 0.92,
            },
          ],
        },
      ]);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(detectOcrTextMock).toHaveBeenCalledWith(
        { sourcePath: expect.stringContaining('source'), startTime: 10, endTime: 20 },
        ocrIntelligenceDeps,
      );
      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ocrText: [
              {
                t: 0,
                textBlocks: [
                  {
                    text: 'hello world',
                    boundingBox: { xCenter: 0.5, yCenter: 0.85, width: 0.6, height: 0.05 },
                    confidence: 0.92,
                  },
                ],
              },
            ],
          }),
        }),
      );
    });

    it('persists Prisma.JsonNull (not an empty array) without failing the job when OCR text detection throws', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectOcrTextMock.mockRejectedValue(new Error('tesseract not found'));

      const processor = getProcessor();
      const result = await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ocrText: Prisma.JsonNull,
            ocrTracks: Prisma.JsonNull,
            ocrFeatures: Prisma.JsonNull,
          }),
        }),
      );
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    });
  });

  describe('OCR Batch OCR-2 - Tracking & Classification', () => {
    it('tracks and classifies OCR text, persisting ocrTracks/ocrFeatures and letting the ocr signal move highlightScore', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      // Bottom-center, wide, single-frame text block - unambiguously
      // subtitle-shaped (see classify-ocr-text.ts's own scoring rules).
      detectOcrTextMock.mockResolvedValue([
        {
          t: 0,
          textBlocks: [
            {
              text: 'hello world',
              boundingBox: { xCenter: 0.5, yCenter: 0.85, width: 0.6, height: 0.05 },
              confidence: 0.92,
            },
          ],
        },
      ]);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ocrTracks: [
              expect.objectContaining({
                text: 'hello world',
                category: 'subtitle',
                categoryConfidence: 1,
                classificationMethod: 'HybridRuleEngine',
                appearsFrames: 1,
                persistenceScore: 1,
                motionScore: null,
                nearFace: null,
                language: null,
              }),
            ],
            ocrFeatures: {
              subtitleCoverageRate: 1,
              slidePresenceRate: 0,
              captionRate: 0,
              logoPresenceRate: 0,
              priceMentionRate: 0,
              nameMentionRate: 0,
              dominantTextCategory: 'subtitle',
              averageTextBlockCount: 1,
            },
          }),
        }),
      );

      // `ocr` carries a real (non-zero) weight in DEFAULT_FUSION_WEIGHTS
      // (unlike faceGeometry/gesture, which stay at 0) - this is the
      // first batch where OCR data should actually move the score away
      // from the no-signal baseline, not just get collected for later.
      const [{ data }] = clipUpdateMock.mock.calls[0];
      expect(data.highlightScore).not.toBe(baselineHighlight.highlightScore);
    });
  });

  describe('Object Intelligence Batch OI-1 - Foundation (detection + tracking)', () => {
    it('calls detectObjects with the source path and clip time range, tracking and persisting objects/objectTracks/objectFeatures', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectObjectsMock.mockResolvedValue([
        {
          t: 0,
          objects: [
            {
              category: 'person',
              boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
              confidence: 0.9,
            },
          ],
        },
      ]);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(detectObjectsMock).toHaveBeenCalledWith(
        { sourcePath: expect.stringContaining('source'), startTime: 10, endTime: 20 },
        objectIntelligenceDeps,
      );
      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            objects: [
              {
                t: 0,
                objects: [
                  {
                    category: 'person',
                    boundingBox: { xCenter: 0.3, yCenter: 0.5, width: 0.2, height: 0.6 },
                    confidence: 0.9,
                  },
                ],
              },
            ],
            objectTracks: [
              expect.objectContaining({
                category: 'person',
                appearsFrames: 1,
                persistenceScore: 1,
              }),
            ],
            objectFeatures: {
              objectCount: 1,
              dominantObject: 'person',
              averageObjectsPerFrame: 1,
              averageTrackingConfidence: 0.9,
              averagePersistence: 1,
              // Single-appearance track (one sample) - no motionSpeed to average.
              averageMotionSpeed: null,
              // No other objects in the frame - a real 0, not null.
              averageOcclusionScore: 0,
              // Alone throughout: proximity=0, temporalOverlap=0 (no other
              // track), convergence=0.5 (neutral, no distance history).
              // Written as the same expression the source computes
              // (average([0, 0, 0.5])) so the floating-point result is
              // guaranteed bit-identical, not just mathematically equal.
              averageInteractionConfidence: (0 + 0 + 0.5) / 3,
              // Batch OI-5 - same "mirror the source's exact expression"
              // convention. Visibility = average(confidence 0.9,
              // persistenceScore 1, 1 - occlusionScore 1). Activity = 0.5
              // (neutral - single appearance). Social =
              // average(interactionConfidence [(0+0+0.5)/3], partnerScore 0,
              // coPresence 0). attentionScore = average(Visibility, 0.5,
              // Social).
              averageAttentionScore:
                ((0.9 + 1 + (1 - 0)) / 3 + 0.5 + ((0 + 0 + 0.5) / 3 + 0 + 0) / 3) / 3,
              // Single appearance / CONFIDENCE_FRAME_CAP (5).
              averageAttentionConfidence: 1 / 5,
            },
          }),
        }),
      );

      // `object` is weight 0 in DEFAULT_FUSION_WEIGHTS (collect first,
      // calibrate later, same as sceneMotion/cameraMotion/gesture/
      // faceGeometry) - unlike `ocr` above, this data is collected and
      // visible in `contributions` but must NOT move highlightScore yet.
      const [{ data }] = clipUpdateMock.mock.calls[0];
      expect(data.highlightScore).toBe(baselineHighlight.highlightScore);
    });

    it('persists Prisma.JsonNull (not an empty array) without failing the job when object detection throws', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectObjectsMock.mockRejectedValue(new Error('python3 not found'));

      const processor = getProcessor();
      const result = await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            objects: Prisma.JsonNull,
            objectTracks: Prisma.JsonNull,
            objectFeatures: Prisma.JsonNull,
          }),
        }),
      );
      expect(videoUpdateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: VideoStatus.FAILED } }),
      );
      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    });
  });

  describe('Composition Intelligence roadmap - Batch RB-1/RB-2', () => {
    it('runs Primary Subject Selection over faceLandmarks and persists real (non-null) compositionFeatures', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      // computeCropDimensionsMock (shared beforeEach) resolves a 136x240
      // (portrait) output frame - the headroom target range below assumes
      // that same portrait orientation.
      detectFaceLandmarksMock.mockResolvedValue([
        {
          t: 0,
          blendshapes: null,
          // |yaw| = 4 is below leadRoomScore's neutral threshold (15), and a
          // single sample has no motion-trend history either - leadRoomScore
          // should resolve to null, not a guessed direction.
          rotation: { pitch: 0, yaw: -4, roll: 0 },
          // Dead-center box: centeringScore should be exactly 1.
          boundingBox: { xCenter: 0.5, yCenter: 0.5, width: 0.3, height: 0.4 },
          leftIris: null,
          rightIris: null,
          leftEyeInnerCorner: null,
          leftEyeOuterCorner: null,
          rightEyeInnerCorner: null,
          rightEyeOuterCorner: null,
          sharpness: null,
          brightness: null,
          mouthContrastRatio: null,
          faceDescriptor: null,
          trackId: 0,
          mouthWidth: null,
        },
      ]);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      const [{ data }] = clipUpdateMock.mock.calls[0];
      const composition = data.compositionFeatures;
      // Dead-center box, exactly halfway between "on a thirds intersection"
      // (1) and "as far as geometrically possible" (0) - see
      // calculateRuleOfThirdsScore's own module comment. toBeCloseTo, not
      // toBe - the sqrt-based geometry produces a floating-point-imprecise
      // 0.5 (e.g. 0.5000000000000001), not a literal 0.5.
      expect(composition.ruleOfThirdsScore).toBeCloseTo(0.5);
      // topEdge = 0.5 - 0.4/2 = 0.3, which is 0.1 above the portrait target
      // range's max (0.2), against a 0.2 max deviation - see
      // calculateHeadroomScore. Same floating-point-imprecision reason as
      // ruleOfThirdsScore above.
      expect(composition.headroomScore).toBeCloseTo(0.5);
      // Only one sample, and its yaw is inside the neutral band - no
      // resolvable facing direction, excluded rather than guessed (see
      // calculateLeadRoomScore).
      expect(composition.leadRoomScore).toBeNull();
      // Dead-center box - see calculateCenteringScore.
      expect(composition.centeringScore).toBe(1);
      // The one sample had a subject the whole time.
      expect(composition.subjectLossRatio).toBe(0);
      // Needs 2+ consecutive present samples to take a delta.
      expect(composition.compositionStability).toBeNull();
      // Needs 2+ present samples to compare shot-type transitions.
      expect(composition.framingConsistency).toBeNull();

      // `composition` is weight 0 in DEFAULT_FUSION_WEIGHTS (collect first,
      // calibrate later, same as object/gesture/faceGeometry) - this data
      // must NOT move highlightScore yet.
      expect(data.highlightScore).toBe(baselineHighlight.highlightScore);
    });

    it('falls back to tracked objects for the sample grid when face detection finds nothing (empty, not null)', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      // detectFaceLandmarksMock already defaults to [] (shared beforeEach) -
      // an empty array is truthy, so this exercises the union-not-fallback
      // sample-timestamp fix (a `?? ` fallback would have silently produced
      // an empty grid here and dropped this object-track data entirely).
      detectObjectsMock.mockResolvedValue([
        {
          t: 0,
          objects: [
            {
              category: 'person',
              boundingBox: { xCenter: 0.5, yCenter: 0.5, width: 0.3, height: 0.4 },
              confidence: 0.9,
            },
          ],
        },
      ]);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      const [{ data }] = clipUpdateMock.mock.calls[0];
      // Dead-center tracked person -> the same centeringScore=1 the face-
      // sourced test above got, confirming object-track data reached
      // Composition Intelligence at all (would be all-null if the sample
      // grid had silently come back empty).
      expect(data.compositionFeatures.centeringScore).toBe(1);
      expect(data.compositionFeatures.subjectLossRatio).toBe(0);
    });
  });

  describe('Ranking (Fase 31)', () => {
    it('ranks sibling clips by highlightScore once every clip in the video has finished rendering', async () => {
      clipFindManyMock
        // First call: the existing "allRendered" check.
        .mockResolvedValueOnce([
          { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
          { id: 'clip-2', outputUrl: 'renders/clip-2.mp4', highlightScore: null },
        ])
        // Second call: the ranking step's own narrower select.
        .mockResolvedValueOnce([
          { id: 'clip-1', highlightScore: 20 },
          { id: 'clip-2', highlightScore: 80 },
        ]);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(clipUpdateMock).toHaveBeenCalledWith({
        where: { id: 'clip-2' },
        data: { highlightRank: 1 },
      });
      expect(clipUpdateMock).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: { highlightRank: 2 },
      });
    });

    it('does not fail the job when ranking itself throws', async () => {
      clipFindManyMock
        .mockResolvedValueOnce([
          { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
        ])
        .mockRejectedValueOnce(new Error('db unavailable'));

      const processor = getProcessor();
      const result = await processor({ data: baseJobData });

      expect(videoUpdateMock).toHaveBeenCalledWith({
        where: { id: 'video-1' },
        data: { status: VideoStatus.RENDERED },
      });
      expect(result).toEqual({ clipId: 'clip-1', outputUrl: 'renders/clip-1.mp4' });
    });
  });

  describe('Mini Fusion Engine v1 prep - derived features (Fase 28)', () => {
    it('computes audioFeatures for real from the clip transcript segments own rmsDb/peakDb/speakingRateWordsPerSecond', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);

      const processor = getProcessor();
      await processor({
        data: {
          ...baseJobData,
          transcript: [
            {
              start: 10,
              end: 15,
              text: 'hi',
              rmsDb: -20,
              peakDb: -8,
              speakingRateWordsPerSecond: 1,
            },
            {
              start: 15,
              end: 20,
              text: 'there',
              rmsDb: -10,
              peakDb: -2,
              speakingRateWordsPerSecond: 3,
            },
          ],
        },
      });

      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            audioFeatures: {
              averageRmsDb: -15,
              peakDb: -2,
              averageSpeakingRateWordsPerSecond: 2,
              speakingRateStdDev: 1,
            },
          }),
        }),
      );
    });
  });

  describe('Mini Fusion Engine v2 (Fase 29/31)', () => {
    it('combines all three available signals into one weighted, explainable highlightScore via the real computeHighlightScore', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      detectSceneCutsMock.mockResolvedValue({ cuts: [1.5, 4.2] });
      detectFacialEmotionMock.mockResolvedValue([{ t: 0, emotion: 'happy', score: 0.9 }]);

      const processor = getProcessor();
      await processor({
        data: {
          ...baseJobData,
          transcript: [
            {
              start: 10,
              end: 15,
              text: 'hi',
              rmsDb: -20,
              peakDb: -8,
              speakingRateWordsPerSecond: 1,
            },
            {
              start: 15,
              end: 20,
              text: 'there',
              rmsDb: -10,
              peakDb: -2,
              speakingRateWordsPerSecond: 3,
            },
          ],
        },
      });

      expect(clipUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            highlightScore: 71,
            highlightConfidence: 0.7650000000000001,
            highlightBreakdown: [
              {
                signal: 'audio',
                feature: 'averageRmsDb',
                rawValue: -15,
                normalizedValue: 0.8333333333333334,
                weight: 0.175,
                weightedContribution: 0.14583333333333334,
              },
              {
                signal: 'audio',
                feature: 'speakingRateStdDev',
                rawValue: 1,
                normalizedValue: 0.5,
                weight: 0.175,
                weightedContribution: 0.0875,
              },
              {
                signal: 'scene',
                feature: 'cutsPerMinute',
                rawValue: 12,
                normalizedValue: 0.6799999999999999,
                weight: 0.25,
                weightedContribution: 0.16999999999999998,
              },
              {
                signal: 'editingRhythm',
                feature: 'tempoScore',
                rawValue: 0.5857142857142856,
                normalizedValue: 0.5857142857142856,
                weight: 0.016666666666666666,
                weightedContribution: 0.00976190476190476,
              },
              {
                signal: 'editingRhythm',
                feature: 'pacingScore',
                rawValue: 0.6478752062616411,
                normalizedValue: 0.6478752062616411,
                weight: 0.016666666666666666,
                weightedContribution: 0.010797920104360684,
              },
              {
                signal: 'editingRhythm',
                feature: 'accelerationScore',
                rawValue: -1,
                normalizedValue: 0,
                weight: 0.016666666666666666,
                weightedContribution: 0,
              },
              {
                signal: 'facial',
                feature: 'dominantEmotionWeight',
                rawValue: null,
                normalizedValue: 0.9,
                weight: 0.1,
                weightedContribution: 0.09000000000000001,
              },
              {
                signal: 'facial',
                feature: 'peakConfidence',
                rawValue: 0.9,
                normalizedValue: 0.9,
                weight: 0.1,
                weightedContribution: 0.09000000000000001,
              },
            ],
            highlightExplainability: {
              topFactors: [
                {
                  signal: 'scene',
                  feature: 'cutsPerMinute',
                  weightedContribution: 0.16999999999999998,
                  description: 'moderate visual dynamism (12.0 cuts/min)',
                },
                {
                  signal: 'audio',
                  feature: 'averageRmsDb',
                  weightedContribution: 0.14583333333333334,
                  description: 'high vocal energy (avg -15.0 dB)',
                },
                {
                  signal: 'facial',
                  feature: 'dominantEmotionWeight',
                  weightedContribution: 0.09000000000000001,
                  description: 'dominant facial expression was happy',
                },
              ],
            },
            highlightReason:
              'Moderate visual dynamism (12.0 cuts/min); high vocal energy (avg -15.0 dB); ' +
              'dominant facial expression was happy.',
          }),
        }),
      );
    });

    it("threads job.data.scores through to computeHighlightScore's llm signal and persists llmFeatures", async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);

      const processor = getProcessor();
      await processor({ data: { ...baseJobData, scores: FULL_LLM_SCORES } });

      const call = clipUpdateMock.mock.calls.find(([args]) => args.data.llmFeatures !== undefined);
      expect(call).toBeDefined();
      const { data } = call![0];

      expect(data.llmFeatures).toEqual(FULL_LLM_SCORES);
      const llmContributions = data.highlightBreakdown.filter(
        (item: { signal: string }) => item.signal === 'llm',
      );
      expect(llmContributions).toHaveLength(9);
      expect(llmContributions).toContainEqual(
        expect.objectContaining({
          signal: 'llm',
          feature: 'engagement.hookStrength',
          rawValue: 80,
          normalizedValue: 0.8,
        }),
      );
    });
  });

  it('marks the video FAILED, rethrows, and still cleans up scratch files when rendering fails', async () => {
    buildAssMock.mockReturnValue(
      '[Script Info]\n...\nDialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,hi',
    );
    renderClipMock.mockRejectedValue(new Error('ffmpeg exploded'));

    const processor = getProcessor();

    await expect(processor({ data: baseJobData })).rejects.toThrow('ffmpeg exploded');

    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.FAILED },
    });
    expect(uploadObjectMock).not.toHaveBeenCalled();
    expect(clipUpdateMock).not.toHaveBeenCalled();
    // source + captions + output were all reserved before renderClip threw
    // (no reframe-cmds this run - no face detected).
    expect(cleanupTempFileMock).toHaveBeenCalledTimes(3);
  });

  it('reports the failure to Sentry tagged with videoId and clipId only (no transcript content)', async () => {
    const error = new Error('ffmpeg exploded');
    renderClipMock.mockRejectedValue(error);

    const processor = getProcessor();

    await expect(processor({ data: baseJobData })).rejects.toThrow('ffmpeg exploded');

    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      tags: { videoId: 'video-1', clipId: 'clip-1' },
    });
  });
});
