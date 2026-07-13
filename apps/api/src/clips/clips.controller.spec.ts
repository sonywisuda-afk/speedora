import { getObjectStream } from '@speedora/storage';
import type { Response } from 'express';
import type { PrismaService } from '../prisma/prisma.service';
import type { ClipsService } from './clips.service';
import { ClipsController } from './clips.controller';

jest.mock('@speedora/storage', () => ({
  getObjectStream: jest.fn(),
}));

describe('ClipsController', () => {
  let controller: ClipsController;
  let clipsService: {
    findRenderedOrThrow: jest.Mock;
    findThumbnailOrThrow: jest.Mock;
    findAnimatedThumbnailOrThrow: jest.Mock;
    findStoryboardFrameOrThrow: jest.Mock;
    getExplainability: jest.Mock;
    update: jest.Mock;
    render: jest.Mock;
    remove: jest.Mock;
    publish: jest.Mock;
    cancelScheduledPublish: jest.Mock;
    reschedulePublish: jest.Mock;
  };
  let prisma: { activityEvent: { create: jest.Mock } };
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const };

  beforeEach(() => {
    clipsService = {
      findRenderedOrThrow: jest.fn(),
      findThumbnailOrThrow: jest.fn(),
      findAnimatedThumbnailOrThrow: jest.fn(),
      findStoryboardFrameOrThrow: jest.fn(),
      getExplainability: jest.fn(),
      update: jest.fn(),
      render: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn(),
      cancelScheduledPublish: jest.fn(),
      reschedulePublish: jest.fn(),
    };
    prisma = { activityEvent: { create: jest.fn().mockResolvedValue({}) } };
    controller = new ClipsController(
      clipsService as unknown as ClipsService,
      prisma as unknown as PrismaService,
    );
    jest.clearAllMocks();
    prisma.activityEvent.create.mockResolvedValue({});
  });

  it('streams the rendered clip with the right headers and records a CLIP_EXPORTED activity event', async () => {
    const clip = { id: 'clip-1', videoId: 'video-1', outputUrl: 'renders/clip-1.mp4' };
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
    expect(prisma.activityEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'CLIP_EXPORTED',
        videoId: 'video-1',
        clipId: 'clip-1',
        metadata: undefined,
      },
    });
  });

  it('streams a WebP thumbnail as image/webp, with a private day-long cache header', async () => {
    clipsService.findThumbnailOrThrow.mockResolvedValue({
      thumbnailUrl: 'thumbnails/clip-1.webp',
    });
    const fakeStream = { pipe: jest.fn() };
    (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
    const res = { setHeader: jest.fn() } as unknown as Response;

    await controller.thumbnail(user, 'clip-1', res);

    expect(clipsService.findThumbnailOrThrow).toHaveBeenCalledWith('clip-1', 'user-1');
    expect(getObjectStream).toHaveBeenCalledWith('thumbnails/clip-1.webp');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
    expect(fakeStream.pipe).toHaveBeenCalledWith(res);
  });

  it('derives image/jpeg for a pre-Phase-2 .jpg thumbnail key rather than hardcoding WebP', async () => {
    clipsService.findThumbnailOrThrow.mockResolvedValue({
      thumbnailUrl: 'thumbnails/clip-1.jpg',
    });
    const fakeStream = { pipe: jest.fn() };
    (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
    const res = { setHeader: jest.fn() } as unknown as Response;

    await controller.thumbnail(user, 'clip-1', res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
  });

  it('propagates the not-found error from the service without touching storage', async () => {
    clipsService.findThumbnailOrThrow.mockRejectedValue(new Error('Clip clip-1 has no thumbnail'));
    const res = { setHeader: jest.fn() } as unknown as Response;

    await expect(controller.thumbnail(user, 'clip-1', res)).rejects.toThrow(
      'Clip clip-1 has no thumbnail',
    );
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it('streams a WebP animated preview as image/webp, with a private day-long cache header', async () => {
    clipsService.findAnimatedThumbnailOrThrow.mockResolvedValue({
      animatedThumbnailUrl: 'animated-thumbnails/clip-1.webp',
    });
    const fakeStream = { pipe: jest.fn() };
    (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
    const res = { setHeader: jest.fn() } as unknown as Response;

    await controller.animatedThumbnail(user, 'clip-1', res);

    expect(clipsService.findAnimatedThumbnailOrThrow).toHaveBeenCalledWith('clip-1', 'user-1');
    expect(getObjectStream).toHaveBeenCalledWith('animated-thumbnails/clip-1.webp');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
    expect(fakeStream.pipe).toHaveBeenCalledWith(res);
  });

  it('propagates the not-found error from the service without touching storage for a missing animated thumbnail', async () => {
    clipsService.findAnimatedThumbnailOrThrow.mockRejectedValue(
      new Error('Clip clip-1 has no animated thumbnail'),
    );
    const res = { setHeader: jest.fn() } as unknown as Response;

    await expect(controller.animatedThumbnail(user, 'clip-1', res)).rejects.toThrow(
      'Clip clip-1 has no animated thumbnail',
    );
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it('streams a WebP storyboard frame as image/webp, with a private day-long cache header', async () => {
    clipsService.findStoryboardFrameOrThrow.mockResolvedValue({
      frameKey: 'storyboards/clip-1-0.webp',
    });
    const fakeStream = { pipe: jest.fn() };
    (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
    const res = { setHeader: jest.fn() } as unknown as Response;

    await controller.storyboardFrame(user, 'clip-1', '0', res);

    expect(clipsService.findStoryboardFrameOrThrow).toHaveBeenCalledWith('clip-1', 'user-1', 0);
    expect(getObjectStream).toHaveBeenCalledWith('storyboards/clip-1-0.webp');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
    expect(fakeStream.pipe).toHaveBeenCalledWith(res);
  });

  it('propagates the not-found error from the service without touching storage for a missing storyboard frame', async () => {
    clipsService.findStoryboardFrameOrThrow.mockRejectedValue(
      new Error('Clip clip-1 has no storyboard frame at index 9'),
    );
    const res = { setHeader: jest.fn() } as unknown as Response;

    await expect(controller.storyboardFrame(user, 'clip-1', '9', res)).rejects.toThrow(
      'Clip clip-1 has no storyboard frame at index 9',
    );
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it('delegates GET :id/explainability to ClipsService.getExplainability', async () => {
    const explainability = { clipId: 'clip-1', results: [{ engine: 'v2', highlightScore: 74 }] };
    clipsService.getExplainability.mockResolvedValue(explainability);

    const result = await controller.getExplainability(user, 'clip-1');

    expect(clipsService.getExplainability).toHaveBeenCalledWith('clip-1', 'user-1');
    expect(result).toBe(explainability);
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
