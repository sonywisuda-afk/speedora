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
});
