import { recordActivityEvent } from './activity';

describe('recordActivityEvent', () => {
  it('creates one ActivityEvent row with the given type', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = { activityEvent: { create } };

    await recordActivityEvent(prisma as never, {
      userId: 'user-1',
      type: 'VIDEO_UPLOADED' as never,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'VIDEO_UPLOADED',
        videoId: null,
        clipId: null,
        metadata: undefined,
        title: 'Video diunggah',
        description: 'video tanpa judul',
      },
    });
  });

  it('includes videoId/clipId/metadata when given', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = { activityEvent: { create } };

    await recordActivityEvent(prisma as never, {
      userId: 'user-1',
      type: 'CLIP_GENERATED' as never,
      videoId: 'video-1',
      clipId: 'clip-1',
      metadata: { title: 'My Video' },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'CLIP_GENERATED',
        videoId: 'video-1',
        clipId: 'clip-1',
        metadata: { title: 'My Video' },
        title: 'Klip baru berhasil dibuat',
        description: null,
      },
    });
  });

  // Activity Timeline v2 - title/description are denormalized here (from
  // type+metadata via packages/shared's describeActivityEvent) so
  // GET /dashboard/activity's search has real text to `contains` against -
  // see ActivityEvent.title's own schema comment.
  it('denormalizes title/description from type+metadata for every real ActivityEventType', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = { activityEvent: { create } };

    await recordActivityEvent(prisma as never, {
      userId: 'user-1',
      type: 'WORKSPACE_DELETED' as never,
      metadata: { workspaceId: 'ws-1', name: 'Acme' },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Menghapus workspace',
        description: 'Acme',
      }),
    });
  });
});
