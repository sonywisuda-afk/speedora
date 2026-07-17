import { isOutOfPurchasedCredit, isStorageOverQuota } from './alert-conditions';

describe('isStorageOverQuota', () => {
  it('returns true when usage exceeds the threshold ratio of quota', () => {
    expect(isStorageOverQuota(900, 1000)).toBe(true);
  });

  it('returns false when usage is under the threshold ratio', () => {
    expect(isStorageOverQuota(700, 1000)).toBe(false);
  });

  it('returns false exactly at the boundary (uses >, not >=)', () => {
    expect(isStorageOverQuota(800, 1000)).toBe(false);
  });

  it('returns false when quotaBytes is null (no quota configured)', () => {
    expect(isStorageOverQuota(999999, null)).toBe(false);
  });

  it('returns false when quotaBytes is zero or negative', () => {
    expect(isStorageOverQuota(100, 0)).toBe(false);
    expect(isStorageOverQuota(100, -1)).toBe(false);
  });
});

describe('isOutOfPurchasedCredit', () => {
  it('returns true when unspent credit count is exactly 0', () => {
    expect(isOutOfPurchasedCredit(0)).toBe(true);
  });

  it('returns false when at least one credit remains', () => {
    expect(isOutOfPurchasedCredit(1)).toBe(false);
    expect(isOutOfPurchasedCredit(5)).toBe(false);
  });
});
