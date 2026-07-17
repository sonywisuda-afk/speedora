const subscribeMock = jest.fn();
const quitMock = jest.fn();
const onMock = jest.fn();
jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    subscribe: (...args: unknown[]) => subscribeMock(...args),
    quit: (...args: unknown[]) => quitMock(...args),
    on: (...args: unknown[]) => onMock(...args),
  })),
}));

import { NotificationSubscriberService } from './notification-subscriber.service';

describe('NotificationSubscriberService', () => {
  let service: NotificationSubscriberService;

  beforeEach(() => {
    jest.clearAllMocks();
    subscribeMock.mockResolvedValue(undefined);
    quitMock.mockResolvedValue('OK');
    service = new NotificationSubscriberService();
  });

  it('subscribes to the shared channel on module init', async () => {
    await service.onModuleInit();

    expect(subscribeMock).toHaveBeenCalledWith('notifications:events');
    expect(onMock).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('forwards a valid JSON message onto stream$', async () => {
    await service.onModuleInit();
    const messageHandler = onMock.mock.calls.find(([event]) => event === 'message')?.[1];

    const received: unknown[] = [];
    service.stream$.subscribe((event) => received.push(event));

    const event = { userId: 'user-1', notificationId: 'notif-1', type: 'UPLOAD_COMPLETE' };
    messageHandler('notifications:events', JSON.stringify(event));

    expect(received).toEqual([event]);
  });

  it('drops a malformed message without crashing the shared subscriber', async () => {
    await service.onModuleInit();
    const messageHandler = onMock.mock.calls.find(([event]) => event === 'message')?.[1];

    const received: unknown[] = [];
    service.stream$.subscribe((event) => received.push(event));

    expect(() => messageHandler('notifications:events', 'not json')).not.toThrow();
    expect(received).toEqual([]);
  });

  it('quits the client on module destroy', async () => {
    await service.onModuleDestroy();

    expect(quitMock).toHaveBeenCalled();
  });
});
