import { fetchJson } from './httpClient';
import type { AssetProvider, StockAsset } from './types';

interface ClearbitCompany {
  name: string;
  domain: string;
  logo: string;
}

const SUGGEST_URL = 'https://autocomplete.clearbit.com/v1/companies/suggest';
// Clearbit doesn't publish a fixed logo size (it's a live-rendered SVG/PNG
// from the company's own site favicon/og:image) - a placeholder resolution
// only used for StockAsset's shape consistency, never read by the render
// pipeline for a decision (ffmpeg.ts's trimAndFadeInBRoll scales any
// 'image' asset to the clip's own output size regardless).
const PLACEHOLDER_RESOLUTION = { width: 512, height: 512 };

// Adapts Clearbit's free Company Autocomplete API
// (https://dashboard.clearbit.com/docs#autocomplete-api) to the shared
// StockAsset shape - AI B-roll Recommendation (item 8 of the user's own
// gap-analysis list): "kalau pembicara mengatakan OpenAI, sisipkan logo
// otomatis." No API key required (a public, rate-limited endpoint,
// unlike Pexels/Pixabay/Unsplash which each need their own). Deliberately
// NOT one of StockAssetService's own TIER_1/TIER_2 - only searched when
// the caller has already decided a keyword looks like a brand name (see
// broll.ts's looksLikeBrandName()), never blindly tried for every
// keyword the way stock-footage tiers are - a generic keyword like
// "coffee" would still return SOME fuzzy-matched company from Clearbit's
// autocomplete, which would be a wrong/misleading result, not a useful
// logo.
export class LogoAdapter implements AssetProvider {
  readonly name = 'clearbit' as const;

  async search(companyName: string): Promise<StockAsset | null> {
    const url = `${SUGGEST_URL}?query=${encodeURIComponent(companyName)}`;
    const results = await fetchJson<ClearbitCompany[]>(url);

    const company = results[0];
    if (!company?.logo) return null;

    return {
      id: `clearbit-${company.domain}`,
      url: company.logo,
      thumbnail: company.logo,
      sourceName: 'clearbit',
      resolution: PLACEHOLDER_RESOLUTION,
      type: 'image',
    };
  }
}

export const logoAdapter = new LogoAdapter();
