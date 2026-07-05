import { TranscriptionProvider } from '@speedora/shared';
import { getObjectStreamRange } from '@speedora/storage';
import type { Response } from 'express';
import type { VideosService } from './videos.service';
import { VideosController } from './videos.controller';

jest.mock('@speedora/storage', () => ({
  getObjectStreamRange: jest.fn(),
}));

describe('VideosController', () => {
  let controller: VideosController;
  let videosService: {
    findSourceOrThrow: jest.Mock;
    upload: jest.Mock;
    importFromYoutube: jest.Mock;
  };
  const user = { id: 'user-1', email: 'a@example.com' };

  beforeEach(() => {
    videosService = {
      findSourceOrThrow: jest.fn(),
      upload: jest.fn(),
      importFromYoutube: jest.fn(),
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
});
