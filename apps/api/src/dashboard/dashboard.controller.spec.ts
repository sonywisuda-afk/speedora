import type { Response } from 'express';
import type { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

describe('DashboardController', () => {
  let controller: DashboardController;
  let dashboardService: {
    getStats: jest.Mock;
    getActivity: jest.Mock;
    removeActivity: jest.Mock;
    removeAllActivity: jest.Mock;
    getExports: jest.Mock;
    exportCsv: jest.Mock;
  };
  const user = {
    id: 'user-1',
    email: 'a@example.com',
    role: 'CREATOR' as const,
    emailVerified: true,
  };

  beforeEach(() => {
    dashboardService = {
      getStats: jest.fn(),
      getActivity: jest.fn(),
      removeActivity: jest.fn(),
      removeAllActivity: jest.fn(),
      getExports: jest.fn(),
      exportCsv: jest.fn(),
    };
    controller = new DashboardController(dashboardService as unknown as DashboardService);
  });

  it('delegates GET stats to DashboardService.getStats with the requesting user', async () => {
    const stats = { totalVideos: 3 };
    dashboardService.getStats.mockResolvedValue(stats);

    const result = await controller.getStats(user);

    expect(dashboardService.getStats).toHaveBeenCalledWith('user-1');
    expect(result).toBe(stats);
  });

  describe('getActivity', () => {
    it('parses limit and delegates to the service', async () => {
      await controller.getActivity(user, undefined, '10');

      expect(dashboardService.getActivity).toHaveBeenCalledWith('user-1', {
        cursor: undefined,
        limit: 10,
        type: undefined,
        q: undefined,
      });
    });

    it('falls back to the default limit when given an invalid value, instead of throwing', async () => {
      await controller.getActivity(user, undefined, 'not-a-number');

      expect(dashboardService.getActivity).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('clamps an out-of-range limit rather than passing it through raw', async () => {
      await controller.getActivity(user, undefined, '9999');

      expect(dashboardService.getActivity).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ limit: 50 }),
      );
    });

    it('passes cursor and q straight through', async () => {
      await controller.getActivity(user, 'event-9', '10', undefined, 'acme');

      expect(dashboardService.getActivity).toHaveBeenCalledWith('user-1', {
        cursor: 'event-9',
        limit: 10,
        type: undefined,
        q: 'acme',
      });
    });

    it('resolves a valid type filter', async () => {
      await controller.getActivity(user, undefined, '10', 'VIDEO_UPLOADED');

      expect(dashboardService.getActivity).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'VIDEO_UPLOADED' }),
      );
    });

    it('degrades an unrecognized type to "no filter" rather than throwing', async () => {
      await controller.getActivity(user, undefined, '10', 'NOT_A_REAL_TYPE');

      expect(dashboardService.getActivity).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: undefined }),
      );
    });
  });

  describe('removeActivity', () => {
    it('delegates to the service with the given ids', async () => {
      const result = { count: 2 };
      dashboardService.removeActivity.mockResolvedValue(result);

      const returned = await controller.removeActivity(user, { ids: ['event-1', 'event-2'] });

      expect(dashboardService.removeActivity).toHaveBeenCalledWith('user-1', [
        'event-1',
        'event-2',
      ]);
      expect(returned).toBe(result);
    });

    it('defaults to an empty ids array when the body has none', async () => {
      await controller.removeActivity(user, {} as never);

      expect(dashboardService.removeActivity).toHaveBeenCalledWith('user-1', []);
    });
  });

  describe('removeAllActivity', () => {
    it('delegates to the service with the requesting user', async () => {
      const result = { count: 37 };
      dashboardService.removeAllActivity.mockResolvedValue(result);

      const returned = await controller.removeAllActivity(user);

      expect(dashboardService.removeAllActivity).toHaveBeenCalledWith('user-1');
      expect(returned).toBe(result);
    });
  });

  // Phase E (Dashboard & Recent Activity) - Export Center visibility.
  it('delegates GET exports to DashboardService.getExports with the requesting user', async () => {
    const exports = { totalExports: 3 };
    dashboardService.getExports.mockResolvedValue(exports);

    const result = await controller.getExports(user);

    expect(dashboardService.getExports).toHaveBeenCalledWith('user-1');
    expect(result).toBe(exports);
  });

  describe('exportCsv', () => {
    it('sends the CSV with the right content type and attachment filename', async () => {
      dashboardService.exportCsv.mockResolvedValue('Section,Metric,Value\n');
      const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;

      await controller.exportCsv(user, res);

      expect(dashboardService.exportCsv).toHaveBeenCalledWith('user-1');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="speedora-report.csv"',
      );
      // UTF-8 BOM-prefixed so Excel (which ignores the Content-Type charset
      // for CSV) doesn't mis-decode non-ASCII text.
      const sent = (res.send as jest.Mock).mock.calls[0][0] as string;
      expect(sent.charCodeAt(0)).toBe(0xfeff);
      expect(sent.slice(1)).toBe('Section,Metric,Value\n');
    });
  });
});
