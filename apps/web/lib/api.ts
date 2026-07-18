import type {
  AnalyticsOverviewDto,
  AnalyticsPerformanceClipsDto,
  AnalyticsPerformanceDto,
  AnalyticsPerformanceVideosDto,
  ApprovalDto,
  ApprovalListDto,
  AuditLogListDto,
  BrandKitDto,
  CampaignDetailDto,
  CampaignDto,
  CampaignListDto,
  Clip,
  ClipExplainabilityDto,
  ClipPlatformCopyDto,
  ClipPlatformCopyListDto,
  ClipPlatformFitDto,
  ClipVersionListDto,
  CommentAttachmentDto,
  CommentDto,
  CommentListDto,
  DashboardActivityDto,
  DashboardStatsDto,
  ExportJobDto,
  ExportJobListDto,
  ExportType,
  NotificationChannel,
  NotificationListDto,
  NotificationPreferenceDto,
  NotificationPreferenceListDto,
  NotificationType,
  NotificationUnreadCountDto,
  NotificationWebhookDto,
  NotificationWebhookListDto,
  OpsAiCalibrationDto,
  OpsAiCorrelationDto,
  OpsAiDistributionDto,
  OpsAiDriftDto,
  OpsAiHealthDto,
  OpsAiReadinessDto,
  OpsAiSignalsDto,
  PaginatedVideos,
  PendingInviteDto,
  PremiumCheckoutResult,
  PremiumCreditAvailability,
  PublishRecord,
  RecurringScheduleDto,
  RecurringScheduleListDto,
  SearchResultsDto,
  ShareLinkCreatedDto,
  ShareLinkListDto,
  ShareRole,
  SharedVideoDto,
  SocialAccount,
  SocialPlatform,
  TranscriptionProvider,
  TranscriptSegment,
  UpdateClipInput,
  UpdateNotificationPreferenceDto,
  UserRole,
  Video,
  VideoWithClips,
  WorkspaceDetailDto,
  WorkspaceDto,
  WorkspaceListDto,
  WorkspaceRole,
} from '@speedora/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface UserDto {
  id: string;
  email: string;
  role: UserRole;
}

// Aliased, not redefined - these are the API/UI-facing DTOs contract-shared
// with apps/api via packages/shared (see CLAUDE.md's packages/shared
// convention). Kept under their old local names so the existing pages don't
// need touching.
export type ClipDto = Clip;
export type VideoDto = Video;
export type VideoWithClipsDto = VideoWithClips;

// Exported (not just used internally) so lib/api.server.ts's cookie-
// forwarding server fetch can reuse the same response-parsing/error-message
// convention as every browser call below, instead of a second copy.
export async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    throw new Error(typeof message === 'string' ? message : 'Request failed');
  }
  return body as T;
}

// The auth session lives in an httpOnly cookie set by apps/api, so every
// request needs credentials: 'include' to send/receive it cross-origin.
function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, { ...init, credentials: 'include' });
}

