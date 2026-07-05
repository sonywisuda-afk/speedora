import { fetchJson } from './httpClient';
import type { AssetProvider, StockAsset } from './types';

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  urls: { regular: string; thumb: string };
  // Per Unsplash's API Guidelines
  // (https://help.unsplash.com/en/articles/2511258-guideline-triggering-a-download),
  // this is the endpoint to GET whenever a photo is actually used (not
  // just displayed in search results) - registers the download for the
  // photographer's stats/attribution, required for API compliance.
  links: { download_location: string };
}

interface UnsplashSearchResponse {
  results: UnsplashPhoto[];
}

const SEARCH_URL = 'https://api.unsplash.com/search/photos';
const DOWNLOAD_TRACKING_TIMEOUT_MS = 5000;

// Adapts Unsplash's Search Photos API
// (https://unsplash.com/documentation#search-photos) to the shared
// StockAsset shape. Unsplash is Tier 2 in StockAssetService - photo-only
// (no video content at all), so it's only tried once neither Tier 1 video
// provider (Pexels/Pixabay) has anything for a keyword.
export class UnsplashAdapter implements AssetProvider {
  readonly name = 'unsplash' as const;

  // UNSPLASH_ACCESS_KEY is optional (see env.ts) - checked here rather
  // than left to fail at the fetch call, same reasoning as the other two
  // adapters.
  async search(keyword: string): Promise<StockAsset | null> {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) return null;

    const url = `${SEARCH_URL}?query=${encodeURIComponent(keyword)}&per_page=1`;
    const data = await fetchJson<UnsplashSearchResponse>(url, {
      headers: { Authorization: `Client-ID ${accessKey}` },
    });

    const photo = data.results?.[0];
    if (!photo) return null;

    // Fire-and-forget, per Unsplash's own guidance ("trigger the endpoint
    // asynchronously so it doesn't slow down your user's interactions") -
    // this is a required compliance ping, not something the render
    // pipeline should ever wait on or fail over. A failure here (network
    // blip, revoked key) is swallowed, not propagated - it must never turn
    // "found a usable photo" into a thrown error.
    this.triggerDownloadTracking(photo.links.download_location, accessKey);

    return this.mapToStockAsset(photo);
  }

  private triggerDownloadTracking(downloadLocation: string, accessKey: string): void {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TRACKING_TIMEOUT_MS);

    fetch(downloadLocation, {
      headers: { Authorization: `Client-ID ${accessKey}` },
      signal: controller.signal,
    })
      .catch((error) => {
        console.warn('[unsplash-adapter] download-tracking ping failed (non-fatal):', error);
      })
      .finally(() => clearTimeout(timeoutId));
  }

  // Maps one Unsplash search result to a StockAsset - `regular` (a
  // capped-width JPEG, not the full multi-megapixel original) is plenty
  // for a ~2.5s B-roll cutaway that gets scaled/cropped down to the
  // clip's own output size regardless.
  private mapToStockAsset(photo: UnsplashPhoto): StockAsset {
    return {
      id: `unsplash-${photo.id}`,
      url: photo.urls.regular,
      thumbnail: photo.urls.thumb,
      sourceName: 'unsplash',
      resolution: { width: photo.width, height: photo.height },
      type: 'image',
    };
  }
}

export const unsplashAdapter = new UnsplashAdapter();
