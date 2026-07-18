import type { ContractSocialPlatform } from '@speedora/contracts';

// Publishing Expansion Phase 7B (AI SEO). Approximate 2026-era per-platform
// tone/length conventions baked into the prompt (see generate-platform-copy.ts)
// - hand-authored, not scraped from each platform's live current docs, same
// honesty caveat already used for the OAuth phases' platform-specific field
// names. `includesDescription` is false for platforms whose caption IS the
// post (LinkedIn's long-form post, TikTok/Instagram/Threads/X's short
// caption) - only YouTube (a real video description field) and Pinterest
// (a short SEO-style description) get a non-null `description`.
export interface PlatformGuidance {
  captionGuidance: string;
  hashtagCountGuidance: string;
  includesDescription: boolean;
  descriptionGuidance?: string;
}

export const PLATFORM_GUIDANCE: Record<ContractSocialPlatform, PlatformGuidance> = {
  TIKTOK: {
    captionGuidance: 'a punchy, casual, hook-first caption under ~150 characters',
    hashtagCountGuidance: '3-5',
    includesDescription: false,
  },
  INSTAGRAM: {
    captionGuidance:
      'an engaging Reels caption, ideally under ~300 characters even though Instagram allows much more',
    hashtagCountGuidance: '5-10',
    includesDescription: false,
  },
  FACEBOOK: {
    captionGuidance: 'a friendly, community-oriented caption under ~400 characters',
    hashtagCountGuidance: '2-4',
    includesDescription: false,
  },
  THREADS: {
    captionGuidance: 'a conversational, discussion-starting caption under ~500 characters',
    hashtagCountGuidance: '2-4',
    includesDescription: false,
  },
  YOUTUBE: {
    captionGuidance: 'a short, keyword-rich title under ~100 characters',
    hashtagCountGuidance: '3-5',
    includesDescription: true,
    descriptionGuidance:
      'a real video description (a few sentences to a short paragraph) summarizing the clip and inviting viewers to watch/subscribe',
  },
  LINKEDIN: {
    captionGuidance:
      'a professional, authoritative caption - this IS the full post, so it can run several short paragraphs',
    hashtagCountGuidance: '3-5',
    includesDescription: false,
  },
  PINTEREST: {
    captionGuidance: 'a keyword-rich, save-for-later-style caption under ~500 characters',
    hashtagCountGuidance: '2-5',
    includesDescription: true,
    descriptionGuidance:
      'a short, keyword-dense description (1-2 sentences) optimized for Pinterest search',
  },
  X: {
    captionGuidance: 'a punchy caption strictly under 280 characters total, including hashtags',
    hashtagCountGuidance: '1-2',
    includesDescription: false,
  },
};
