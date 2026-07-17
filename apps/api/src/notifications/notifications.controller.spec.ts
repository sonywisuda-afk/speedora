import { Subject, take } from 'rxjs';
import type { NotificationPublishEvent } from '@speedora/database';
import type { NotificationSubscriberService } from '../redis-pubsub/notification-subscriber.service';
import type { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let notificationsService: {
    list: jest.Mock;
    unreadCount: jest.Mock;
    markRead: jest.Mock;
    markAllRead: jest.Mock;
    getPreferences: jest.Mock;
    updatePreference: jest.Mock;
  };
  let subject: Subject<NotificationPublishEvent>;
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const };

  beforeEach(() => {
    notificationsService = {
      list: jest.fn(),
      unreadCount: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
      getPreferences: jest.fn(),
      updatePreference: jest.fn(),
    };
    subject = new Subject<NotificationPublishEvent>();
    controller = new NotificationsController(
      notificationsService as unknown as NotificationsService,
      { stream$: subject.asObservable() } as unknown as NotificationSubscriberService,
    );
  });

  describe('list', () => {
    it('forwards the requester id and a default limit of 20', async () => {
      notificationsService.list.mockResolvedValue({ notifications: [] });

      await controller.list(user, undefined);

      expect(notificationsService.list).toHaveBeenCalledWith('user-1', 20);
    });

    it('clamps an out-of-range limit into [1, 100]', async () => {
      notificationsService.list.mockResolvedValue({ notifications: [] });

      await controller.list(user, '500');

      expect(notificationsService.list).toHaveBeenCalledWith('user-1', 100);
    });
  });

  describe('unreadCount', () => {
    it('forwards the requester id', async () => {
      notificationsService.unreadCount.mockResolvedValue({ count: 2 });

      const result = await controller.unreadCount(user);

      expect(notificationsService.unreadCount).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ count: 2 });
    });
  });

  describe('markAllRead', () => {
    it('forwards the requester id', async () => {
      notificationsService.markAllRead.mockResolvedValue({ count: 4 });

      const result = await controller.markAllRead(user);

      expect(notificationsService.markAllRead).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ count: 4 });
    });
  });

  describe('markRead', () => {
    it('forwards the id and the requester id', async () => {
      notificationsService.markRead.mockResolvedValue(undefined);

      await controller.markRead(user, 'notif-1');

      expect(notificationsService.markRead).toHaveBeenCalledWith('notif-1', 'user-1');
    });

    it('propagates the not-found error from the service', async () => {
      notificationsService.markRead.mockRejectedValue(new Error('not found'));

      await expect(controller.markRead(user, 'missing')).rejects.toThrow('not found');
    });
  });

  describe('stream (Milestone 04c)', () => {
    it('only forwards events matching the connected user, ignoring other users', (done) => {
      const received: unknown[] = [];
      const sub = controller
        .stream(user)
        .pipe(take(1))
        .subscribe((message) => {
          received.push(message);
          sub.unsubscribe();
          expect(received).toEqual([
            { data: { userId: 'user-1', notificationId: 'notif-1', type: 'UPLOAD_COMPLETE' } },
          ]);
          done();
        });

      // Wrong user first - must not be the one that resolves take(1).
      subject.next({
        userId: 'user-2',
        notificationId: 'notif-x',
        type: 'UPLOAD_COMPLETE' as never,
      });
      subject.next({
        userId: 'user-1',
        notificationId: 'notif-1',
        type: 'UPLOAD_COMPLETE' as never,
      });
    });
  });

  describe('getPreferences', () => {
    it('forwards the requester id', async () => {
      notificationsService.getPreferences.mockResolvedValue({ preferences: [] });

      const result = await controller.getPreferences(user);

      expect(notificationsService.getPreferences).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ preferences: [] });
    });
  });

  describe('updatePreference', () => {
    it('forwards the requester id, type, and dto', async () => {
      notificationsService.updatePreference.mockResolvedValue({
        type: 'RENDER_FAILED',
        enabled: true,
        toast: false,
      });

      await controller.updatePreference(user, 'RENDER_FAILED', { toast: false });

      expect(notificationsService.updatePreference).toHaveBeenCalledWith(
        'user-1',
        'RENDER_FAILED',
        {
          toast: false,
        },
      );
    });

    it('propagates a BadRequestException from the service for an invalid type', async () => {
      notificationsService.updatePreference.mockRejectedValue(new Error('bad type'));

      await expect(
        controller.updatePreference(user, 'NOT_A_REAL_TYPE', { enabled: false }),
      ).rejects.toThrow('bad type');
    });
  });
});
