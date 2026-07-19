import type { SocialPlatform } from '@speedora/shared';
import {
  computeCampaignPlatformBreakdown,
  computeCampaignTotals,
  type CampaignAnalyticsRecord,
} from './campaign-analytics.util';

function record(overrides: Partial<CampaignAnalyticsRecord> = {}): CampaignAnalyticsRecord {
  return {
    platform: 'YOUTUBE' as SocialPlatform,
    viewCount: 100,
    likeCount: 10,
    commentCount: 2,
    shareCount: 1,
    engagementScore: 0.13,
    ...overrides,
  };
}

describe('computeCampaignTotals', () => {
  it('handles a campaign with no PUBLISHED records - zeros/null, not an error', () => {
    const totals = computeCampaignTotals([]);
    expect(totals).toEqual({
      publishCount: 0,
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      averageEngagementScore: null,
    });
  });

  it('sums count metrics and averages engagementScore across records', () => {
    const totals = computeCampaignTotals([
      record({ viewCount: 100, likeCount: 10, commentCount: 2, shareCount: 1, engagementScore: 0.2 }),
      record({ viewCount: 200, likeCount: 20, commentCount: 4, shareCount: 2, engagementScore: 0.4 }),
    ]);
    expect(totals.publishCount).toBe(2);
    expect(totals.totalViews).toBe(300);
    expect(totals.totalLikes).toBe(30);
    expect(totals.totalComments).toBe(6);
    expect(totals.totalShares).toBe(3);
    expect(totals.averageEngagementScore).toBeCloseTo(0.3);
  });

  it('treats a null metric as 0 for sums, but excludes it from the engagementScore average', () => {
    const totals = computeCampaignTotals([
      record({ viewCount: null, engagementScore: null }),
      record({ viewCount: 100, engagementScore: 0.5 }),
    ]);
    expect(totals.totalViews).toBe(100);
    expect(totals.averageEngagementScore).toBe(0.5);
  });
});

describe('computeCampaignPlatformBreakdown', () => {
  it('returns an empty array for a campaign with no PUBLISHED records', () => {
    expect(computeCampaignPlatformBreakdown([])).toEqual([]);
  });

  it('groups by platform and reuses computeCampaignTotals for each group (no separate summation logic)', () => {
    const rows = computeCampaignPlatformBreakdown([
      record({ platform: 'YOUTUBE' as SocialPlatform, viewCount: 100 }),
      record({ platform: 'YOUTUBE' as SocialPlatform, viewCount: 200 }),
      record({ platform: 'TIKTOK' as SocialPlatform, viewCount: 50 }),
    ]);

    const youtube = rows.find((r) => r.platform === 'YOUTUBE')!;
    const tiktok = rows.find((r) => r.platform === 'TIKTOK')!;
    expect(youtube).toMatchObject({ publishCount: 2, totalViews: 300 });
    expect(tiktok).toMatchObject({ publishCount: 1, totalViews: 50 });
  });

  it('only includes platforms that actually have a record - no fabricated zero-rows', () => {
    const rows = computeCampaignPlatformBreakdown([record({ platform: 'YOUTUBE' as SocialPlatform })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe('YOUTUBE');
  });
});
