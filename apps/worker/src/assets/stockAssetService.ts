import { pexelsAdapter } from './pexelsAdapter';
import { pixabayAdapter } from './pixabayAdapter';
import { StockAssetCache } from './stockAssetCache';
import type { AssetProvider, StockAsset } from './types';
import { unsplashAdapter } from './unsplashAdapter';

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
  // reaching into module internals.
  constructor(private readonly tiers: AssetProvider[][] = [TIER_1, TIER_2]) {}

  // Searches every provider, tier by tier, stopping at the first usable
  // result - null only once every provider in every tier has been tried
  // and found nothing (or none are configured with an API key at all).
  //
  // One provider throwing (down, rate-limited, malformed response) is
  // caught HERE and logged, falling through to the next provider in line
  // rather than failing this whole search - the render pipeline never
  // crashes over a single stock-asset provider's outage. A provider
  // simply having nothing to offer is represented by its own search()
  // returning null, not an exception - see AssetProvider's contract.
  async searchAssets(keyword: string): Promise<StockAsset | null> {
    const cached = this.cache.get(keyword);
    if (cached !== undefined) return cached;

    for (const tier of this.tiers) {
      for (const provider of tier) {
        try {
          const asset = await provider.search(keyword);
          if (asset) {
            this.cache.set(keyword, asset);
            return asset;
          }
        } catch (error) {
          console.warn(
            `[stock-asset-service] ${provider.name} failed for "${keyword}", trying the next provider:`,
            error,
          );
        }
      }
    }

    // Caching the negative result too (not just successful hits) is what
    // actually saves quota for a keyword nothing has footage for - without
    // this, every clip mentioning that same keyword would re-query all
    // three providers again.
    this.cache.set(keyword, null);
    return null;
  }
}

export const stockAssetService = new StockAssetService();
