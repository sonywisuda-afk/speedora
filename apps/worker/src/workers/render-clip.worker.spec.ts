import { CaptionStyle, Prisma, VideoStatus } from '@speedora/database';
import type { ClipScores, TranscriptSegment } from '@speedora/shared';
import { Worker } from 'bullmq';

jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../redis', () => ({ createRedisConnection: jest.fn() }));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

jest.mock('node:fs', () => ({
  createWriteStream: jest.fn().mockReturnValue({ fake: 'writable' }),
}));

const pipelineMock = jest.fn();
jest.mock('node:stream/promises', () => ({
  pipeline: (...args: unknown[]) => pipelineMock(...args),
}));

const readFileMock = jest.fn();
const writeFileMock = jest.fn();
jest.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}));

const renderClipMock = jest.fn();
const getVideoDimensionsMock = jest.fn();
const trimCutRangesMock = jest.fn();
const trimAndFadeInBRollMock = jest.fn();
const fadeOutBRollMock = jest.fn();
jest.mock('../ffmpeg', () => ({
  renderClip: (...args: unknown[]) => renderClipMock(...args),
  getVideoDimensions: (...args: unknown[]) => getVideoDimensionsMock(...args),
  trimCutRanges: (...args: unknown[]) => trimCutRangesMock(...args),
  trimAndFadeInBRoll: (...args: unknown[]) => trimAndFadeInBRollMock(...args),
  fadeOutBRoll: (...args: unknown[]) => fadeOutBRollMock(...args),
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

// deriveSceneFeatures is a pure function (no subprocess/side effects), so
// it's left real here (via jest.requireActual) rather than mocked - same
// precedent as cutlist's functions in this same spec file and
// computeSpeakingRate in transcribe.worker.spec.ts. Only detectSceneCuts
// (the ffmpeg subprocess call) is mocked.
const detectSceneCutsMock = jest.fn();
jest.mock('@speedora/scene-intelligence', () => ({
  ...jest.requireActual('@speedora/scene-intelligence'),
  detectSceneCuts: (...args: unknown[]) => detectSceneCutsMock(...args),
}));

// Same reasoning as above - deriveFacialEmotionFeatures is pure, left real.
const detectFacialEmotionMock = jest.fn();
jest.mock('@speedora/facial-intelligence', () => ({
  ...jest.requireActual('@speedora/facial-intelligence'),
  detectFacialEmotion: (...args: unknown[]) => detectFacialEmotionMock(...args),
}));

// Same reasoning as above - deriveGestureFeatures is pure, left real.
const detectGesturesMock = jest.fn();
jest.mock('@speedora/gesture-intelligence', () => ({
  ...jest.requireActual('@speedora/gesture-intelligence'),
  detectGestures: (...args: unknown[]) => detectGesturesMock(...args),
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
const videoUpdateMock = jest.fn();
const videoStatusEventCreateMock = jest.fn();
jest.mock('../prisma', () => ({
  prisma: {
    clip: {
      update: (...args: unknown[]) => clipUpdateMock(...args),
      findMany: (...args: unknown[]) => clipFindManyMock(...args),
    },
    video: { update: (...args: unknown[]) => videoUpdateMock(...args) },
    // Fase 3 (DB+JSON-contract roadmap) - updateVideoStatus() writes here
    // too, atomically alongside video.update() via $transaction.
    videoStatusEvent: { create: (...args: unknown[]) => videoStatusEventCreateMock(...args) },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

import { facialIntelligenceDeps } from '../facialIntelligenceDeps';
import { gestureIntelligenceDeps } from '../gestureIntelligenceDeps';
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
// Real computeHighlightScore() (v2, Fase 31) output for a clip with zero
// scene cuts (the baseline scene score, 0.2 normalized -> 20/100) and no
// audio/facial/gesture signal - most tests here don't set up cuts/audio/
// facial/gesture data.
const baselineHighlight = {
  highlightScore: 20,
  highlightConfidence: 0.30000000000000004,
  highlightBreakdown: [
    {
      signal: 'scene',
      feature: 'cutsPerMinute',
      rawValue: 0,
      normalizedValue: 0.2,
      weight: 0.3,
      weightedContribution: 0.06,
    },
  ],
  highlightExplainability: {
    topFactors: [
      {
        signal: 'scene',
        feature: 'cutsPerMinute',
        weightedContribution: 0.06,
        description: 'low visual dynamism (0.0 cuts/min)',
      },
    ],
  },
  highlightReason: 'Low visual dynamism (0.0 cuts/min).',
  highlightPrediction: {
    bucket: 'uncertain',
    rationale:
      'Score is 20 but confidence is low (30%) - too few signals were available to trust this prediction.',
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
    readFileMock.mockResolvedValue(Buffer.from('rendered-bytes'));
    renderClipMock.mockResolvedValue(undefined);
    trimCutRangesMock.mockResolvedValue(undefined);
    uploadObjectMock.mockResolvedValue(undefined);
    clipUpdateMock.mockResolvedValue({});
    videoUpdateMock.mockResolvedValue({});
    videoStatusEventCreateMock.mockResolvedValue({});
    cleanupTempFileMock.mockResolvedValue(undefined);
    getVideoDimensionsMock.mockResolvedValue({ width: 320, height: 240 });
    computeCropDimensionsMock.mockReturnValue({ width: 136, height: 240 });
    detectFacesMock.mockResolvedValue([{ t: 0, box: null }]);
    detectSceneCutsMock.mockResolvedValue({ cuts: [] });
    detectFacialEmotionMock.mockResolvedValue([]);
    detectGesturesMock.mockResolvedValue([]);
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
      Buffer.from('rendered-bytes'),
      'video/mp4',
    );
    expect(clipUpdateMock).toHaveBeenCalledWith({
      where: { id: 'clip-1' },
      data: {
        outputUrl: 'renders/clip-1.mp4',
        sceneCuts: [],
        facialEmotions: [],
        gestures: [],
        audioFeatures: noAudioFeatures,
        sceneFeatures: { cutCount: 0, cutsPerMinute: 0, averageSegmentSeconds: 10 },
        facialFeatures: noFacialFeatures,
        gestureFeatures: noGestureFeatures,
        llmFeatures: Prisma.JsonNull,
        ...baselineHighlight,
      },
    });
    expect(videoUpdateMock).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: VideoStatus.RENDERED },
    });
    // source + captions + output - no reframe-cmds file (no face detected).
    expect(cleanupTempFileMock).toHaveBeenCalledTimes(3);
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
    // Only source + output scratch files created and cleaned up, no captions, no reframe-cmds.
    expect(cleanupTempFileMock).toHaveBeenCalledTimes(2);
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
        Buffer.from('rendered-bytes'),
        'video/mp4',
      );
      // No extra "trimmed" scratch file reserved/cleaned up.
      expect(reserveScratchPathMock).not.toHaveBeenCalledWith('trimmed', '.mp4');
    });

    it('runs a second trim pass and uploads its output when the clip has a long silence gap', async () => {
      clipFindManyMock.mockResolvedValue([
        { id: 'clip-1', outputUrl: 'renders/clip-1.mp4', highlightScore: null },
      ]);
      readFileMock.mockImplementation((path: string) =>
        Promise.resolve(
          path.includes('trimmed') ? Buffer.from('trimmed-bytes') : Buffer.from('rendered-bytes'),
        ),
      );

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
        Buffer.from('trimmed-bytes'),
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
      // source + output + reframe-cmds all cleaned up (no captions this time).
      expect(cleanupTempFileMock).toHaveBeenCalledTimes(3);
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
        where: { id: 'clip-1' },
        data: {
          outputUrl: 'renders/clip-1.mp4',
          sceneCuts: [1.5, 4.2],
          facialEmotions: [],
          gestures: [],
          audioFeatures: noAudioFeatures,
          sceneFeatures: { cutCount: 2, cutsPerMinute: 12, averageSegmentSeconds: 10 / 3 },
          facialFeatures: noFacialFeatures,
          gestureFeatures: noGestureFeatures,
          llmFeatures: Prisma.JsonNull,
          highlightScore: 68,
          highlightConfidence: 0.30000000000000004,
          highlightBreakdown: [
            {
              signal: 'scene',
              feature: 'cutsPerMinute',
              rawValue: 12,
              normalizedValue: 0.6799999999999999,
              weight: 0.3,
              weightedContribution: 0.204,
            },
          ],
          highlightExplainability: {
            topFactors: [
              {
                signal: 'scene',
                feature: 'cutsPerMinute',
                weightedContribution: 0.204,
                description: 'moderate visual dynamism (12.0 cuts/min)',
              },
            ],
          },
          highlightReason: 'Moderate visual dynamism (12.0 cuts/min).',
          highlightPrediction: {
            bucket: 'uncertain',
            rationale:
              'Score is 68 but confidence is low (30%) - too few signals were available to trust this prediction.',
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
        where: { id: 'clip-1' },
        data: {
          outputUrl: 'renders/clip-1.mp4',
          sceneCuts: [],
          facialEmotions: [],
          gestures: [],
          audioFeatures: noAudioFeatures,
          sceneFeatures: { cutCount: 0, cutsPerMinute: 0, averageSegmentSeconds: 10 },
          facialFeatures: noFacialFeatures,
          gestureFeatures: noGestureFeatures,
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
        where: { id: 'clip-1' },
        data: {
          outputUrl: 'renders/clip-1.mp4',
          sceneCuts: [],
          facialEmotions: [
            { t: 0, emotion: 'happy', score: 0.9 },
            { t: 1, emotion: null, score: null },
          ],
          gestures: [],
          audioFeatures: noAudioFeatures,
          sceneFeatures: { cutCount: 0, cutsPerMinute: 0, averageSegmentSeconds: 10 },
          facialFeatures: {
            dominantEmotion: 'happy',
            emotionTransitions: 0,
            peakConfidence: 0.9,
            stability: null,
          },
          gestureFeatures: noGestureFeatures,
          llmFeatures: Prisma.JsonNull,
          highlightScore: 48,
          highlightConfidence: 0.4500000000000001,
          highlightBreakdown: [
            {
              signal: 'scene',
              feature: 'cutsPerMinute',
              rawValue: 0,
              normalizedValue: 0.2,
              weight: 0.3,
              weightedContribution: 0.06,
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
                weightedContribution: 0.06,
                description: 'low visual dynamism (0.0 cuts/min)',
              },
            ],
          },
          highlightReason:
            'Dominant facial expression was happy; high facial classification confidence ' +
            '(90%); low visual dynamism (0.0 cuts/min).',
          highlightPrediction: {
            bucket: 'uncertain',
            rationale: 'Score of 48 is in the middle range - not clearly strong or weak.',
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
        where: { id: 'clip-1' },
        data: {
          outputUrl: 'renders/clip-1.mp4',
          sceneCuts: [],
          facialEmotions: Prisma.JsonNull,
          gestures: [],
          audioFeatures: noAudioFeatures,
          sceneFeatures: { cutCount: 0, cutsPerMinute: 0, averageSegmentSeconds: 10 },
          facialFeatures: Prisma.JsonNull,
          gestureFeatures: noGestureFeatures,
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
            highlightScore: 73,
            highlightConfidence: 0.765,
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
                weight: 0.3,
                weightedContribution: 0.204,
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
                  weightedContribution: 0.204,
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
