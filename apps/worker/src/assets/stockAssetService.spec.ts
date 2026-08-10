import { StockAssetService } from './stockAssetService';
import type { AssetProvider, StockAsset } from './types';

function fakeAsset(sourceName: StockAsset['sourceName']): StockAsset {
  return {
    id: `${sourceName}-1`,
    url: `https://example.com/${sourceName}.mp4`,
    thumbnail: `https://example.com/${sourceName}-thumb.jpg`,
    sourceName,
    resolution: { width: 640, height: 1136 },
    type: 'video',
  };
}

function fakeProvider(name: AssetProvider['name']): jest.Mocked<AssetProvider> {
  return { name, search: jest.fn() };
}

describe('StockAssetService', () => {
  it('returns the first Tier 1 provider result without trying anything else', async () => {
    const pexels = fakeProvider('pexels');
    const pixabay = fakeProvider('pixabay');
    const unsplash = fakeProvider('unsplash');
    pexels.search.mockResolvedValue(fakeAsset('pexels'));

    const service = new StockAssetService([[pexels, pixabay], [unsplash]]);
    const result = await service.searchAssets('sunset');

    expect(result?.sourceName).toBe('pexels');
    expect(pixabay.search).not.toHaveBeenCalled();
    expect(unsplash.search).not.toHaveBeenCalled();
  });

  it('falls through to the next provider in the same tier when the first finds nothing', async () => {
    const pexels = fakeProvider('pexels');
    const pixabay = fakeProvider('pixabay');
    pexels.search.mockResolvedValue(null);
    pixabay.search.mockResolvedValue(fakeAsset('pixabay'));

    const service = new StockAssetService([[pexels, pixabay]]);
    const result = await service.searchAssets('sunset');

    expect(result?.sourceName).toBe('pixabay');
  });

  it('falls through to Tier 2 only once every Tier 1 provider has nothing', async () => {
    const pexels = fakeProvider('pexels');
    const pixabay = fakeProvider('pixabay');
    const unsplash = fakeProvider('unsplash');
    pexels.search.mockResolvedValue(null);
    pixabay.search.mockResolvedValue(null);
    unsplash.search.mockResolvedValue(fakeAsset('unsplash'));

    const service = new StockAssetService([[pexels, pixabay], [unsplash]]);
    const result = await service.searchAssets('sunset');

    expect(result?.sourceName).toBe('unsplash');
  });

  it('catches a provider throwing (down/rate-limited) and falls through to the next one instead of rejecting', async () => {
    const pexels = fakeProvider('pexels');
    const pixabay = fakeProvider('pixabay');
    pexels.search.mockRejectedValue(new Error('rate limited'));
    pixabay.search.mockResolvedValue(fakeAsset('pixabay'));

    const service = new StockAssetService([[pexels, pixabay]]);
    const result = await service.searchAssets('sunset');

    expect(result?.sourceName).toBe('pixabay');
  });

  it('returns null once every provider in every tier has nothing (or all threw)', async () => {
    const pexels = fakeProvider('pexels');
    const unsplash = fakeProvider('unsplash');
    pexels.search.mockRejectedValue(new Error('down'));
    unsplash.search.mockResolvedValue(null);

    const service = new StockAssetService([[pexels], [unsplash]]);
    const result = await service.searchAssets('an-obscure-keyword');

    expect(result).toBeNull();
  });

  it('caches a successful result and never calls any provider again for the same keyword', async () => {
    const pexels = fakeProvider('pexels');
    pexels.search.mockResolvedValue(fakeAsset('pexels'));

    const service = new StockAssetService([[pexels]]);
    await service.searchAssets('sunset');
    await service.searchAssets('sunset');

    expect(pexels.search).toHaveBeenCalledTimes(1);
  });

  it('caches a null result too, so a keyword nothing has footage for is not re-queried', async () => {
    const pexels = fakeProvider('pexels');
    pexels.search.mockResolvedValue(null);

    const service = new StockAssetService([[pexels]]);
    await service.searchAssets('an-obscure-keyword');
    await service.searchAssets('an-obscure-keyword');

    expect(pexels.search).toHaveBeenCalledTimes(1);
  });

  // AI B-roll Recommendation (item 8) - isBrandCandidate prepends the logo
  // tier ahead of every other tier.
  describe('isBrandCandidate', () => {
    it('does not try the logo tier at all when isBrandCandidate is false (the default)', async () => {
      const clearbit = fakeProvider('clearbit');
      const pexels = fakeProvider('pexels');
      pexels.search.mockResolvedValue(fakeAsset('pexels'));

      const service = new StockAssetService([[pexels]], [clearbit]);
      const result = await service.searchAssets('coffee');

      expect(result?.sourceName).toBe('pexels');
      expect(clearbit.search).not.toHaveBeenCalled();
    });

    it('tries the logo tier first when isBrandCandidate is true, ahead of every other tier', async () => {
      const clearbit = fakeProvider('clearbit');
      const pexels = fakeProvider('pexels');
      clearbit.search.mockResolvedValue(fakeAsset('clearbit'));

      const service = new StockAssetService([[pexels]], [clearbit]);
      const result = await service.searchAssets('OpenAI', true);

      expect(result?.sourceName).toBe('clearbit');
      expect(pexels.search).not.toHaveBeenCalled();
    });

    it('falls through to the normal stock-footage tiers when isBrandCandidate is true but the logo tier finds nothing', async () => {
      const clearbit = fakeProvider('clearbit');
      const pexels = fakeProvider('pexels');
      clearbit.search.mockResolvedValue(null);
      pexels.search.mockResolvedValue(fakeAsset('pexels'));

      const service = new StockAssetService([[pexels]], [clearbit]);
      const result = await service.searchAssets('OpenAI', true);

      expect(result?.sourceName).toBe('pexels');
    });

    it('caches the brand-candidate and non-brand-candidate results for the same literal keyword separately', async () => {
      const clearbit = fakeProvider('clearbit');
      const pexels = fakeProvider('pexels');
      clearbit.search.mockResolvedValue(fakeAsset('clearbit'));
      pexels.search.mockResolvedValue(fakeAsset('pexels'));

      const service = new StockAssetService([[pexels]], [clearbit]);
      const brandResult = await service.searchAssets('Apple', true);
      const plainResult = await service.searchAssets('Apple', false);

      expect(brandResult?.sourceName).toBe('clearbit');
      expect(plainResult?.sourceName).toBe('pexels');
    });
  });
});
