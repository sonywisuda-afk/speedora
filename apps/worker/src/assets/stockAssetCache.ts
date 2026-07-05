// Simple in-memory TTL cache, keyed by search keyword - keeps repeated
// B-roll searches for the same keyword (common across multiple clips from
// the same video, or a recurring topic across videos processed close
// together) from burning through each provider's API quota, per
// StockAssetService's caching requirement. In-memory rather than
// DB-backed: resets on worker restart, an acceptable trade-off since a
// cache miss just re-runs the search (same cost as if caching didn't
// exist) rather than failing anything - no schema/migration needed for
// what's fundamentally a quota-saving optimization, not a source of truth.
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class StockAssetCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  // undefined means "not cached" (a genuine cache miss) - distinct from a
  // cached value that happens to be null (StockAssetService caches "no
  // provider had anything for this keyword" as null, not just a miss).
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
