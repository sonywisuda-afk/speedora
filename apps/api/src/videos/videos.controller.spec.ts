import { TranscriptionProvider } from '@speedora/shared';
import { getObjectStream, getObjectStreamRange } from '@speedora/storage';
import type { Response } from 'express';
import type { VideosService } from './videos.service';
import { VideosController } from './videos.controller';

jest.mock('@speedora/storage', () => ({
  getObjectStream: jest.fn(),
  getObjectStreamRange: jest.fn(),
}));

describe('VideosController', () => {
  let controller: VideosController;
  let videosService: {
    findSourceOrThrow: jest.Mock;
    findThumbnailOrThrow: jest.Mock;
    findAnimatedThumbnailOrThrow: jest.Mock;
    findHoverPreviewOrThrow: jest.Mock;
    findStoryboardFrameOrThrow: jest.Mock;
    upload: jest.Mock;
    importFromYoutube: jest.Mock;
    findAll: jest.Mock;
    getVideoReportJson: jest.Mock;
    getVideoReportCsv: jest.Mock;
    getClipMetadataJson: jest.Mock;
    getClipMetadataCsv: jest.Mock;
    exportTranscriptTxt: jest.Mock;
    exportCaptionsSrt: jest.Mock;
    exportCaptionsVtt: jest.Mock;
  };
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const };

  beforeEach(() => {
    videosService = {
      findSourceOrThrow: jest.fn(),
      findThumbnailOrThrow: jest.fn(),
      findAnimatedThumbnailOrThrow: jest.fn(),
      findHoverPreviewOrThrow: jest.fn(),
      findStoryboardFrameOrThrow: jest.fn(),
      upload: jest.fn(),
      importFromYoutube: jest.fn(),
      findAll: jest.fn(),
      getVideoReportJson: jest.fn(),
      getVideoReportCsv: jest.fn(),
      getClipMetadataJson: jest.fn(),
      getClipMetadataCsv: jest.fn(),
      exportTranscriptTxt: jest.fn(),
      exportCaptionsSrt: jest.fn(),
      exportCaptionsVtt: jest.fn(),
    };
    controller = new VideosController(videosService as unknown as VideosService);
    jest.clearAllMocks();
  });

  describe('upload', () => {
    it('defaults to GROQ when the client sends no transcriptionProvider', async () => {
      const file = { buffer: Buffer.from('x') } as Express.Multer.File;

      await controller.upload(user, file, {});

      expect(videosService.upload).toHaveBeenCalledWith(
        'user-1',
        file,
        TranscriptionProvider.GROQ,
        undefined,
      );
    });

    it('forwards an explicit transcriptionProvider choice (OPENAI) unchanged', async () => {
      const file = { buffer: Buffer.from('x') } as Express.Multer.File;

      await controller.upload(user, file, { transcriptionProvider: TranscriptionProvider.OPENAI });

      expect(videosService.upload).toHaveBeenCalledWith(
        'user-1',
        file,
        TranscriptionProvider.OPENAI,
        undefined,
      );
    });

    it('forwards an explicit workspaceId (Sprint 5A, Collaboration Foundation) unchanged', async () => {
      const file = { buffer: Buffer.from('x') } as Express.Multer.File;

      await controller.upload(user, file, { workspaceId: 'ws-1' });

      expect(videosService.upload).toHaveBeenCalledWith(
        'user-1',
        file,
        TranscriptionProvider.GROQ,
        'ws-1',
      );
    });
  });

  describe('findAll', () => {
    it('defaults to the default limit and no cursor when none are given', () => {
      controller.findAll(user);

      expect(videosService.findAll).toHaveBeenCalledWith('user-1', {
        cursor: undefined,
        limit: 20,
      });
    });

    it('forwards workspaceId/projectId/folderId filters (Sprint 5A) unchanged', () => {
      controller.findAll(user, undefined, undefined, 'ws-1', 'project-1', 'folder-1');

      expect(videosService.findAll).toHaveBeenCalledWith('user-1', {
        cursor: undefined,
        limit: 20,
        workspaceId: 'ws-1',
        projectId: 'project-1',
        folderId: 'folder-1',
      });
    });

    it('forwards an explicit cursor and clamps an out-of-range limit rather than passing it through raw', () => {
      controller.findAll(user, 'video-9', '9999');

      expect(videosService.findAll).toHaveBeenCalledWith('user-1', {
        cursor: 'video-9',
        limit: 50,
      });
    });
  });

  describe('importYoutube', () => {
    it('defaults to GROQ when the client sends no transcriptionProvider', () => {
      controller.importYoutube(user, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });

      expect(videosService.importFromYoutube).toHaveBeenCalledWith(
        'user-1',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        TranscriptionProvider.GROQ,
        undefined,
      );
    });

    it('forwards an explicit transcriptionProvider choice (OPENAI) unchanged', () => {
      controller.importYoutube(user, {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        transcriptionProvider: TranscriptionProvider.OPENAI,
      });

      expect(videosService.importFromYoutube).toHaveBeenCalledWith(
        'user-1',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        TranscriptionProvider.OPENAI,
        undefined,
      );
    });

    it('forwards an explicit workspaceId (Sprint 5A, Collaboration Foundation) unchanged', () => {
      controller.importYoutube(user, {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        workspaceId: 'ws-1',
      });

      expect(videosService.importFromYoutube).toHaveBeenCalledWith(
        'user-1',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        TranscriptionProvider.GROQ,
        'ws-1',
      );
    });
  });

  describe('source', () => {
    it('streams the full object with a 200 when no Range header is sent', async () => {
      videosService.findSourceOrThrow.mockResolvedValue({ sourceUrl: 'videos/abc.mp4' });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStreamRange as jest.Mock).mockResolvedValue({
        stream: fakeStream,
        contentType: 'video/mp4',
        contentLength: 1000,
      });
      const res = { setHeader: jest.fn(), status: jest.fn() } as unknown as Response;

      await controller.source(user, 'video-1', undefined, res);

      expect(videosService.findSourceOrThrow).toHaveBeenCalledWith('video-1', 'user-1');
      expect(getObjectStreamRange).toHaveBeenCalledWith('videos/abc.mp4', undefined);
      expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '1000');
      expect(res.status).not.toHaveBeenCalled();
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('responds 206 with Content-Range when a Range header is sent', async () => {
      videosService.findSourceOrThrow.mockResolvedValue({ sourceUrl: 'videos/abc.mp4' });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStreamRange as jest.Mock).mockResolvedValue({
        stream: fakeStream,
        contentType: 'video/mp4',
        contentLength: 500,
        contentRange: 'bytes 0-499/1000',
      });
      const res = { setHeader: jest.fn(), status: jest.fn() } as unknown as Response;

      await controller.source(user, 'video-1', 'bytes=0-499', res);

      expect(getObjectStreamRange).toHaveBeenCalledWith('videos/abc.mp4', 'bytes=0-499');
      expect(res.status).toHaveBeenCalledWith(206);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-499/1000');
    });

    it('propagates the not-found error from the service without touching the response', async () => {
      videosService.findSourceOrThrow.mockRejectedValue(new Error('not found'));
      const res = { setHeader: jest.fn(), status: jest.fn() } as unknown as Response;

      await expect(controller.source(user, 'missing', undefined, res)).rejects.toThrow('not found');
      expect(getObjectStreamRange).not.toHaveBeenCalled();
    });
  });

  describe('thumbnail', () => {
    it('streams a WebP thumbnail as image/webp, with a private day-long cache header', async () => {
      videosService.findThumbnailOrThrow.mockResolvedValue({
        thumbnailUrl: 'thumbnails/video-1.webp',
      });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.thumbnail(user, 'video-1', res);

      expect(videosService.findThumbnailOrThrow).toHaveBeenCalledWith('video-1', 'user-1');
      expect(getObjectStream).toHaveBeenCalledWith('thumbnails/video-1.webp');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('derives image/jpeg for a pre-Phase-2 .jpg thumbnail key rather than hardcoding WebP', async () => {
      videosService.findThumbnailOrThrow.mockResolvedValue({
        thumbnailUrl: 'thumbnails/video-1.jpg',
      });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.thumbnail(user, 'video-1', res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    });

    it('404s without touching storage when no thumbnail has been extracted yet', async () => {
      videosService.findThumbnailOrThrow.mockResolvedValue({ thumbnailUrl: null });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.thumbnail(user, 'video-1', res)).rejects.toThrow(
        'Video video-1 has no thumbnail',
      );
      expect(getObjectStream).not.toHaveBeenCalled();
    });

    it('propagates the not-found error from the service without touching storage', async () => {
      videosService.findThumbnailOrThrow.mockRejectedValue(new Error('not found'));
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.thumbnail(user, 'missing', res)).rejects.toThrow('not found');
      expect(getObjectStream).not.toHaveBeenCalled();
    });
  });

  describe('animatedThumbnail', () => {
    it('streams a WebP animated preview as image/webp, with a private day-long cache header', async () => {
      videosService.findAnimatedThumbnailOrThrow.mockResolvedValue({
        animatedThumbnailUrl: 'animated-thumbnails/video-1.webp',
      });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.animatedThumbnail(user, 'video-1', res);

      expect(videosService.findAnimatedThumbnailOrThrow).toHaveBeenCalledWith('video-1', 'user-1');
      expect(getObjectStream).toHaveBeenCalledWith('animated-thumbnails/video-1.webp');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('404s without touching storage when no animated thumbnail has been extracted yet', async () => {
      videosService.findAnimatedThumbnailOrThrow.mockResolvedValue({
        animatedThumbnailUrl: null,
      });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.animatedThumbnail(user, 'video-1', res)).rejects.toThrow(
        'Video video-1 has no animated thumbnail',
      );
      expect(getObjectStream).not.toHaveBeenCalled();
    });

    it('propagates the not-found error from the service without touching storage', async () => {
      videosService.findAnimatedThumbnailOrThrow.mockRejectedValue(new Error('not found'));
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.animatedThumbnail(user, 'missing', res)).rejects.toThrow('not found');
      expect(getObjectStream).not.toHaveBeenCalled();
    });
  });

  describe('hoverPreview', () => {
    it('streams a WebP hover preview as image/webp, with a private day-long cache header', async () => {
      videosService.findHoverPreviewOrThrow.mockResolvedValue({
        hoverPreviewUrl: 'hover-previews/video-1.webp',
      });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.hoverPreview(user, 'video-1', res);

      expect(videosService.findHoverPreviewOrThrow).toHaveBeenCalledWith('video-1', 'user-1');
      expect(getObjectStream).toHaveBeenCalledWith('hover-previews/video-1.webp');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('404s without touching storage when no hover preview has been extracted yet', async () => {
      videosService.findHoverPreviewOrThrow.mockResolvedValue({ hoverPreviewUrl: null });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.hoverPreview(user, 'video-1', res)).rejects.toThrow(
        'Video video-1 has no hover preview',
      );
      expect(getObjectStream).not.toHaveBeenCalled();
    });

    it('propagates the not-found error from the service without touching storage', async () => {
      videosService.findHoverPreviewOrThrow.mockRejectedValue(new Error('not found'));
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.hoverPreview(user, 'missing', res)).rejects.toThrow('not found');
      expect(getObjectStream).not.toHaveBeenCalled();
    });
  });

  describe('storyboardFrame', () => {
    it('streams a WebP storyboard frame as image/webp, with a private day-long cache header', async () => {
      videosService.findStoryboardFrameOrThrow.mockResolvedValue({
        frameKey: 'storyboards/video-1-0.webp',
      });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.storyboardFrame(user, 'video-1', '0', res);

      expect(videosService.findStoryboardFrameOrThrow).toHaveBeenCalledWith('video-1', 'user-1', 0);
      expect(getObjectStream).toHaveBeenCalledWith('storyboards/video-1-0.webp');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('404s without touching storage when no frame exists at that index', async () => {
      videosService.findStoryboardFrameOrThrow.mockResolvedValue({ frameKey: null });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.storyboardFrame(user, 'video-1', '9', res)).rejects.toThrow(
        'Video video-1 has no storyboard frame at index 9',
      );
      expect(getObjectStream).not.toHaveBeenCalled();
    });

    it('propagates the not-found error from the service without touching storage', async () => {
      videosService.findStoryboardFrameOrThrow.mockRejectedValue(new Error('not found'));
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.storyboardFrame(user, 'missing', '0', res)).rejects.toThrow(
        'not found',
      );
      expect(getObjectStream).not.toHaveBeenCalled();
    });
  });

  describe('export', () => {
    it('report.json sends the JSON report as an attachment', async () => {
      videosService.getVideoReportJson.mockResolvedValue({ cover: { videoTitle: 'My video' } });
      const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;

      await controller.exportReportJson(user, 'video-1', res);

      expect(videosService.getVideoReportJson).toHaveBeenCalledWith('video-1', 'user-1');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="video-video-1-report.json"',
      );
      expect(res.send).toHaveBeenCalledWith(
        JSON.stringify({ cover: { videoTitle: 'My video' } }, null, 2),
      );
    });

    it('report.csv sends the CSV report as text/csv with a UTF-8 BOM (for Excel)', async () => {
      videosService.getVideoReportCsv.mockResolvedValue('Section,ClipId,Field,Value\n');
      const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;

      await controller.exportReportCsv(user, 'video-1', res);

      expect(videosService.getVideoReportCsv).toHaveBeenCalledWith('video-1', 'user-1');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      const sent = (res.send as jest.Mock).mock.calls[0][0] as string;
      expect(sent.charCodeAt(0)).toBe(0xfeff);
      expect(sent.slice(1)).toBe('Section,ClipId,Field,Value\n');
    });

    it('clip-metadata.json sends the clip metadata as an attachment', async () => {
      videosService.getClipMetadataJson.mockResolvedValue({ clips: [] });
      const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;

      await controller.exportClipMetadataJson(user, 'video-1', res);

      expect(videosService.getClipMetadataJson).toHaveBeenCalledWith('video-1', 'user-1');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="video-video-1-clip-metadata.json"',
      );
    });

    it('clip-metadata.csv sends the clip metadata CSV with a UTF-8 BOM', async () => {
      videosService.getClipMetadataCsv.mockResolvedValue('ClipId\n');
      const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;

      await controller.exportClipMetadataCsv(user, 'video-1', res);

      expect(videosService.getClipMetadataCsv).toHaveBeenCalledWith('video-1', 'user-1');
      const sent = (res.send as jest.Mock).mock.calls[0][0] as string;
      expect(sent.charCodeAt(0)).toBe(0xfeff);
      expect(sent.slice(1)).toBe('ClipId\n');
    });

    it('transcript.txt sends plain text', async () => {
      videosService.exportTranscriptTxt.mockResolvedValue('Hello.\n');
      const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;

      await controller.exportTranscriptTxt(user, 'video-1', res);

      expect(videosService.exportTranscriptTxt).toHaveBeenCalledWith('video-1', 'user-1');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
      expect(res.send).toHaveBeenCalledWith('Hello.\n');
    });

    it('captions.srt sends SRT with the subrip content type', async () => {
      videosService.exportCaptionsSrt.mockResolvedValue('1\n00:00:00,000 --> 00:00:01,000\nHi\n');
      const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;

      await controller.exportCaptionsSrt(user, 'video-1', res);

      expect(videosService.exportCaptionsSrt).toHaveBeenCalledWith('video-1', 'user-1');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/x-subrip; charset=utf-8',
      );
    });

    it('captions.vtt sends VTT with the text/vtt content type', async () => {
      videosService.exportCaptionsVtt.mockResolvedValue(
        'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nHi\n',
      );
      const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;

      await controller.exportCaptionsVtt(user, 'video-1', res);

      expect(videosService.exportCaptionsVtt).toHaveBeenCalledWith('video-1', 'user-1');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/vtt; charset=utf-8');
    });

    it('propagates the not-found error from the service without touching the response', async () => {
      videosService.getVideoReportJson.mockRejectedValue(new Error('not found'));
      const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;

      await expect(controller.exportReportJson(user, 'missing', res)).rejects.toThrow('not found');
      expect(res.send).not.toHaveBeenCalled();
    });
  });
});
