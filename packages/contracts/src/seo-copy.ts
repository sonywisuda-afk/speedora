import { z } from 'zod';
import { SOCIAL_PLATFORMS } from './platform-fit';

// Publishing Expansion Phase 7B (AI SEO - per-platform LLM-generated copy).
// A brand-new, standalone LLM call - explicitly NOT part of the frozen
// detect-clips selection/scoring call, never reads/writes Clip.scores/
// viralityScore/highlightScore. Only consumes already-computed Clip fields
// (hookText/topics/keywords/ctaText/reason) - deliberately does NOT re-send
// the full transcript, keeping this call cheap and independent of
// detect-clips' own data needs. See @speedora/seo-copy's own
// generatePlatformCopy() for the actual LLM call, same stateless "pure
// input -> output" module shape as @speedora/clip-scoring's
// scoreClipCandidates().
export const seoCopyInputSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  hookText: z.string(),
  topics: z.array(z.string()),
  keywords: z.array(z.string()),
  ctaText: z.string(),
  reason: z.string(),
});
export type SeoCopyInput = z.infer<typeof seoCopyInputSchema>;

// description is null for platforms whose caption IS the post (LinkedIn,
// TikTok/Instagram/Threads/X short-form) - only YouTube/Pinterest-style
// platforms get a real separate description. See
// @speedora/seo-copy's platform-guidance.ts for exactly which platforms
// produce one.
export const seoCopyOutputSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()),
  description: z.string().nullable(),
});
export type SeoCopyOutput = z.infer<typeof seoCopyOutputSchema>;
