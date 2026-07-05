import { getObjectStream } from '@speedora/storage';
import type { Response } from 'express';
import type { ClipsService } from './clips.service';
import { ClipsController } from './clips.controller';

jest.mock('@speedora/storage', () => ({
  getObjectStream: jest.fn(),
}));

describe('ClipsController', () => {
  let controller: ClipsController;
  let clipsService: {
    findRenderedOrThrow: jest.Mock;
    update: jest.Mock;
    render: jest.Mock;
    remove: jest.Mock;
    publish: jest.Mock;
    cancelScheduledPublish: jest.Mock;
    reschedulePublish: jest.Mock;
  };
  const user = { id: 'user-1', email: 'a@example.com' };

  beforeEach(() => {
    clipsService = {
      findRenderedOrThrow: jest.fn(),
      update: jest.fn(),
      render: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn(),
      cancelScheduledPublish: jest.fn(),
      reschedulePublish: jest.fn(),
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

  it('delegates DELETE :id to ClipsService.remove', async () => {
    await controller.remove(user, 'clip-1');

    expect(clipsService.remove).toHaveBeenCalledWith('clip-1', 'user-1');
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

  it('delegates DELETE :id/publish/:recordId to ClipsService.cancelScheduledPublish', async () => {
    clipsService.cancelScheduledPublish.mockResolvedValue(undefined);

    await controller.cancelPublish(user, 'clip-1', 'record-1');

    expect(clipsService.cancelScheduledPublish).toHaveBeenCalledWith(
      'clip-1',
      'record-1',
      'user-1',
    );
  });

  it('delegates PATCH :id/publish/:recordId to ClipsService.reschedulePublish', async () => {
    const rescheduled = {
      id: 'record-1',
      status: 'SCHEDULED',
      scheduledAt: '2026-08-01T00:00:00.000Z',
    };
    clipsService.reschedulePublish.mockResolvedValue(rescheduled);

    const result = await controller.reschedulePublish(user, 'clip-1', 'record-1', {
      scheduledAt: '2026-08-01T00:00:00.000Z',
    });

    expect(clipsService.reschedulePublish).toHaveBeenCalledWith(
      'clip-1',
      'record-1',
      'user-1',
      '2026-08-01T00:00:00.000Z',
    );
    expect(result).toBe(rescheduled);
  });
});
