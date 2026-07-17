import { matchesUser, toMessageEvent } from './notification-realtime.util';

describe('matchesUser', () => {
  it('returns true when the event userId matches', () => {
    expect(
      matchesUser(
        { userId: 'user-1', notificationId: 'notif-1', type: 'UPLOAD_COMPLETE' as never },
        'user-1',
      ),
    ).toBe(true);
  });

  it('returns false when the event userId belongs to someone else', () => {
    expect(
      matchesUser(
        { userId: 'user-2', notificationId: 'notif-1', type: 'UPLOAD_COMPLETE' as never },
        'user-1',
      ),
    ).toBe(false);
  });
});

describe('toMessageEvent', () => {
  it('wraps the event as SSE MessageEvent data', () => {
    const event = { userId: 'user-1', notificationId: 'notif-1', type: 'UPLOAD_COMPLETE' as never };

    expect(toMessageEvent(event)).toEqual({ data: event });
  });
});
