import type { SocialPlatform } from './social';

// Publishing Expansion Phase 7B (AI SEO - per-platform LLM-generated copy).
// Real TS enum (not a string-literal type union) - same convention as
// ExportJobStatus, needed for class-validator's @IsEnum() to work against a
// real runtime object.
export enum ClipPlatformCopyStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}

// The client-facing shape for one ClipPlatformCopy row. Append-only, same
// "on-demand generated artifact" shape as ExportJobDto (deliberately NOT
// PublishRecord's ownership/execution-unit shape) - every Generate/
// Regenerate click creates a new row rather than updating one in place, so
// this DTO always represents exactly one generation attempt, not a
// per-platform singleton. "Current" copy for a platform is resolved
// client-side as the latest row by createdAt (see lib/platform-copy.ts's
// latestPlatformCopy()).
export interface ClipPlatformCopyDto {
  id: string;
  clipId: string;
  platform: SocialPlatform;
  status: ClipPlatformCopyStatus;
  caption: string | null;
  hashtags: string[];
  // Null for platforms whose caption IS the post (see
  // @speedora/seo-copy's platform-guidance.ts) - not every READY row has one.
  description: string | null;
  failReason: string | null;
  createdAt: string;
}

// GET /clips/:id/platform-copy returns every row for the clip, newest
// first - wrapped (not a bare array), same list-response convention as
// ExportJobListDto/CampaignListDto/etc.
export interface ClipPlatformCopyListDto {
  copies: ClipPlatformCopyDto[];
}
