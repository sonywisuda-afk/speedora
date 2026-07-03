import { getObjectStream } from '@viral-clip-app/storage';
import type { Response } from 'express';
import type { ClipsService } from './clips.service';
import { ClipsController } from './clips.controller';

jest.mock('@viral-clip-app/storage', () => ({
  getObjectStream: jest.fn(),
}));

describe('ClipsController', () => {
  let controller: ClipsController;
  let clipsService: {
    findRenderedOrThrow: jest.Mock;
    update: jest.Mock;
    render: jest.Mock;
    publish: jest.Mock;
  };
  const user = { id: 'user-1', email: 'a@example.com' };

  beforeEach(() => {
    clipsService = {
      findRenderedOrThrow: jest.fn(),
      update: jest.fn(),
      render: jest.fn(),
      publish: jest.fn(),
    };
    controller = new ClipsController(clipsService as unknown as ClipsService);
    jest.clearAllMocks();
  });

  it('streams the rendered clip with the right headers', async () => {
    const clip = { id: 'clip-1', outputUrl: 'renders/clip-1.mp4' };
    clipsService.findRenderedOrThrow.mockResolvedValue(clip);
    const fakeStream = { pipe: jest.fn() };
    (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
    const res = { setHeader: jest.fn() } as unknown as Response;

    await controller.download(user, 'clip-1', res);

    expect(clipsService.findRenderedOrThrow).toHaveBeenCalledWith('clip-1', 'user-1');
    expect(getObjectStream).toHaveBeenCalledWith('renders/clip-1.mp4');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="clip-clip-1.mp4"',
    );
    expect(fakeStream.pipe).toHaveBeenCalledWith(res);
  });

  it('delegates PATCH to ClipsService.update', async () => {
    const updated = { id: 'clip-1', startTime: 12, endTime: 22 };
    clipsService.update.mockResolvedValue(updated);

    const result = await controller.update(user, 'clip-1', { startTime: 12, endTime: 22 });

    expect(clipsService.update).toHaveBeenCalledWith('clip-1', 'user-1', {
      startTime: 12,
      endTime: 22,
    });
    expect(result).toBe(updated);
  });

  it('delegates POST :id/render to ClipsService.render', async () => {
    const rendering = { id: 'clip-1', downloadUrl: null };
    clipsService.render.mockResolvedValue(rendering);

    const result = await controller.render(user, 'clip-1');

    expect(clipsService.render).toHaveBeenCalledWith('clip-1', 'user-1');
    expect(result).toBe(rendering);
  });

  it('delegates POST :id/publish to ClipsService.publish', async () => {
    const record = { id: 'record-1', status: 'QUEUED' };
    clipsService.publish.mockResolvedValue(record);

    const result = await controller.publish(user, 'clip-1', { socialAccountId: 'account-1' });

    expect(clipsService.publish).toHaveBeenCalledWith('clip-1', 'user-1', {
      socialAccountId: 'account-1',
    });
    expect(result).toBe(record);
  });
});
