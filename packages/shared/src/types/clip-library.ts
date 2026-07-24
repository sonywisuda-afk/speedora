import type { Clip } from './video';
import type { SocialPlatform } from './social';

// AI Clip Library roadmap (P1) - the first cross-video, filterable clip
// listing this app has ever had (clips were previously only ever nested
// under a single Video). Mirrors the existing cursor-pagination shape used
// by PaginatedVideos (apps/web/lib/api.ts) rather than inventing a new one.
export interface ClipLibraryPageDto {
  clips: Clip[];
  nextCursor: string | null;
}

// Duration is expressed in seconds, matching Clip.durationSeconds/
// startTime/endTime's own unit - no separate "bucket" enum on the wire,
// the filter bar UI maps its bucket buttons to a min/max pair itself.
export interface ClipLibraryFilterParams {
  workspaceId?: string;
  projectId?: string;
  folderId?: string;
  minScore?: number;
  platform?: SocialPlatform;
  minDuration?: number;
  maxDuration?: number;
  topics?: string[];
  emotion?: string;
  keyword?: string;
  cursor?: string;
  limit?: number;
}

// GET /clips/facets - topics/keywords have no fixed taxonomy (free-text
// LLM output, see schema.prisma's Clip.topics comment), so the filter UI
// needs real, workspace-scoped option values rather than a hardcoded list.
export interface ClipLibraryFacetValue {
  value: string;
  count: number;
}

export interface ClipLibraryFacetsDto {
  topics: ClipLibraryFacetValue[];
}
