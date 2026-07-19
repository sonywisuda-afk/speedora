import type { SocialPlatform } from '@speedora/shared';
import {
  computeLeaderboard,
  computeTopCampaigns,
  computeTopClips,
  computeTopCreators,
  computeTopPlatforms,
  extractMetric,
  type LeaderboardCandidate,
} from './leaderboard.util';

function candidate(overrides: Partial<LeaderboardCandidate> = {}): LeaderboardCandidate {
  return {
    publishRecordId: 'pr-1',
    videoLabel: 'A great hook',
    platform: 'YOUTUBE' as SocialPlatform,
    ownerId: 'user-1',
    ownerEmail: 'a@example.com',
    campaignId: null,
    campaignName: null,
    viewCount: 100,
    likeCount: 10,
    commentCount: 2,
    shareCount: 1,
    engagementScore: 0.13,
    ...overrides,
  };
}

describe('extractMetric', () => {
  it('reads the field matching the requested metric', () => {
    const c = candidate({ viewCount: 500, likeCount: 40, commentCount: 5, shareCount: 3 });
    expect(extractMetric(c, 'views')).toBe(500);
    expect(extractMetric(c, 'likes')).toBe(40);
    expect(extractMetric(c, 'comments')).toBe(5);
    expect(extractMetric(c, 'shares')).toBe(3);
    expect(extractMetric(c, 'engagementScore')).toBe(0.13);
  });
});

describe('computeTopClips', () => {
  it('ranks by the requested metric, descending', () => {
    const rows = computeTopClips(
      [
        candidate({ publishRecordId: 'pr-low', viewCount: 100 }),
        candidate({ publishRecordId: 'pr-high', viewCount: 900 }),
      ],
      'views',
      10,
    );
    expect(rows.map((r) => r.key)).toEqual(['pr-high', 'pr-low']);
  });

  it('breaks ties deterministically by key ascending, not input order', () => {
    const rows = computeTopClips(
      [
        candidate({ publishRecordId: 'pr-z', viewCount: 100 }),
        candidate({ publishRecordId: 'pr-a', viewCount: 100 }),
        candidate({ publishRecordId: 'pr-m', viewCount: 100 }),
      ],
      'views',
      10,
    );
    expect(rows.map((r) => r.key)).toEqual(['pr-a', 'pr-m', 'pr-z']);
  });

  it('produces the same order regardless of input order (determinism)', () => {
    const candidates = [
      candidate({ publishRecordId: 'pr-b', viewCount: 50 }),
      candidate({ publishRecordId: 'pr-a', viewCount: 100 }),
      candidate({ publishRecordId: 'pr-c', viewCount: 50 }),
    ];
    const forward = computeTopClips(candidates, 'views', 10).map((r) => r.key);
    const reversed = computeTopClips([...candidates].reverse(), 'views', 10).map((r) => r.key);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual(['pr-a', 'pr-b', 'pr-c']);
  });

  it('excludes candidates with a null value for the chosen metric', () => {
    const rows = computeTopClips(
      [candidate({ publishRecordId: 'pr-null', viewCount: null })],
      'views',
      10,
    );
    expect(rows).toHaveLength(0);
  });

  it('respects the limit', () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      candidate({ publishRecordId: `pr-${i}`, viewCount: i }),
    );
    expect(computeTopClips(candidates, 'views', 5)).toHaveLength(5);
  });
});

describe('computeTopCreators', () => {
  it('sums a count metric across all of a creator’s records', () => {
    const rows = computeTopCreators(
      [
        candidate({ ownerId: 'user-1', ownerEmail: 'a@example.com', viewCount: 100 }),
        candidate({ ownerId: 'user-1', ownerEmail: 'a@example.com', viewCount: 200 }),
        candidate({ ownerId: 'user-2', ownerEmail: 'b@example.com', viewCount: 50 }),
      ],
      'views',
      10,
    );
    expect(rows[0]).toMatchObject({ key: 'user-1', value: 300, secondaryLabel: '2 publikasi' });
    expect(rows[1]).toMatchObject({ key: 'user-2', value: 50 });
  });

  it('averages engagementScore instead of summing it', () => {
    const rows = computeTopCreators(
      [
        candidate({ ownerId: 'user-1', engagementScore: 0.2 }),
        candidate({ ownerId: 'user-1', engagementScore: 0.4 }),
      ],
      'engagementScore',
      10,
    );
    expect(rows[0].value).toBeCloseTo(0.3);
  });
});

describe('computeTopCampaigns', () => {
  it('excludes records with no campaignId', () => {
    const rows = computeTopCampaigns(
      [
        candidate({ campaignId: null, viewCount: 999 }),
        candidate({ campaignId: 'camp-1', campaignName: 'Launch Week', viewCount: 100 }),
      ],
      'views',
      10,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'camp-1', label: 'Launch Week', value: 100 });
  });
});

describe('computeTopPlatforms', () => {
  it('only ranks platforms with at least one in-window record', () => {
    const rows = computeTopPlatforms(
      [candidate({ platform: 'YOUTUBE' as SocialPlatform, viewCount: 100 })],
      'views',
      10,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('YOUTUBE');
  });
});

describe('computeLeaderboard', () => {
  it('computes all 4 dimensions from a single candidate list', () => {
    const result = computeLeaderboard(
      [candidate({ campaignId: 'camp-1', campaignName: 'Launch Week' })],
      'views',
      10,
    );
    expect(result.topClips).toHaveLength(1);
    expect(result.topCreators).toHaveLength(1);
    expect(result.topCampaigns).toHaveLength(1);
    expect(result.topPlatforms).toHaveLength(1);
  });

  it('returns empty arrays, not an error, for an empty workspace', () => {
    const result = computeLeaderboard([], 'views', 10);
    expect(result).toEqual({ topClips: [], topCreators: [], topCampaigns: [], topPlatforms: [] });
  });
});