export async function register(email: string, password: string): Promise<UserDto> {
  const res = await apiFetch('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return parseJsonOrThrow<UserDto>(res);
}

export async function login(email: string, password: string): Promise<UserDto> {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return parseJsonOrThrow<UserDto>(res);
}

export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' });
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  const res = await apiFetch('/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return parseJsonOrThrow<{ message: string }>(res);
}

export async function resetPassword(token: string, newPassword: string): Promise<UserDto> {
  const res = await apiFetch('/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
  return parseJsonOrThrow<UserDto>(res);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await apiFetch('/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  await parseJsonOrThrow<{ success: boolean }>(res);
}

// Permanently deletes the logged-in user's account and everything it owns.
// 204 No Content on success; the session cookie is cleared server-side.
export async function deleteAccount(): Promise<void> {
  const res = await apiFetch('/auth/me', { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    throw new Error(typeof message === 'string' ? message : 'Gagal menghapus akun');
  }
}

export async function me(): Promise<UserDto | null> {
  const res = await apiFetch('/auth/me');
  if (res.status === 401) return null;
  return parseJsonOrThrow<UserDto>(res);
}

// XHR instead of fetch() - fetch has no cross-browser way to observe
// upload (request body) progress, only download progress. The upload flow
// needs real byte-level percentage for its progress bar, not a fake timer.
export function uploadVideo(
  file: File,
  provider: TranscriptionProvider,
  options?: { onProgress?: (percent: number) => void; signal?: AbortSignal },
): Promise<VideoDto> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('transcriptionProvider', provider);

  return new Promise<VideoDto>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/videos`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) options?.onProgress?.((e.loaded / e.total) * 100);
    };

    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON response - message extraction below falls back to statusText
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as VideoDto);
        return;
      }
      const message =
        body && typeof body === 'object' && 'message' in body ? body.message : xhr.statusText;
      reject(new Error(typeof message === 'string' ? message : 'Upload gagal. Coba lagi.'));
    };

    xhr.onerror = () => reject(new Error('Upload terhenti karena masalah koneksi. Coba lagi.'));
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));

    options?.signal?.addEventListener('abort', () => xhr.abort());

    xhr.send(formData);
  });
}

// Alternate to uploadVideo() - the actual download happens in apps/worker
// (import-youtube job), so this returns almost immediately with status
// IMPORTING. Same polling contract as every other stage: the caller just
// starts hitting getVideo(id) the same way it would after uploadVideo().
export async function importYoutubeVideo(
  url: string,
  provider: TranscriptionProvider,
): Promise<VideoDto> {
  const res = await apiFetch('/videos/import-youtube', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, transcriptionProvider: provider }),
  });
  return parseJsonOrThrow<VideoDto>(res);
}

export async function getVideo(id: string): Promise<VideoWithClipsDto> {
  const res = await apiFetch(`/videos/${id}`);
  return parseJsonOrThrow<VideoWithClipsDto>(res);
}

export async function retryVideo(id: string): Promise<VideoWithClipsDto> {
  const res = await apiFetch(`/videos/${id}/retry`, { method: 'POST' });
  return parseJsonOrThrow<VideoWithClipsDto>(res);
}

// Permanently deletes a video, its clips, and their files. 204 No Content on
// success - nothing to parse, but a non-2xx (e.g. 404 for someone else's
// video) still needs to surface as an error.
export async function deleteVideo(id: string): Promise<void> {
  const res = await apiFetch(`/videos/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    throw new Error(typeof message === 'string' ? message : 'Gagal menghapus video');
  }
}

export async function getVideoTranscript(id: string): Promise<TranscriptSegment[]> {
  const res = await apiFetch(`/videos/${id}/transcript`);
  return parseJsonOrThrow<TranscriptSegment[]>(res);
}

// Product Experience performance pass - GET /videos is now cursor-paginated
// (see PaginatedVideos in packages/shared) rather than returning every video
// a user has ever created on every 2s poll.
export async function listVideos(params?: {
  cursor?: string;
  limit?: number;
  workspaceId?: string;
}): Promise<PaginatedVideos> {
  const query = new URLSearchParams();
  if (params?.cursor) query.set('cursor', params.cursor);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.workspaceId) query.set('workspaceId', params.workspaceId);
  const qs = query.toString();
  const res = await apiFetch(`/videos${qs ? `?${qs}` : ''}`);
  return parseJsonOrThrow<PaginatedVideos>(res);
}

export function clipDownloadUrl(downloadUrl: string): string {
  return `${API_URL}${downloadUrl}`;
}

// Inline-playback variant of clipDownloadUrl for a <video> preview - the
// download endpoint serves Content-Disposition: attachment (which browsers
// refuse to play as media) and has no Range support; this one streams
// inline with Range, same contract as videoSourceUrl below.
export function clipStreamUrl(clipId: string): string {
  return `${API_URL}/clips/${clipId}/stream`;
}

// Used directly as a <video src>, not fetched - the browser's own media
// pipeline issues the (possibly many, while scrubbing) Range requests
// against this URL. crossOrigin="use-credentials" on the <video> element is
// what makes the session cookie actually go out cross-origin (api runs on a
// different port than web).
export function videoSourceUrl(videoId: string): string {
  return `${API_URL}/videos/${videoId}/source`;
}

// Product Experience roadmap - `thumbnailUrl` is already a relative
// `/videos/:id/thumbnail` / `/clips/:id/thumbnail` endpoint path (see
// VideosService.mapVideoWithClips/ClipsService.toDto()), same
// "prepend API_URL" convention as clipDownloadUrl above - callers should
// only call these when the DTO's thumbnailUrl is non-null.
export function videoThumbnailUrl(thumbnailUrl: string): string {
  return `${API_URL}${thumbnailUrl}`;
}

export function clipThumbnailUrl(thumbnailUrl: string): string {
  return `${API_URL}${thumbnailUrl}`;
}

// Phase 3 (Animated Thumbnail roadmap) - same "prepend API_URL to an
// already-relative endpoint path" treatment as videoThumbnailUrl/
// clipThumbnailUrl above.
export function videoAnimatedThumbnailUrl(animatedThumbnailUrl: string): string {
  return `${API_URL}${animatedThumbnailUrl}`;
}

export function clipAnimatedThumbnailUrl(animatedThumbnailUrl: string): string {
  return `${API_URL}${animatedThumbnailUrl}`;
}

// Phase 3 (Hover Preview roadmap) - same "prepend API_URL to an
// already-relative endpoint path" treatment as videoThumbnailUrl/
// clipThumbnailUrl above. Callers should only fetch this on-demand (hover/
// focus intent, see lib/useHoverPreview.ts), never eagerly.
export function videoHoverPreviewUrl(hoverPreviewUrl: string): string {
  return `${API_URL}${hoverPreviewUrl}`;
}

export function clipHoverPreviewUrl(hoverPreviewUrl: string): string {
  return `${API_URL}${hoverPreviewUrl}`;
}

// Phase 3 (Storyboard roadmap) - same "prepend API_URL to an already-relative
// endpoint path" treatment as videoThumbnailUrl/clipThumbnailUrl above, one
// call per entry in Video.storyboardFrameUrls/Clip.storyboardFrameUrls.
export function videoStoryboardFrameUrl(frameUrl: string): string {
  return `${API_URL}${frameUrl}`;
}

export function clipStoryboardFrameUrl(frameUrl: string): string {
  return `${API_URL}${frameUrl}`;
}

export async function updateClip(clipId: string, input: UpdateClipInput): Promise<Clip> {
  const res = await apiFetch(`/clips/${clipId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<Clip>(res);
}

// Enqueues a re-render with the clip's current (server-side) startTime/
// endTime - callers must updateClip() first if there are unsaved local
// edits, otherwise the render uses whatever was last saved.
export async function renderClip(clipId: string): Promise<Clip> {
  const res = await apiFetch(`/clips/${clipId}/render`, { method: 'POST' });
  return parseJsonOrThrow<Clip>(res);
}

// Milestone 4 (AI Explainability) - a focused read of a clip's Fusion
// Engine output. `getVideo`/`listVideos` already return every highlight*
// field per clip (cheap, already loaded for the clip list/timeline
// overview) - this is only called for the currently-selected clip's detail
// panel, so a per-clip round trip is worth it for a page most users won't
// select every clip on.
export async function getClipExplainability(clipId: string): Promise<ClipExplainabilityDto> {
  const res = await apiFetch(`/clips/${clipId}/explainability`);
  return parseJsonOrThrow<ClipExplainabilityDto>(res);
}

// Publishing Expansion Phase 7A (AI SEO - Platform-Fit Recommendation) -
// same "per-clip round trip only when the user actually looks" reasoning as
// getClipExplainability above.
export async function getClipPlatformFit(clipId: string): Promise<ClipPlatformFitDto> {
  const res = await apiFetch(`/clips/${clipId}/platform-fit`);
  return parseJsonOrThrow<ClipPlatformFitDto>(res);
}

// Publishing Expansion Phase 7B (AI SEO) - append-only: every call (whether
// the user is clicking "Generate" for the first time or "Regenerate") is
// the exact same POST, creating a new ClipPlatformCopy row rather than
// updating one in place - see ClipsService.generatePlatformCopy.
export async function generatePlatformCopy(
  clipId: string,
  platform: SocialPlatform,
): Promise<ClipPlatformCopyDto> {
  const res = await apiFetch(`/clips/${clipId}/platform-copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform }),
  });
  return parseJsonOrThrow<ClipPlatformCopyDto>(res);
}

