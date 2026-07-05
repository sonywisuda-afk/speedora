// Fase 16 (Multi-Provider Stock Assets) - the normalized shape every
// AssetProvider adapter maps its own API's response into. Consumers
// (StockAssetService, render-clip.worker.ts, ffmpeg.ts) only ever see this
// shape, never a provider's raw response - that's the entire point of the
// Adapter pattern here: adding, removing, or reordering stock providers
// never touches the download/render pipeline, which only knows about
// StockAsset.
export interface StockAsset {
  // Provider-prefixed (e.g. "pexels-12345") so ids from different
  // providers can never collide if ever stored/compared together.
  id: string;
  // Direct, downloadable file URL - a video file for 'video', an image
  // file for 'image'.
  url: string;
  // Small preview image URL - descriptive metadata only, never read by the
  // render pipeline itself.
  thumbnail: string;
  sourceName: 'pexels' | 'pixabay' | 'unsplash';
  resolution: { width: number; height: number };
  // Pexels/Pixabay results are always 'video'; Unsplash is photo-only, so
  // its adapter always maps to 'image'. ffmpeg.ts's trimAndFadeInBRoll
  // branches on this (loop a still image for the cutaway's duration vs.
  // play/trim a video clip) instead of needing to know which provider an
  // asset came from - see CLAUDE.md's Fase 16 section.
  type: 'video' | 'image';
}

// One adapter per stock provider - implements this same interface so
// StockAssetService can iterate providers generically with no
// provider-specific branching anywhere in the orchestrator or the render
// pipeline.
//
// search() returns null for "nothing usable" (no API key configured, no
// search results, an unexpected/unmapped response shape) - not an error.
// A genuine network/API failure (timeout, non-2xx status, rate limit) is
// allowed to throw (see httpClient.ts's fetchJson) so
// StockAssetService.searchAssets's per-provider try/catch can log it and
// fall through to the next provider in line, rather than a real outage
// being silently indistinguishable from "no results".
export interface AssetProvider {
  readonly name: 'pexels' | 'pixabay' | 'unsplash';
  search(keyword: string): Promise<StockAsset | null>;
}
