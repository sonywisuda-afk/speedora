import { forStage } from '../logger';
import { logoAdapter } from './logoAdapter';
import { pexelsAdapter } from './pexelsAdapter';
import { pixabayAdapter } from './pixabayAdapter';
import { StockAssetCache } from './stockAssetCache';
import type { AssetProvider, StockAsset } from './types';
import { unsplashAdapter } from './unsplashAdapter';

const logger = forStage('stock-asset-service');

// Tier 0: a brand LOGO (AI B-roll Recommendation, item 8) - only ever
// tried when the caller has already decided this keyword looks like a
// brand name (see broll.ts's looksLikeBrandName()); ahead of the
// stock-footage tiers below since a recognized brand's own logo is a
// stronger, more specific B-roll than generic footage for the same word.
const TIER_0: AssetProvider[] = [logoAdapter];
// Tier 1: rich in real stock VIDEO footage - tried first, since a B-roll
// cutaway reads better as a moving clip than a still image whenever a
// video is available for the keyword.
const TIER_1: AssetProvider[] = [pexelsAdapter, pixabayAdapter];
// Tier 2: Unsplash is photo-only - a fallback for when neither video
// provider has anything for this keyword, not a first choice.
const TIER_2: AssetProvider[] = [unsplashAdapter];

// The Adapter pattern's orchestrator: searches every configured provider,
// tier by tier, and returns the first usable StockAsset - callers
// (render-clip.worker.ts) only ever see this one method and the normalized
// StockAsset shape, never a specific provider or its raw API response.
export class StockAssetService {
  private readonly cache = new StockAssetCache<StockAsset | null>();

  // tiers is constructor-injectable (defaults to the real TIER_1/TIER_2
  // above) purely so tests can substitute fake providers without
  // reaching into module internals. logoTier is separate (defaults to
  // the real TIER_0) for the same reason, kept out of `tiers` itself
  // since it's conditionally prepended per-call, not always searched.
  constructor(
    private readonly tiers: AssetProvider[][] = [TIER_1, TIER_2],
    private readonly logoTier: AssetProvider[] = TIER_0,
  ) {}

  // Searches every provider, tier by tier, stopping at the first usable
  // result - null only once every provider in every tier has been tried
  // and found nothing (or none are configured with an API key at all).
  // `isBrandCandidate` (AI B-roll Recommendation, item 8) prepends the
  // logo tier ahead of every other tier when true - the cache key
  // includes it so the SAME keyword can legitimately cache two different
  // results depending on which caller asked (a B-roll moment that looks
  // like a brand name vs. a plain re-search of that same literal string
  // outside that context, however unlikely in practice today).
  //
  // One provider throwing (down, rate-limited, malformed response) is
  // caught HERE and logged, falling through to the next provider in line
  // rather than failing this whole search - the render pipeline never
  // crashes over a single stock-asset provider's outage. A provider
  // simply having nothing to offer is represented by its own search()
  // returning null, not an exception - see AssetProvider's contract.
  async searchAssets(
    keyword: string,
    isBrandCandidate: boolean = false,
  ): Promise<StockAsset | null> {
    const cacheKey = isBrandCandidate ? `brand:${keyword}` : keyword;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const tiers = isBrandCandidate ? [this.logoTier, ...this.tiers] : this.tiers;
    for (const tier of tiers) {
      for (const provider of tier) {
        try {
          const asset = await provider.search(keyword);
          if (asset) {
            this.cache.set(cacheKey, asset);
            return asset;
          }
        } catch (error) {
          logger.warn(
            'provider failed, trying the next provider',
            { provider: provider.name, keyword },
            error,
          );
        }
      }
    }

    // Caching the negative result too (not just successful hits) is what
    // actually saves quota for a keyword nothing has footage for - without
    // this, every clip mentioning that same keyword would re-query all
    // three providers again.
    this.cache.set(cacheKey, null);
    return null;
  }
}

export const stockAssetService = new StockAssetService();
