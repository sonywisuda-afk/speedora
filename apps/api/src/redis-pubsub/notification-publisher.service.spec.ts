const publishMock = jest.fn();
const quitMock = jest.fn();
jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    publish: (...args: unknown[]) => publishMock(...args),
    quit: (...args: unknown[]) => quitMock(...args),
  })),
}));

import { NotificationPublisherService } from './notification-publisher.service';

describe('NotificationPublisherService', () => {
  let service: NotificationPublisherService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationPublisherService();
  });

  it('publishes the event as JSON on the shared notifications channel', async () => {
    publishMock.mockResolvedValue(1);

    await service.publish({
      userId: 'user-1',
      notificationId: 'notif-1',
      type: 'UPLOAD_COMPLETE' as never,
    });

    expect(publishMock).toHaveBeenCalledWith(
      'notifications:events',
      JSON.stringify({ userId: 'user-1', notificationId: 'notif-1', type: 'UPLOAD_COMPLETE' }),
    );
  });

  it('quits the client on module destroy', async () => {
    quitMock.mockResolvedValue('OK');

    await service.onModuleDestroy();

    expect(quitMock).toHaveBeenCalled();
  });
});