export async function listClipPlatformCopies(clipId: string): Promise<ClipPlatformCopyListDto> {
  const res = await apiFetch(`/clips/${clipId}/platform-copy`);
  return parseJsonOrThrow<ClipPlatformCopyListDto>(res);
}

// Permanently deletes one clip (not the parent video or its sibling clips).
// 204 No Content on success.
export async function deleteClip(clipId: string): Promise<void> {
  const res = await apiFetch(`/clips/${clipId}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    throw new Error(typeof message === 'string' ? message : 'Gagal menghapus klip');
  }
}

export async function listSocialAccounts(): Promise<SocialAccount[]> {
  const res = await apiFetch('/social/accounts');
  return parseJsonOrThrow<SocialAccount[]>(res);
}

export async function disconnectSocialAccount(id: string): Promise<void> {
  await apiFetch(`/social/accounts/${id}`, { method: 'DELETE' });
}

// Manual "publish now" (Fase 6b), or a scheduled future publish (Fase 6c)
// when scheduledAt (ISO 8601) is passed - kicks off (or schedules) the
// publish-clip job for one already-connected account. Returns the created
// PublishRecord immediately (status QUEUED, or SCHEDULED if scheduledAt was
// given); the caller polls getVideo()/listVideos() same as render/
// transcribe status to see it move through PUBLISHING/PUBLISHED/FAILED.
// Phase 6 (Scheduling) - options carries the two optional associations added
// to PublishClipDto: campaignId (just stamped onto the record) and
// recurringScheduleId (server computes scheduledAt from the schedule's next
// open slot and ignores any client-supplied scheduledAt - see
// ClipsService.publish()).
export async function publishClip(
  clipId: string,
  socialAccountId: string,
  scheduledAt?: string,
  options?: { campaignId?: string; recurringScheduleId?: string },
): Promise<PublishRecord> {
  const res = await apiFetch(`/clips/${clipId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      socialAccountId,
      scheduledAt,
      campaignId: options?.campaignId,
      recurringScheduleId: options?.recurringScheduleId,
    }),
  });
  return parseJsonOrThrow<PublishRecord>(res);
}

