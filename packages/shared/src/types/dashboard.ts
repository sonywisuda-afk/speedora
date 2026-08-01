import type { ExportJobDto, ExportType } from './export';

// Sprint 1-2 (Dashboard Redesign, Product Experience track). Mirrors
// ActivityEventType in packages/database's Prisma schema - the Dashboard's
// user-facing Activity Timeline, distinct from VideoStatusEvent (an
// internal pipeline audit trail, not exposed to the frontend at all).
export enum ActivityEventType {
  VIDEO_UPLOADED = 'VIDEO_UPLOADED',
  CLIP_GENERATED = 'CLIP_GENERATED',
  CLIP_EXPORTED = 'CLIP_EXPORTED',
  MEMBER_INVITED = 'MEMBER_INVITED',
  // Workspace Lifecycle Management roadmap - see WORKSPACE_DELETED's own
  // comment in schema.prisma for why this is recorded userId-scoped here.
  WORKSPACE_DELETED = 'WORKSPACE_DELETED',
}

export interface ActivityEventDto {
  id: string;
  type: ActivityEventType;
  videoId: string | null;
  clipId: string | null;
  // Free-form display context (e.g. { title } for a video/clip that may
  // since have been deleted) - see ActivityEvent.metadata's own comment in
  // schema.prisma.
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DashboardActivityDto {
  events: ActivityEventDto[];
}

// Statistics Row. avgProcessingTimeSeconds is null when no video has
// reached a terminal status (RENDERED/FAILED) yet - "no data," not "zero
// seconds." storageUsedBytes sums Video.sourceSizeBytes + Clip.outputSizeBytes
// for this owner only (see schema.prisma's comment on why this is cheap from
// Postgres alone, unlike packages/storage's bucket-wide getBucketUsage()).
export interface DashboardStatsDto {
  totalVideos: number;
  totalClips: number;
  avgProcessingTimeSeconds: number | null;
  storageUsedBytes: number;
  monthlyVideos: number;
  monthlyClips: number;
  // Count of this user's PAID PremiumCredit rows created this calendar
  // month - reuses the existing premium-transcription credit system rather
  // than a new generic quota concept (explicit product decision).
  premiumCreditsThisMonth: number;
}

// Phase E (Dashboard & Recent Activity) - fed by GET /dashboard/exports, a
// dashboard-facing rollup over ExportJob distinct from ExportService.listRecent
// (which is scoped to one videoId/type for the per-video Export Center tabs).
// All-time counts, same convention as DashboardStatsDto.totalVideos/totalClips
// above - not windowed.
export interface DashboardExportsDto {
  // Newest 10, any video/type - reuses ExportJobDto as-is (same shape GET
  // /export already returns), no separate dashboard-only DTO for the rows
  // themselves.
  recentExports: ExportJobDto[];
  totalExports: number;
  // "Queue status" - jobs enqueued but not yet picked up by a worker.
  pendingCount: number;
  // "Running jobs" - jobs a worker is actively rendering right now.
  processingCount: number;
  failedCount: number;
  // Denominator context for successRate below.
  readyCount: number;
  // readyCount / (readyCount + failedCount) - null when neither has ever
  // happened yet ("no data," not "0%"), same convention as
  // DashboardStatsDto.avgProcessingTimeSeconds above.
  successRate: number | null;
  // Most recent READY job's updatedAt - "Last download" relabeled honestly
  // as "last export became ready," since no click-through download event is
  // recorded anywhere in this codebase (GET /export/:id/download is a plain
  // stream, not tracked).
  lastReadyAt: string | null;
  // Every ExportType member present, 0 where the user has never used one.
  exportsByType: Record<ExportType, number>;
}

// PendingInviteRole/PendingInviteDto moved to ./workspace as part of
// Sprint 5A (Collaboration Foundation) - the invite flow is now a real,
// Workspace-scoped lifecycle (see WorkspaceRole/PendingInviteDto there),
// not the display-only stub this used to back.

export interface SearchVideoResult {
  videoId: string;
  title: string | null;
  createdAt: string;
}

export interface SearchClipResult {
  clipId: string;
  videoId: string;
  hookText: string | null;
  hashtags: string[];
}

// TranscriptSegment is video-scoped only (not tied to any one Clip - a
// clip's transcript is derived by time-range query, see database.md), so a
// transcript match surfaces the video it belongs to, not a clip.
export interface SearchTranscriptResult {
  videoId: string;
  start: number;
  end: number;
  text: string;
}

export interface SearchResultsDto {
  videos: SearchVideoResult[];
  clips: SearchClipResult[];
  transcriptMatches: SearchTranscriptResult[];
}
