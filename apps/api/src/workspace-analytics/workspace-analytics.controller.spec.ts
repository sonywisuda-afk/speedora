import type { WorkspaceAnalyticsService } from './workspace-analytics.service';
import { WorkspaceAnalyticsController } from './workspace-analytics.controller';

describe('WorkspaceAnalyticsController', () => {
  let controller: WorkspaceAnalyticsController;
  let workspaceAnalytics: { getLeaderboard: jest.Mock };
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const };

  beforeEach(() => {
    workspaceAnalytics = { getLeaderboard: jest.fn() };
    controller = new WorkspaceAnalyticsController(
      workspaceAnalytics as unknown as WorkspaceAnalyticsService,
    );
  });

  describe('getLeaderboard', () => {
    it('parses metric/days/limit and delegates to the service', async () => {
      await controller.getLeaderboard(user, 'ws-1', 'likes', '90', '5');

      expect(workspaceAnalytics.getLeaderboard).toHaveBeenCalledWith('user-1', 'ws-1', {
        metric: 'likes',
        days: 90,
        limit: 5,
      });
    });

    it('falls back to defaults for missing/invalid params, instead of throwing', async () => {
      await controller.getLeaderboard(user, 'ws-1', 'not-a-metric', 'not-a-number', undefined);

      expect(workspaceAnalytics.getLeaderboard).toHaveBeenCalledWith('user-1', 'ws-1', {
        metric: 'engagementScore',
        days: 30,
        limit: 10,
      });
    });

    it('caps limit at 20 even if a client asks for more', async () => {
      await controller.getLeaderboard(user, 'ws-1', undefined, undefined, '500');

      expect(workspaceAnalytics.getLeaderboard).toHaveBeenCalledWith(
        'user-1',
        'ws-1',
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('floors limit at 1 for a zero/negative value', async () => {
      await controller.getLeaderboard(user, 'ws-1', undefined, undefined, '0');

      expect(workspaceAnalytics.getLeaderboard).toHaveBeenCalledWith(
        'user-1',
        'ws-1',
        expect.objectContaining({ limit: 1 }),
      );
    });
  });
});
