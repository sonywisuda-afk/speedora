import { SocialPlatform } from '@speedora/shared';
import {
  getMetricCapability,
  isMetricAvailable,
  PLATFORM_CAPABILITY,
  type MetricKey,
} from './platform-capability.util';

const ALL_METRICS: MetricKey[] = [
  'views',
  'likes',
  'comments',
  'shares',
  'watchTime',
  'followerCount',
];

describe('PLATFORM_CAPABILITY', () => {
  it('has an entry for every metric on every platform', () => {
    for (const platform of Object.values(SocialPlatform)) {
      for (const metric of ALL_METRICS) {
        expect(PLATFORM_CAPABILITY[platform][metric]).toBeDefined();
      }
    }
  });

  it('always includes a reason when a metric is not available', () => {
    for (const platform of Object.values(SocialPlatform)) {
      for (const metric of ALL_METRICS) {
        const entry = PLATFORM_CAPABILITY[platform][metric];
        if (entry.availability !== 'available') {
          expect(entry.reason).toBeTruthy();
        }
      }
    }
  });
});

describe('isMetricAvailable', () => {
  it('is true for a metric with real data (YouTube views)', () => {
    expect(isMetricAvailable(SocialPlatform.YOUTUBE, 'views')).toBe(true);
  });

  it('is false for a platform-impossible metric (TikTok watch time)', () => {
    expect(isMetricAvailable(SocialPlatform.TIKTOK, 'watchTime')).toBe(false);
  });

  it('is false for a needs-reconnect metric (TikTok follower count)', () => {
    expect(isMetricAvailable(SocialPlatform.TIKTOK, 'followerCount')).toBe(false);
  });
});

describe('getMetricCapability', () => {
  it('flags TikTok follower count as needs-reconnect, not a hard unavailable', () => {
    const entry = getMetricCapability(SocialPlatform.TIKTOK, 'followerCount');
    expect(entry.availability).toBe('needs-reconnect');
  });

  it('flags Instagram watch time as available with a scalar-not-curve caveat', () => {
    const entry = getMetricCapability(SocialPlatform.INSTAGRAM, 'watchTime');
    expect(entry.availability).toBe('available');
    expect(entry.note).toBeTruthy();
  });
});