// Cancel a publish that hasn't fired yet (Fase 6c) - only works while the
// record is still SCHEDULED.
export async function cancelScheduledPublish(clipId: string, recordId: string): Promise<void> {
  await apiFetch(`/clips/${clipId}/publish/${recordId}`, { method: 'DELETE' });
}

// Move a scheduled publish's time (Fase 6c) - only works while the record
// is still SCHEDULED.
export async function reschedulePublish(
  clipId: string,
  recordId: string,
  scheduledAt: string,
): Promise<PublishRecord> {
  const res = await apiFetch(`/clips/${clipId}/publish/${recordId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scheduledAt }),
  });
  return parseJsonOrThrow<PublishRecord>(res);
}

// Phase 6 (Scheduling) - Campaign CRUD. Status/clipCount/platformCount/
// progress are all server-derived (see CampaignsService), never sent by
// the client.
export async function listCampaigns(workspaceId: string): Promise<CampaignListDto> {
  const res = await apiFetch(`/workspaces/${workspaceId}/campaigns`);
  return parseJsonOrThrow<CampaignListDto>(res);
}

export async function getCampaign(id: string): Promise<CampaignDetailDto> {
  const res = await apiFetch(`/campaigns/${id}`);
  return parseJsonOrThrow<CampaignDetailDto>(res);
}

export async function createCampaign(
  workspaceId: string,
  input: { name: string; description?: string; tag?: string; startDate: string; endDate: string },
): Promise<CampaignDto> {
  const res = await apiFetch(`/workspaces/${workspaceId}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<CampaignDto>(res);
}

export async function updateCampaign(
  id: string,
  input: Partial<{
    name: string;
    description: string;
    tag: string;
    startDate: string;
    endDate: string;
  }>,
): Promise<CampaignDto> {
  const res = await apiFetch(`/campaigns/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<CampaignDto>(res);
}

export async function cancelCampaign(id: string): Promise<CampaignDto> {
  const res = await apiFetch(`/campaigns/${id}/cancel`, { method: 'POST' });
  return parseJsonOrThrow<CampaignDto>(res);
}

// Phase 6 (Scheduling) - RecurringSchedule CRUD. `platform`/`socialAccountId`
// aren't editable after creation (see UpdateRecurringScheduleDto) - delete
// and recreate instead.
export async function listRecurringSchedules(
  workspaceId: string,
): Promise<RecurringScheduleListDto> {
  const res = await apiFetch(`/workspaces/${workspaceId}/recurring-schedules`);
  return parseJsonOrThrow<RecurringScheduleListDto>(res);
}

export async function getRecurringSchedule(id: string): Promise<RecurringScheduleDto> {
  const res = await apiFetch(`/recurring-schedules/${id}`);
  return parseJsonOrThrow<RecurringScheduleDto>(res);
}

export async function createRecurringSchedule(
  workspaceId: string,
  input: {
    name: string;
    platform: SocialPlatform;
    socialAccountId: string;
    timezone: string;
    daysOfWeek: number[];
    timeOfDay: string;
  },
): Promise<RecurringScheduleDto> {
  const res = await apiFetch(`/workspaces/${workspaceId}/recurring-schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<RecurringScheduleDto>(res);
}

export async function updateRecurringSchedule(
  id: string,
  input: Partial<{
    name: string;
    timezone: string;
    daysOfWeek: number[];
    timeOfDay: string;
    active: boolean;
  }>,
): Promise<RecurringScheduleDto> {
  const res = await apiFetch(`/recurring-schedules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<RecurringScheduleDto>(res);
}

export async function deleteRecurringSchedule(id: string): Promise<void> {
  await apiFetch(`/recurring-schedules/${id}`, { method: 'DELETE' });
}

// Not fetched - used directly as an <a href> so the browser does a real
// top-level navigation (OAuth needs an actual redirect to the platform,
// which a fetch() can't do). The session cookie still goes out on this kind
// of navigation - see CLAUDE.md's "Publish Center" section. Multi-Platform
// Publishing Expansion, Phase 0 - one generic helper replacing
// connectYouTubeUrl/connectTikTokUrl/connectInstagramUrl, mirroring
// apps/api's social.controller.ts collapsing its 3 duplicated route pairs
// into one dynamic `:platform` pair.
export function connectPlatformUrl(platform: SocialPlatform): string {
  return `${API_URL}/social/${platform.toLowerCase()}/connect`;
}

// Starts a Midtrans Snap transaction for one premium (OpenAI Whisper)
// transcription credit - returns a token for the client-side Snap.js popup
// (see lib/midtransSnap.ts), not a redirect. 503 if MIDTRANS_* isn't
// configured server-side yet (surfaces as a thrown Error via
// parseJsonOrThrow, same as every other "integration not configured" case).
export async function createPremiumCheckout(): Promise<PremiumCheckoutResult> {
  const res = await apiFetch('/payments/premium-transcription/checkout', { method: 'POST' });
  return parseJsonOrThrow<PremiumCheckoutResult>(res);
}

// Whether the user currently has a paid, unspent premium credit - polled
// after a Snap checkout to wait for apps/api's Midtrans webhook (the actual
// source of truth) to confirm payment, since Snap's own onSuccess/onPending
// callbacks fire from the browser and don't by themselves mean the credit
// is usable yet.
export async function getPremiumTranscriptionStatus(): Promise<PremiumCreditAvailability> {
  const res = await apiFetch('/payments/premium-transcription/status');
  return parseJsonOrThrow<PremiumCreditAvailability>(res);
}

// Milestone 5A (Analytics Dashboard - Overview) - aggregated, per-user
// totals/breakdowns/trend, scoped server-side to the logged-in user.
export async function getAnalyticsOverview(): Promise<AnalyticsOverviewDto> {
  const res = await apiFetch('/analytics/overview');
  return parseJsonOrThrow<AnalyticsOverviewDto>(res);
}

// Milestone 5B (Analytics Dashboard - Performance).
export interface PerformanceFilterParams {
  days?: 7 | 30 | 90;
  platform?: SocialPlatform;
}

// Named param interfaces (PerformanceFilterParams etc.) have no index
// signature by design (we want each caller's param object fully typed) -
// this accepts an already-known-safe plain-value record and is only ever
// called with one, via an explicit cast at each call site below rather than
// weakening the public param types with an index signature.
function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export async function getAnalyticsPerformance(
  params: PerformanceFilterParams = {},
): Promise<AnalyticsPerformanceDto> {
  const res = await apiFetch(
    `/analytics/performance${toQueryString(params as Record<string, string | number | undefined>)}`,
  );
  return parseJsonOrThrow<AnalyticsPerformanceDto>(res);
}

export async function getAnalyticsPerformanceClips(
  params: PerformanceFilterParams & { videoId?: string; limit?: number } = {},
): Promise<AnalyticsPerformanceClipsDto> {
  const res = await apiFetch(
    `/analytics/performance/clips${toQueryString(params as Record<string, string | number | undefined>)}`,
  );
  return parseJsonOrThrow<AnalyticsPerformanceClipsDto>(res);
}

export async function getAnalyticsPerformanceVideos(
  params: PerformanceFilterParams & { limit?: number } = {},
): Promise<AnalyticsPerformanceVideosDto> {
  const res = await apiFetch(
    `/analytics/performance/videos${toQueryString(params as Record<string, string | number | undefined>)}`,
  );
  return parseJsonOrThrow<AnalyticsPerformanceVideosDto>(res);
}

// Milestone 5C-B (AI Operations Dashboard) - system-wide, role-gated
// (GET /ops/ai/*). No query params (an all-time snapshot, matching M1.5's
// own scripts having no time filter). A 403 here means the signed-in user
// isn't ADMIN/AI_ENGINEER/OPERATOR - the /ops/ai page handles that
// specifically rather than treating it as a generic error.
export async function getOpsAiHealth(): Promise<OpsAiHealthDto> {
  const res = await apiFetch('/ops/ai/health');
  return parseJsonOrThrow<OpsAiHealthDto>(res);
}

export async function getOpsAiSignals(): Promise<OpsAiSignalsDto> {
  const res = await apiFetch('/ops/ai/signals');
  return parseJsonOrThrow<OpsAiSignalsDto>(res);
}

export async function getOpsAiDistribution(): Promise<OpsAiDistributionDto> {
  const res = await apiFetch('/ops/ai/distribution');
  return parseJsonOrThrow<OpsAiDistributionDto>(res);
}

export async function getOpsAiCorrelation(): Promise<OpsAiCorrelationDto> {
  const res = await apiFetch('/ops/ai/correlation');
  return parseJsonOrThrow<OpsAiCorrelationDto>(res);
}

export async function getOpsAiCalibration(): Promise<OpsAiCalibrationDto> {
  const res = await apiFetch('/ops/ai/calibration');
  return parseJsonOrThrow<OpsAiCalibrationDto>(res);
}

export async function getOpsAiDrift(): Promise<OpsAiDriftDto> {
  const res = await apiFetch('/ops/ai/drift');
  return parseJsonOrThrow<OpsAiDriftDto>(res);
}

export async function getOpsAiReadiness(): Promise<OpsAiReadinessDto> {
  const res = await apiFetch('/ops/ai/readiness');
  return parseJsonOrThrow<OpsAiReadinessDto>(res);
}

// Sprint 1-2 (Dashboard Redesign) - Statistics Row.
export async function getDashboardStats(): Promise<DashboardStatsDto> {
  const res = await apiFetch('/dashboard/stats');
  return parseJsonOrThrow<DashboardStatsDto>(res);
}

// Activity Timeline.
export async function getDashboardActivity(limit?: number): Promise<DashboardActivityDto> {
  const res = await apiFetch(`/dashboard/activity${toQueryString({ limit })}`);
  return parseJsonOrThrow<DashboardActivityDto>(res);
}

// Not fetched - used directly as an <a href>/window.location target so the
// browser handles the download, same convention as clipDownloadUrl.
export function dashboardExportCsvUrl(): string {
  return `${API_URL}/dashboard/export.csv`;
}

// Search bar - videos/clips/transcript matches, all owner-scoped server-side.
export async function search(query: string): Promise<SearchResultsDto> {
  const res = await apiFetch(`/search${toQueryString({ q: query })}`);
  return parseJsonOrThrow<SearchResultsDto>(res);
}

// Sprint 5A (Collaboration Foundation) - replaces the old Sprint 1-2
// "Invite Member" stub (listTeamInvites/POST /team/invites, now retired)
// with a real Workspace/Membership/Invite API.
export async function listWorkspaces(): Promise<WorkspaceListDto> {
  const res = await apiFetch('/workspaces');
  return parseJsonOrThrow<WorkspaceListDto>(res);
}

export async function createWorkspace(name: string): Promise<WorkspaceDto> {
  const res = await apiFetch('/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow<WorkspaceDto>(res);
}

export async function getWorkspace(id: string): Promise<WorkspaceDetailDto> {
  const res = await apiFetch(`/workspaces/${id}`);
  return parseJsonOrThrow<WorkspaceDetailDto>(res);
}

// Sprint 5F (Audit Log) - ADMIN+-only server-side.
export async function listWorkspaceAuditLog(
  workspaceId: string,
  params?: { cursor?: string; limit?: number },
): Promise<AuditLogListDto> {
  const query = new URLSearchParams();
  if (params?.cursor) query.set('cursor', params.cursor);
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  const res = await apiFetch(`/workspaces/${workspaceId}/audit-log${qs ? `?${qs}` : ''}`);
  return parseJsonOrThrow<AuditLogListDto>(res);
}

export async function createWorkspaceInvite(
  workspaceId: string,
  email: string,
  role: WorkspaceRole,
): Promise<PendingInviteDto> {
  const res = await apiFetch(`/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
  return parseJsonOrThrow<PendingInviteDto>(res);
}

export async function listWorkspaceInvites(
  workspaceId: string,
): Promise<{ invites: PendingInviteDto[] }> {
  const res = await apiFetch(`/workspaces/${workspaceId}/invites`);
  return parseJsonOrThrow<{ invites: PendingInviteDto[] }>(res);
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  const res = await apiFetch(`/workspaces/${workspaceId}/members/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    throw new Error(typeof message === 'string' ? message : 'Gagal mengubah role anggota');
  }
}

export async function removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  const res = await apiFetch(`/workspaces/${workspaceId}/members/${userId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    throw new Error(typeof message === 'string' ? message : 'Gagal menghapus anggota');
  }
}

export interface InvitePreviewDto {
  email: string;
  role: WorkspaceRole;
  workspaceName: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED';
}

// Deliberately unauthenticated on the server side (see InvitesController) -
// a brand-new user without an account yet still needs to see "you've been
// invited to X as Editor" before signing up.
export async function previewInvite(token: string): Promise<InvitePreviewDto> {
  const res = await apiFetch(`/invites/${token}`);
  return parseJsonOrThrow<InvitePreviewDto>(res);
}

export async function acceptInvite(token: string): Promise<WorkspaceDto> {
  const res = await apiFetch(`/invites/${token}/accept`, { method: 'POST' });
  return parseJsonOrThrow<WorkspaceDto>(res);
}

// Export Center (Sprint 03e). Sync formats (03b) - not fetched, used
// directly as an <a href> target, same convention as clipDownloadUrl/
// dashboardExportCsvUrl above.
export type VideoExportFormat =
  | 'report.json'
  | 'report.csv'
  | 'clip-metadata.json'
  | 'clip-metadata.csv'
  | 'transcript.txt'
  | 'captions.srt'
  | 'captions.vtt';

export function videoExportUrl(videoId: string, format: VideoExportFormat): string {
  return `${API_URL}/videos/${videoId}/export/${format}`;
}

// Async formats (03c/03d) - create the job, poll it (see ExportTypeRow's
// useSWR usage), then hit the download URL once status is READY. videoId is
// optional (not omitted) since ANALYTICS_REPORT is account-wide - existing
// callers keep passing a real videoId unchanged, enforced server-side
// (ExportService.create() rejects the videoId+ANALYTICS_REPORT combo).
export async function createExportJob(
  videoId: string | undefined,
  type: ExportType,
): Promise<ExportJobDto> {
  const res = await apiFetch('/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId, type }),
  });
  return parseJsonOrThrow<ExportJobDto>(res);
}

export async function getExportJob(id: string): Promise<ExportJobDto> {
  const res = await apiFetch(`/export/${id}`);
  return parseJsonOrThrow<ExportJobDto>(res);
}

// Recent Exports / Persistent Export History - the 10 most recent jobs
// matching the given filter, newest first. Fetched once when
// ExportCenterDialog/AnalyticsReportExport opens, so each row can seed its
// state from the server instead of always starting blank. `videoId` scopes
// the existing per-video tabs; `type` (ANALYTICS_REPORT has no videoId to
// scope by) covers the account-wide list - callers pass exactly one.
export async function listExportJobs(
  filter: { videoId?: string; type?: ExportType },
): Promise<ExportJobListDto> {
  const res = await apiFetch(`/export${toQueryString(filter as Record<string, string | undefined>)}`);
  return parseJsonOrThrow<ExportJobListDto>(res);
}

// Not fetched - same "<a href> target, browser handles the download"
// convention as videoExportUrl above. Only meaningful once the polled job's
// status is READY.
export function exportJobDownloadUrl(id: string): string {
  return `${API_URL}/export/${id}/download`;
}

// Notification Center Sprint 4A.
export async function getNotifications(limit?: number): Promise<NotificationListDto> {
  const res = await apiFetch(`/notifications${toQueryString({ limit })}`);
  return parseJsonOrThrow<NotificationListDto>(res);
}

export async function getUnreadNotificationCount(): Promise<NotificationUnreadCountDto> {
  const res = await apiFetch('/notifications/unread-count');
  return parseJsonOrThrow<NotificationUnreadCountDto>(res);
}

export async function markNotificationRead(id: string): Promise<void> {
  const res = await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
  await parseJsonOrThrow<void>(res);
}

export async function markAllNotificationsRead(): Promise<{ count: number }> {
  const res = await apiFetch('/notifications/read-all', { method: 'PATCH' });
  return parseJsonOrThrow<{ count: number }>(res);
}

// Sprint 4B (Notification Preferences). Milestone 04d - optional channel,
// defaults server-side to IN_APP (existing callers unchanged).
export async function getNotificationPreferences(
  channel?: NotificationChannel,
): Promise<NotificationPreferenceListDto> {
  const res = await apiFetch(`/notifications/preferences${toQueryString({ channel })}`);
  return parseJsonOrThrow<NotificationPreferenceListDto>(res);
}

export async function updateNotificationPreference(
  type: NotificationType,
  dto: UpdateNotificationPreferenceDto,
): Promise<NotificationPreferenceDto> {
  const res = await apiFetch(`/notifications/preferences/${type}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
  return parseJsonOrThrow<NotificationPreferenceDto>(res);
}

// Milestone 04d - Slack/Discord/generic-webhook destinations. Never fetches
// the decrypted url back - `configured: boolean` is the only signal about
// the secret this API ever exposes to a client.
export async function getNotificationWebhooks(): Promise<NotificationWebhookListDto> {
  const res = await apiFetch('/notifications/webhooks');
  return parseJsonOrThrow<NotificationWebhookListDto>(res);
}

export async function upsertNotificationWebhook(
  channel: NotificationChannel,
  url: string,
): Promise<NotificationWebhookDto> {
  const res = await apiFetch(`/notifications/webhooks/${channel}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return parseJsonOrThrow<NotificationWebhookDto>(res);
}

export async function deleteNotificationWebhook(channel: NotificationChannel): Promise<void> {
  await apiFetch(`/notifications/webhooks/${channel}`, { method: 'DELETE' });
}

// Milestone 04e - a distinct route from the generic webhook upsert above: a
// bot token isn't a URL, and saving one triggers a real Telegram API
// validation call server-side, returning telegramBotUsername for the
// "message your bot" onboarding deep link.
export async function upsertTelegramWebhook(botToken: string): Promise<NotificationWebhookDto> {
  const res = await apiFetch('/notifications/telegram', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken }),
  });
  return parseJsonOrThrow<NotificationWebhookDto>(res);
}

// Brand Kit (03d) - Brand Report's minimal logo + color settings.
export async function getBrandKit(): Promise<BrandKitDto> {
  const res = await apiFetch('/brand-kit');
  return parseJsonOrThrow<BrandKitDto>(res);
}

export async function updateBrandKit(input: {
  primaryColor?: string;
  secondaryColor?: string;
}): Promise<BrandKitDto> {
  const res = await apiFetch('/brand-kit', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<BrandKitDto>(res);
}

// multipart/form-data - no Content-Type header set explicitly, the browser
// fills in the correct boundary itself (setting it manually here would
// break the multipart parse on the server side).
export async function uploadBrandLogo(file: File): Promise<BrandKitDto> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch('/brand-kit/logo', { method: 'POST', body: formData });
  return parseJsonOrThrow<BrandKitDto>(res);
}

export function brandKitLogoUrl(): string {
  return `${API_URL}/brand-kit/logo`;
}

// Sprint 5B (Shared Clips) - a link holder needs no Speedora account, so
// getSharedVideo/sharedVideoStreamUrl/sharedClipStreamUrl below are called
// against a public route (no auth cookie required, though apiFetch's
// credentials: 'include' is harmless to keep for consistency - it just
// means an already-logged-in creator previewing their own share link still
// works the same way).
export async function createShareLink(
  videoId: string,
  input: { role?: ShareRole; expiresInDays?: number },
): Promise<ShareLinkCreatedDto> {
  const res = await apiFetch(`/videos/${videoId}/share-links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<ShareLinkCreatedDto>(res);
}

export async function listShareLinks(videoId: string): Promise<ShareLinkListDto> {
  const res = await apiFetch(`/videos/${videoId}/share-links`);
  return parseJsonOrThrow<ShareLinkListDto>(res);
}

export async function revokeShareLink(id: string): Promise<void> {
  await apiFetch(`/share-links/${id}`, { method: 'DELETE' });
}

export async function getSharedVideo(token: string): Promise<SharedVideoDto> {
  const res = await apiFetch(`/share/${token}`);
  return parseJsonOrThrow<SharedVideoDto>(res);
}

export function sharedVideoStreamUrl(sourceStreamUrl: string): string {
  return `${API_URL}${sourceStreamUrl}`;
}

export function sharedThumbnailUrl(thumbnailUrl: string): string {
  return `${API_URL}${thumbnailUrl}`;
}

// Sprint 5C (Comments).
export async function createComment(
  videoId: string,
  input: {
    body: string;
    clipId?: string;
    timestampSeconds?: number;
    parentId?: string;
    mentionedUserIds?: string[];
  },
): Promise<CommentDto> {
  const res = await apiFetch(`/videos/${videoId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<CommentDto>(res);
}

export async function listComments(videoId: string): Promise<CommentListDto> {
  const res = await apiFetch(`/videos/${videoId}/comments`);
  return parseJsonOrThrow<CommentListDto>(res);
}

export async function updateComment(id: string, body: string): Promise<CommentDto> {
  const res = await apiFetch(`/comments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  return parseJsonOrThrow<CommentDto>(res);
}

export async function deleteComment(id: string): Promise<void> {
  await apiFetch(`/comments/${id}`, { method: 'DELETE' });
}

export async function resolveComment(id: string): Promise<CommentDto> {
  const res = await apiFetch(`/comments/${id}/resolve`, { method: 'POST' });
  return parseJsonOrThrow<CommentDto>(res);
}

export async function unresolveComment(id: string): Promise<CommentDto> {
  const res = await apiFetch(`/comments/${id}/unresolve`, { method: 'POST' });
  return parseJsonOrThrow<CommentDto>(res);
}

export async function addCommentReaction(id: string, emoji: string): Promise<CommentDto> {
  const res = await apiFetch(`/comments/${id}/reactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji }),
  });
  return parseJsonOrThrow<CommentDto>(res);
}

