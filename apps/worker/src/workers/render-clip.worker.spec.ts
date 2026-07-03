import { CaptionStyle, VideoStatus } from '@viral-clip-app/database';
import type { TranscriptSegment } from '@viral-clip-app/shared';
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
jest.mock('../ffmpeg', () => ({
  renderClip: (...args: unknown[]) => renderClipMock(...args),
  getVideoDimensions: (...args: unknown[]) => getVideoDimensionsMock(...args),
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
jest.mock('../reframe', () => ({
  computeCropDimensions: (...args: unknown[]) => computeCropDimensionsMock(...args),
  buildCropPath: (...args: unknown[]) => buildCropPathMock(...args),
  buildSendCmdScript: (...args: unknown[]) => buildSendCmdScriptMock(...args),
}));

let scratchCounter = 0;
const reserveScratchPathMock = jest.fn((prefix: string, ext: string) => {
  scratchCounter += 1;
  return Promise.resolve(`/tmp/viral-clip-app/${prefix}-${scratchCounter}${ext}`);
});
const cleanupTempFileMock = jest.fn();
jest.mock('../storage', () => ({
  reserveScratchPath: (...args: [string, string]) => reserveScratchPathMock(...args),
  cleanupTempFile: (...args: unknown[]) => cleanupTempFileMock(...args),
}));

const getObjectStreamMock = jest.fn();
const uploadObjectMock = jest.fn();
jest.mock('@viral-clip-app/storage', () => ({
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
    uploadObjectMock.mockResolvedValue(undefined);
    clipUpdateMock.mockResolvedValue({});
    videoUpdateMock.mockResolvedValue({});
    cleanupTempFileMock.mockResolvedValue(undefined);
    getVideoDimensionsMock.mockResolvedValue({ width: 320, height: 240 });
    computeCropDimensionsMock.mockReturnValue({ width: 136, height: 240 });
    detectFacesMock.mockResolvedValue([{ t: 0, box: null }]);
    buildCropPathMock.mockReturnValue(null); // no face -> static center-crop by default
    buildSendCmdScriptMock.mockReturnValue('0 crop@reframe x 10, crop@reframe y 0;');
    buildAssMock.mockReturnValue('');
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
        { t: 0, x: 10, y: 0 },
        { t: 0.2, x: 20, y: 0 },
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
