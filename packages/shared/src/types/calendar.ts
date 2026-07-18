import type { PublishStatus, SocialPlatform } from './social';

// Publishing Expansion Phase 6D (Calendar view) - a read-only,
// workspace-scoped rollup of PublishRecord rows for a date range
// (GET /workspaces/:id/calendar?start=&end=). `date` is server-computed
// (`publishedAt ?? scheduledAt ?? createdAt`) so the frontend never needs
// to duplicate that fallback logic - see WorkspaceService.getCalendar.
export interface CalendarEntryDto {
  id: string;
  clipId: string;
  clipHookText: string | null;
  platform: SocialPlatform;
  status: PublishStatus;
  date: string;
  campaignId: string | null;
  campaignName: string | null;
  errorMessage: string | null;
}

export interface CalendarDto {
  entries: CalendarEntryDto[];
}