export async function removeCommentReaction(id: string, emoji: string): Promise<CommentDto> {
  const res = await apiFetch(`/comments/${id}/reactions/${encodeURIComponent(emoji)}`, {
    method: 'DELETE',
  });
  return parseJsonOrThrow<CommentDto>(res);
}

export async function addCommentAttachment(
  id: string,
  file: File,
): Promise<CommentAttachmentDto> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch(`/comments/${id}/attachments`, { method: 'POST', body: formData });
  return parseJsonOrThrow<CommentAttachmentDto>(res);
}

export function commentAttachmentUrl(url: string): string {
  return `${API_URL}${url}`;
}

// Sprint 5D (Approval).
export async function requestApproval(
  videoId: string,
  input: { clipId?: string; note?: string; reviewerId?: string },
): Promise<ApprovalDto> {
  const res = await apiFetch(`/videos/${videoId}/approvals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<ApprovalDto>(res);
}

export async function listApprovals(videoId: string): Promise<ApprovalListDto> {
  const res = await apiFetch(`/videos/${videoId}/approvals`);
  return parseJsonOrThrow<ApprovalListDto>(res);
}

export async function decideApproval(
  id: string,
  input: { status: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION'; note?: string },
): Promise<ApprovalDto> {
  const res = await apiFetch(`/approvals/${id}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<ApprovalDto>(res);
}

export async function resubmitApproval(id: string, note?: string): Promise<ApprovalDto> {
  const res = await apiFetch(`/approvals/${id}/resubmit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  return parseJsonOrThrow<ApprovalDto>(res);
}

// Sprint 5E (Version Compare & History).
export async function listClipVersions(clipId: string): Promise<ClipVersionListDto> {
  const res = await apiFetch(`/clips/${clipId}/versions`);
  return parseJsonOrThrow<ClipVersionListDto>(res);
}

export async function restoreClipVersion(clipId: string, versionId: string): Promise<Clip> {
  const res = await apiFetch(`/clips/${clipId}/versions/${versionId}/restore`, {
    method: 'POST',
  });
  return parseJsonOrThrow<Clip>(res);
}

export function clipVersionDownloadUrl(url: string): string {
  return `${API_URL}${url}`;
}

export function clipVersionThumbnailUrl(url: string): string {
  return `${API_URL}${url}`;
}

export { API_URL };
