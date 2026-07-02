import { getObjectStream } from '@viral-clip-app/storage';
import type { Response } from 'express';
import type { ClipsService } from './clips.service';
import { ClipsController } from './clips.controller';

jest.mock('@viral-clip-app/storage', () => ({
  getObjectStream: jest.fn(),
}));

describe('ClipsController', () => {
  let controller: ClipsController;
  let clipsService: { findRenderedOrThrow: jest.Mock };

  beforeEach(() => {
    clipsService = { findRenderedOrThrow: jest.fn() };
    controller = new ClipsController(clipsService as unknown as ClipsService);
    jest.clearAllMocks();
  });

  it('streams the rendered clip with the right headers', async () => {
    const clip = { id: 'clip-1', outputUrl: 'renders/clip-1.mp4' };
    clipsService.findRenderedOrThrow.mockResolvedValue(clip);
    const fakeStream = { pipe: jest.fn() };
    (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
    const res = { setHeader: jest.fn() } as unknown as Response;

    await controller.download({ id: 'user-1', email: 'a@example.com' }, 'clip-1', res);

    expect(clipsService.findRenderedOrThrow).toHaveBeenCalledWith('clip-1', 'user-1');
    expect(getObjectStream).toHaveBeenCalledWith('renders/clip-1.mp4');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="clip-clip-1.mp4"',
    );
    expect(fakeStream.pipe).toHaveBeenCalledWith(res);
  });
});
