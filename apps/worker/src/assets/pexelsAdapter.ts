import { fetchJson } from './httpClient';
import type { AssetProvider, StockAsset } from './types';

interface PexelsVideoFile {
  link: string;
  width: number;
  height: number;
  file_type: string;
}

interface PexelsVideo {
  id: number;
  image: string;
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  videos: PexelsVideo[];
}

const SEARCH_URL = 'https://api.pexels.com/videos/search';
// Below this, a source video would need heavy upscaling to fill a
// 1080-ish-tall 9:16 crop and starts looking soft - prefer something
// already close. Above it is unnecessary download weight for a ~2.5s
// cutaway that gets scaled/cropped down anyway (see broll.ts's
// BROLL_DURATION_SECONDS).
const MIN_ACCEPTABLE_WIDTH = 480;

// Adapts Pexels' Video Search API
// (https://www.pexels.com/api/documentation/#videos-search) to the shared
// StockAsset shape. Pexels is a Tier 1 provider in StockAssetService - rich
// in real stock VIDEO footage, not just photos, which reads better as a
// B-roll cutaway than a still image.
export class PexelsAdapter implements AssetProvider {
  readonly name = 'pexels' as const;

  // PEXELS_API_KEY is optional (see env.ts) - checked here rather than
  // left to fail at the fetch call so a worker with no key configured
  // doesn't make a doomed network request for every single search.
  async search(keyword: string): Promise<StockAsset | null> {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) return null;

    const url = `${SEARCH_URL}?query=${encodeURIComponent(keyword)}&per_page=1&orientation=portrait`;
    const data = await fetchJson<PexelsSearchResponse>(url, {
      headers: { Authorization: apiKey },
    });

    const video = data.videos?.[0];
    return video ? this.mapToStockAsset(video) : null;
  }

  // Maps one Pexels video search result to a StockAsset. Pexels always
  // returns several resolutions per video (video_files) - picks the
  // smallest one that's still >= MIN_ACCEPTABLE_WIDTH (falls back to the
  // largest available if none qualify) rather than always grabbing the
  // biggest, since the file gets scaled/cropped down to the clip's own
  // output size regardless of how large the source is.
  private mapToStockAsset(video: PexelsVideo): StockAsset | null {
    const files = video.video_files
      .filter((f) => f.file_type === 'video/mp4')
      .sort((a, b) => a.width - b.width);
    const file = files.find((f) => f.width >= MIN_ACCEPTABLE_WIDTH) ?? files[files.length - 1];
    if (!file) return null;

    return {
      id: `pexels-${video.id}`,
      url: file.link,
      thumbnail: video.image,
      sourceName: 'pexels',
      resolution: { width: file.width, height: file.height },
      type: 'video',
    };
  }
}

export const pexelsAdapter = new PexelsAdapter();
