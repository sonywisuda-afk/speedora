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
    findStoryboardFrameOrThrow: jest.Mock;
    upload: jest.Mock;
    importFromYoutube: jest.Mock;
    findAll: jest.Mock;
  };
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const };

  beforeEach(() => {
    videosService = {
      findSourceOrThrow: jest.fn(),
      findThumbnailOrThrow: jest.fn(),
      findStoryboardFrameOrThrow: jest.fn(),
      upload: jest.fn(),
      importFromYoutube: jest.fn(),
      findAll: jest.fn(),
    };
    controller = new VideosController(videosService as unknown as VideosService);
    jest.clearAllMocks();
  });

  describe('upload', () => {
    it('defaults to GROQ when the client sends no transcriptionProvider', async () => {
      const file = { buffer: Buffer.from('x') } as Express.Multer.File;

      await controller.upload(user, file, {});

      expect(videosService.upload).toHaveBeenCalledWith('user-1', file, TranscriptionProvider.GROQ);
    });

    it('forwards an explicit transcriptionProvider choice (OPENAI) unchanged', async () => {
      const file = { buffer: Buffer.from('x') } as Express.Multer.File;

      await controller.upload(user, file, { transcriptionProvider: TranscriptionProvider.OPENAI });

      expect(videosService.upload).toHaveBeenCalledWith(
        'user-1',
        file,
        TranscriptionProvider.OPENAI,
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

  describe('storyboardFrame', () => {
    it('streams a WebP storyboard frame as image/webp, with a private day-long cache header', async () => {
      videosService.findStoryboardFrameOrThrow.mockResolvedValue({
        frameKey: 'storyboards/video-1-0.webp',
      });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.storyboardFrame(user, 'video-1', '0', res);

      expect(videosService.findStoryboardFrameOrThrow).toHaveBeenCalledWith(
        'video-1',
        'user-1',
        0,
      );
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
});
