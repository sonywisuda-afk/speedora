import { CaptionStyle, VideoStatus } from '@speedora/database';
import type { TranscriptSegment } from '@speedora/shared';
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
jest.mock('../subtitles', () => ({
  buildAss: (...args: unknown[]) => buildAssMock(...args),
}));

const detectFacesMock = jest.fn();
jest.mock('../faceDetection', () => ({
  detectFaces: (...args: unknown[]) => detectFacesMock(...args),
}));

const computeCropDimensionsMock = jest.fn();
const buildCropPathMock = jest.fn();
const buildSendCmdScriptMock = jest.fn();
const findEmphasisWordsMock = jest.fn();
jest.mock('../reframe', () => ({
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
jest.mock('../prisma', () => ({
  prisma: {
    clip: {
      update: (...args: unknown[]) => clipUpdateMock(...args),
      findMany: (...args: unknown[]) => clipFindManyMock(...args),
    },
    video: { update: (...args: unknown[]) => videoUpdateMock(...args) },
  },
}));

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
}

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
    cleanupTempFileMock.mockResolvedValue(undefined);
    getVideoDimensionsMock.mockResolvedValue({ width: 320, height: 240 });
    computeCropDimensionsMock.mockReturnValue({ width: 136, height: 240 });
    detectFacesMock.mockResolvedValue([{ t: 0, box: null }]);
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
      { id: 'clip-1', outputUrl: 'renders/clip-1.mp4' },
      { id: 'clip-2', outputUrl: 'renders/clip-2.mp4' },
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
      data: { outputUrl: 'renders/clip-1.mp4' },
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
    clipFindManyMock.mockResolvedValue([{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }]);

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
    clipFindManyMock.mockResolvedValue([{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }]);

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
      clipFindManyMock.mockResolvedValue([{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }]);

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
      clipFindManyMock.mockResolvedValue([{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }]);
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
      clipFindManyMock.mockResolvedValue([{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }]);

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
      clipFindManyMock.mockResolvedValue([{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }]);
      buildCropPathMock.mockReturnValue(null);

      const processor = getProcessor();
      await processor({ data: baseJobData });

      expect(getVideoDimensionsMock).toHaveBeenCalledWith(expect.stringContaining('source'));
      expect(detectFacesMock).toHaveBeenCalledWith(expect.stringContaining('source'), 10, 20);
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
      clipFindManyMock.mockResolvedValue([{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }]);
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
      clipFindManyMock.mockResolvedValue([{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }]);
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
      clipFindManyMock.mockResolvedValue([{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }]);
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
      clipFindManyMock.mockResolvedValue([{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }]);
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
      clipFindManyMock.mockResolvedValue([{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }]);
      findBRollMomentsMock.mockReturnValue([{ keyword: 'sunset', t: 2 }]);
      searchAssetsMock.mockResolvedValue(null);

      const processor = getProcessor();
      await processor({ data: { ...baseJobData, keywords: ['sunset'] } });

      expect(downloadStockAssetMock).not.toHaveBeenCalled();
      expect(renderClipMock).toHaveBeenCalledWith(expect.objectContaining({ broll: [] }));
    });

    it('skips just the failing moment (does not fail the job) when downloading a cutaway throws', async () => {
      clipFindManyMock.mockResolvedValue([{ id: 'clip-1', outputUrl: 'renders/clip-1.mp4' }]);
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
