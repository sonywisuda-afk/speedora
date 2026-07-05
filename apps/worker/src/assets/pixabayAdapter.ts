import { fetchJson } from './httpClient';
import type { AssetProvider, StockAsset } from './types';

interface PixabayVideoSize {
  url: string;
  width: number;
  height: number;
  // Confirmed via a real API call (not from Pixabay's own docs, which are
  // stale on this point, nor community-maintained type packages, which
  // describe an older shape using a top-level "picture_id" field the
  // current API no longer returns at all): each size variant carries its
  // own direct thumbnail URL right here.
  thumbnail: string;
}

interface PixabayVideoHit {
  id: number;
  videos: {
    large?: PixabayVideoSize;
    medium?: PixabayVideoSize;
    small?: PixabayVideoSize;
    tiny?: PixabayVideoSize;
  };
}

interface PixabaySearchResponse {
  hits: PixabayVideoHit[];
}

const SEARCH_URL = 'https://pixabay.com/api/videos/';
// Pixabay's API rejects per_page below 3 (400 Bad Request) - only the
// first hit is ever used, the rest are simply discarded.
const PER_PAGE = 3;
// Same reasoning as PexelsAdapter's MIN_ACCEPTABLE_WIDTH.
const MIN_ACCEPTABLE_WIDTH = 480;

// Adapts Pixabay's Video API (https://pixabay.com/api/docs/#api_search_videos)
// to the shared StockAsset shape. Pixabay is a Tier 1 provider alongside
// Pexels in StockAssetService - also rich in real stock VIDEO footage.
export class PixabayAdapter implements AssetProvider {
  readonly name = 'pixabay' as const;

  // PIXABAY_API_KEY is optional (see env.ts) - checked here rather than
  // left to fail at the fetch call, same reasoning as PexelsAdapter.
  async search(keyword: string): Promise<StockAsset | null> {
    const apiKey = process.env.PIXABAY_API_KEY;
    if (!apiKey) return null;

    const url =
      `${SEARCH_URL}?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(keyword)}` +
      `&per_page=${PER_PAGE}`;
    const data = await fetchJson<PixabaySearchResponse>(url);

    const hit = data.hits?.[0];
    return hit ? this.mapToStockAsset(hit) : null;
  }

  // Maps one Pixabay video search hit to a StockAsset - picks the smallest
  // of the large/medium/small/tiny variants that's still >=
  // MIN_ACCEPTABLE_WIDTH (falls back to the largest available), same
  // "don't over-download for a ~2.5s cutaway" reasoning as PexelsAdapter.
  // Pixabay's own naming (tiny/small/medium/large) doesn't reliably
  // correspond to actual pixel dimensions in that order for every hit, so
  // this always sorts by the real width rather than trusting the key name.
  private mapToStockAsset(hit: PixabayVideoHit): StockAsset | null {
    const variants = Object.values(hit.videos).filter((v): v is PixabayVideoSize => Boolean(v));
    const sorted = variants.sort((a, b) => a.width - b.width);
    const chosen = sorted.find((v) => v.width >= MIN_ACCEPTABLE_WIDTH) ?? sorted[sorted.length - 1];
    if (!chosen) return null;

    return {
      id: `pixabay-${hit.id}`,
      url: chosen.url,
      thumbnail: chosen.thumbnail,
      sourceName: 'pixabay',
      resolution: { width: chosen.width, height: chosen.height },
      type: 'video',
    };
  }
}

export const pixabayAdapter = new PixabayAdapter();
