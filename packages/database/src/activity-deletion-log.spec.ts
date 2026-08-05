import { recordActivityDeletionLog } from './activity-deletion-log';

describe('recordActivityDeletionLog', () => {
  it('creates a DELETE_SELECTED row with the deleted ids', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = { activityDeletionLog: { create } };

    await recordActivityDeletionLog(prisma as never, {
      userId: 'user-1',
      action: 'DELETE_SELECTED' as never,
      deletedIds: ['event-1', 'event-2'],
      count: 2,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'DELETE_SELECTED',
        deletedIds: ['event-1', 'event-2'],
        count: 2,
      },
    });
  });

  it('creates a DELETE_ALL row with no deletedIds', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = { activityDeletionLog: { create } };

    await recordActivityDeletionLog(prisma as never, {
      userId: 'user-1',
      action: 'DELETE_ALL' as never,
      count: 37,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'DELETE_ALL',
        deletedIds: undefined,
        count: 37,
      },
    });
  });
});
