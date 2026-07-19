import { SocialPlatform } from '@speedora/database';
import type { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: {
    getOverview: jest.Mock;
    getPerformance: jest.Mock;
    getPerformanceClips: jest.Mock;
    getPerformanceVideos: jest.Mock;
  };
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const };

  beforeEach(() => {
    analyticsService = {
      getOverview: jest.fn(),
      getPerformance: jest.fn(),
      getPerformanceClips: jest.fn(),
      getPerformanceVideos: jest.fn(),
    };
    controller = new AnalyticsController(analyticsService as unknown as AnalyticsService);
  });

  it('delegates GET overview to AnalyticsService.getOverview with the requesting user', async () => {
    const overview = { totalVideos: 3 };
    analyticsService.getOverview.mockResolvedValue(overview);

    const result = await controller.getOverview(user);

    expect(analyticsService.getOverview).toHaveBeenCalledWith('user-1');
    expect(result).toBe(overview);
  });

  describe('getPerformance', () => {
    it('parses days/platform/granularity and delegates to the service', async () => {
      await controller.getPerformance(user, '7', SocialPlatform.TIKTOK, 'weekly');

      expect(analyticsService.getPerformance).toHaveBeenCalledWith('user-1', {
        days: 7,
        platform: SocialPlatform.TIKTOK,
        granularity: 'weekly',
      });
    });

    it('falls back to the default days when given an invalid value, instead of throwing', async () => {
      await controller.getPerformance(user, 'not-a-number', undefined, undefined);

      expect(analyticsService.getPerformance).toHaveBeenCalledWith('user-1', {
        days: 30,
        platform: undefined,
        granularity: 'daily',
      });
    });

    it('falls back to undefined platform when given an unrecognized value', async () => {
      await controller.getPerformance(user, '30', 'not-a-real-platform', undefined);

      expect(analyticsService.getPerformance).toHaveBeenCalledWith('user-1', {
        days: 30,
        platform: undefined,
        granularity: 'daily',
      });
    });

    it('falls back to the default granularity when given an unrecognized value', async () => {
      await controller.getPerformance(user, '30', undefined, 'hourly');

      expect(analyticsService.getPerformance).toHaveBeenCalledWith('user-1', {
        days: 30,
        platform: undefined,
        granularity: 'daily',
      });
    });
  });

  describe('getPerformanceClips', () => {
    it('parses days/platform/videoId/limit and delegates to the service', async () => {
      await controller.getPerformanceClips(user, '90', SocialPlatform.YOUTUBE, 'video-1', '10');

      expect(analyticsService.getPerformanceClips).toHaveBeenCalledWith('user-1', {
        days: 90,
        platform: SocialPlatform.YOUTUBE,
        videoId: 'video-1',
        limit: 10,
      });
    });

    it('clamps an out-of-range limit rather than passing it through raw', async () => {
      await controller.getPerformanceClips(user, '30', undefined, undefined, '9999');

      expect(analyticsService.getPerformanceClips).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ limit: 100 }),
      );
    });
  });

  describe('getPerformanceVideos', () => {
    it('parses days/platform/limit and delegates to the service', async () => {
      await controller.getPerformanceVideos(user, '7', SocialPlatform.INSTAGRAM, '5');

      expect(analyticsService.getPerformanceVideos).toHaveBeenCalledWith('user-1', {
        days: 7,
        platform: SocialPlatform.INSTAGRAM,
        limit: 5,
      });
    });
  });
});
