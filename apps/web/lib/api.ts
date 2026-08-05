import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import type {
  ActivityDeleteResult,
  ActivityEventType,
  AnalyticsHeatmapDto,
  AnalyticsOverviewDto,
  AnalyticsPerformanceClipsDto,
  AnalyticsPerformanceDto,
  AnalyticsPerformanceVideosDto,
  ApprovalDto,
  ApprovalListDto,
  AuditLogListDto,
  BrandKitDto,
  BrandKitTemplateDto,
  CalendarDto,
  CampaignAnalyticsDto,
  CampaignDetailDto,
  CampaignDto,
  CampaignListDto,
  Clip,
  ClipExplainabilityDto,
  ClipLibraryFacetsDto,
  ClipLibraryPageDto,
  ClipPerformanceDto,
  ClipPlatformCopyDto,
  ClipPlatformCopyListDto,
  ClipPlatformFitDto,
  ClipVersionListDto,
  CommentAttachmentDto,
  CommentDto,
  CommentListDto,
  DashboardActivityDto,
  DashboardExportsDto,
  DashboardStatsDto,
  ExportJobDto,
  ExportJobListDto,
  ExportType,
  FollowersDto,
  LeaderboardMetric,
  NotificationChannel,
  NotificationCategoryV2,
  NotificationChannelV2,
  NotificationListDto,
  NotificationPreferenceDto,
  NotificationPreferenceListDto,
  NotificationPreferencesV2Dto,
  NotificationPriorityV2,
  NotificationThreadDetailDto,
  NotificationType,
  NotificationUnreadCountDto,
  NotificationV2BulkActionResult,
  NotificationV2ListDto,
  NotificationV2StateFilter,
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
  ProcessingOptions,
  ProcessingPresetDto,
  ProcessingPresetListDto,
  ProjectBulkActionResultDto,
  ProjectDto,
  ProjectListDto,
  PublishRecord,
  QueuesDto,
  RecurringScheduleDto,
  RecurringScheduleListDto,
  SearchResultsDto,
  ShareLinkCreatedDto,
  ShareLinkListDto,
  ShareRole,
  SharedVideoDto,
  SocialAccount,
  SocialPlatform,
  SubtitlePresetDto,
  SubtitlePresetListDto,
  TrackedLinkDto,
  TrackedLinkListDto,
  TranscriptionProvider,
  TranscriptSegment,
  TrendGranularity,
  UpdateClipInput,
  UpdateNotificationPreferenceDto,
  UserRole,
  Video,
  VideoHistoryPage,
  VideoHistorySortBy,
  VideoHistoryStatusFilter,
  VideoWithClips,
  WorkersDto,
  WorkersHealthDto,
  WorkspaceDetailDto,
  WorkspaceDto,
  WorkspaceLeaderboardDto,
  WorkspaceListDto,
  WorkspacePredictionModelDto,
  WorkspaceRole,
} from '@speedora/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface UserDto {
  id: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
}

// Authentication Foundation Sprint 3 (Session Dashboard) - matches
// apps/api's SessionSummary. Dates arrive as ISO strings over JSON (never
// re-parsed into Date objects here - every consumer just needs to display
// them, same as how other DTOs in this file leave timestamps as strings).
export interface SessionDto {
  id: string;
  browser: string | null;
  os: string | null;
  deviceName: string | null;
  ipAddress: string | null;
  // Tahap 3.5 (Passkey UX & Observability) - 'password' | 'google' |
  // 'github' | 'passkey', null for sessions created before this field
  // existed.
  createdVia: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

// Aliased, not redefined - these are the API/UI-facing DTOs contract-shared
// with apps/api via packages/shared (see CLAUDE.md's packages/shared
// convention). Kept under their old local names so the existing pages don't
// need touching.
export type ClipDto = Clip;
export type VideoDto = Video;
export type VideoWithClipsDto = VideoWithClips;

// Phase F (RBAC hardening) - every error parseJsonOrThrow throws now carries
// the real HTTP status code, not just a message. Previously callers that
// needed to distinguish e.g. 403 from any other failure had to string-match
// the message body (see ops/ai/page.tsx's old check, fixed as part of this
// same pass) - fragile against any wording change on the backend. Additive:
// every existing `err.message`/`err instanceof Error` call site keeps
// working unchanged, since ApiError still is an Error.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Tahap 2 Step 2 Sprint 2b (Session Elevation) - thrown whenever ANY
// endpoint responds 403 { elevationRequired: true } (disable MFA,
// regenerate recovery codes, change password, delete account - see
// RecentMfaGuard on the backend). Checked generically in parseJsonOrThrow
// below rather than per call site, since the frontend behavior is
// identical regardless of which of the four endpoints triggered it: catch
// it, prompt for a fresh code/password via elevateSession, then retry the
// original action.
export class ElevationRequiredError extends ApiError {
  constructor(message: string) {
    super(message, 403);
    this.name = 'ElevationRequiredError';
  }
}

// Exported (not just used internally) so lib/api.server.ts's cookie-
// forwarding server fetch can reuse the same response-parsing/error-message
// convention as every browser call below, instead of a second copy.
export async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const rawMessage =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    // NestJS's global ValidationPipe (class-validator) always returns
    // `message` as a string[] on a DTO validation failure (even for a
    // single violation) - previously only the `typeof message === 'string'`
    // branch below was handled, so every validation error app-wide (e.g. a
    // too-long project name) silently fell back to a generic "Request
    // failed" instead of the actual validation message.
    const message = Array.isArray(rawMessage) ? rawMessage.join(', ') : rawMessage;
    if (body && typeof body === 'object' && body.elevationRequired === true) {
      throw new ElevationRequiredError(
        typeof message === 'string' ? message : 'Recent verification required',
      );
    }
    throw new ApiError(typeof message === 'string' ? message : 'Request failed', res.status);
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

// Authentication Foundation Sprint 4 (Attack Protection) - thrown instead of
// a generic Error when POST /auth/login responds with requiresCaptcha:true,
// so the caller (upload/page.tsx's handleAuthSubmit) can distinguish "wrong
// password" from "solve a Turnstile challenge and retry" rather than just
// showing both as the same red error text.
export class RequiresCaptchaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequiresCaptchaError';
  }
}

// Tahap 2 Step 2 Sprint 2a (MFA Enforcement) - thrown when POST /auth/login
// responds 200 with { mfaRequired: true, mfaToken } instead of the full
// user - credentials were correct, but the account has MFA enabled and no
// valid low-risk trusted-device cookie skipped the challenge. Carries
// mfaToken so the caller can route to /mfa-challenge without a second
// round trip.
export class MfaRequiredError extends Error {
  mfaToken: string;
  constructor(mfaToken: string) {
    super('MFA verification required');
    this.name = 'MfaRequiredError';
    this.mfaToken = mfaToken;
  }
}

export async function login(
  email: string,
  password: string,
  captchaToken?: string,
): Promise<UserDto> {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, captchaToken }),
  });

  // Cloned so a non-mfa/non-captcha response falls through to
  // parseJsonOrThrow below and can still read the original body itself.
  const body = await res
    .clone()
    .json()
    .catch(() => null);
  if (res.ok && body && typeof body === 'object' && body.mfaRequired === true) {
    throw new MfaRequiredError(body.mfaToken);
  }
  if (!res.ok && body && typeof body === 'object' && body.requiresCaptcha === true) {
    throw new RequiresCaptchaError(
      typeof body.message === 'string' ? body.message : 'CAPTCHA verification required',
    );
  }

  return parseJsonOrThrow<UserDto>(res);
}

// Tahap 3 Sprint 2 (Passkey Login) - usernameless: no email/password
// involved, so there's no separate "register" mode the way OAuth's buttons
// serve both (a passkey can only be added from the Accounts page by an
// already-logged-in user - see passkey.service.ts's header comment).
export async function getPasskeyLoginOptions(): Promise<{
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeToken: string;
}> {
  const res = await apiFetch('/auth/passkeys/login/options', { method: 'POST' });
  return parseJsonOrThrow(res);
}

// Same mfaRequired handling as login() above - a passkey assertion without
// real user verification falls back to the identical MFA-challenge gate a
// password login would hit, so the caller (upload/page.tsx's
// handlePasskeyLogin) can catch MfaRequiredError and route to
// /mfa-challenge exactly the way it already does for login().
export async function verifyPasskeyLogin(params: {
  response: AuthenticationResponseJSON;
  challengeToken: string;
}): Promise<UserDto> {
  const res = await apiFetch('/auth/passkeys/login/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const body = await res
    .clone()
    .json()
    .catch(() => null);
  if (res.ok && body && typeof body === 'object' && body.mfaRequired === true) {
    throw new MfaRequiredError(body.mfaToken);
  }

  return parseJsonOrThrow<UserDto>(res);
}

// Tahap 2 Step 2 Sprint 2a (MFA Enforcement) - completes a login that
// returned MfaRequiredError above, from either the password-login path or
// the OAuth-callback redirect (/mfa-challenge?token=...) - one shared
// endpoint and one shared frontend page for both entry points.
export async function submitMfaChallenge(
  mfaToken: string,
  code: string,
  rememberDevice?: boolean,
): Promise<UserDto> {
  const res = await apiFetch('/auth/mfa/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfaToken, code, rememberDevice }),
  });
  return parseJsonOrThrow<UserDto>(res);
}

export interface TrustedDeviceDto {
  id: string;
  browser: string | null;
  os: string | null;
  deviceName: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export async function listTrustedDevices(): Promise<TrustedDeviceDto[]> {
  const res = await apiFetch('/auth/mfa/trusted-devices');
  return parseJsonOrThrow<TrustedDeviceDto[]>(res);
}

export async function revokeTrustedDevice(id: string): Promise<void> {
  const res = await apiFetch(`/auth/mfa/trusted-devices/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    throw new Error(typeof message === 'string' ? message : 'Gagal menghapus perangkat terpercaya');
  }
}

// Tahap 2 Step 3 (OAuth Account Management) - matches apps/api's
// OAuthController.listLinked. Never carries providerAccountId - display
// only, same "never the raw identifier" convention as TrustedDeviceDto.
export interface LinkedProviderDto {
  provider: 'GOOGLE' | 'GITHUB';
  email: string | null;
  createdAt: string;
}

export async function listLinkedProviders(): Promise<LinkedProviderDto[]> {
  const res = await apiFetch('/auth/oauth/linked');
  return parseJsonOrThrow<LinkedProviderDto[]>(res);
}

// Gated by RecentMfaGuard server-side (204 on success, no body) - same
// manual elevationRequired check as deleteAccount below, since there's no
// success body for parseJsonOrThrow to parse.
export async function unlinkOAuthProvider(provider: LinkedProviderDto['provider']): Promise<void> {
  const res = await apiFetch(`/auth/oauth/linked/${provider}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    if (body && typeof body === 'object' && body.elevationRequired === true) {
      throw new ElevationRequiredError(
        typeof message === 'string' ? message : 'Recent verification required',
      );
    }
    throw new Error(typeof message === 'string' ? message : 'Gagal memutuskan akun terhubung');
  }
}

// Tahap 3 Sprint 1 (Passkey Foundation) - "Passkeys" section on the Accounts
// page, same shape as the OAuth linked-providers block above (this sprint is
// enrollment-only: list/register/rename/delete for an already-logged-in
// user - no login-with-passkey route exists yet, see
// apps/api/src/auth/passkey/passkey.service.ts's header comment).
export interface PasskeyDto {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  // Tahap 3.5 (Passkey UX & Observability) - ua-parser-js summary of the
  // browser/OS the passkey was registered from (e.g. "Chrome on macOS"),
  // null for passkeys registered before this field existed.
  createdDeviceLabel: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export async function listPasskeys(): Promise<PasskeyDto[]> {
  const res = await apiFetch('/auth/passkeys');
  return parseJsonOrThrow<PasskeyDto[]>(res);
}

export async function getPasskeyRegistrationOptions(): Promise<{
  options: PublicKeyCredentialCreationOptionsJSON;
  challengeToken: string;
}> {
  const res = await apiFetch('/auth/passkeys/register/options', { method: 'POST' });
  return parseJsonOrThrow(res);
}

// Gated by RecentMfaGuard server-side, same elevationRequired handling as
// every other parseJsonOrThrow caller (unlike unlinkOAuthProvider/
// revokeTrustedDevice above, this DOES have a success body - the saved
// passkey's summary - so parseJsonOrThrow's shared elevationRequired check
// applies without needing its own duplicate 204/no-body handling).
export async function verifyPasskeyRegistration(params: {
  response: RegistrationResponseJSON;
  challengeToken: string;
  name: string;
}): Promise<PasskeyDto> {
  const res = await apiFetch('/auth/passkeys/register/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow<PasskeyDto>(res);
}

export async function renamePasskey(id: string, name: string): Promise<PasskeyDto> {
  const res = await apiFetch(`/auth/passkeys/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow<PasskeyDto>(res);
}

// Gated by RecentMfaGuard server-side (204 on success, no body) - same
// manual elevationRequired check as unlinkOAuthProvider/revokeTrustedDevice
// above.
export async function deletePasskey(id: string): Promise<void> {
  const res = await apiFetch(`/auth/passkeys/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    if (body && typeof body === 'object' && body.elevationRequired === true) {
      throw new ElevationRequiredError(
        typeof message === 'string' ? message : 'Recent verification required',
      );
    }
    throw new Error(typeof message === 'string' ? message : 'Gagal menghapus passkey');
  }
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

export async function verifyEmail(token: string): Promise<UserDto> {
  const res = await apiFetch('/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return parseJsonOrThrow<UserDto>(res);
}

export async function resendVerification(): Promise<{ message: string }> {
  const res = await apiFetch('/auth/resend-verification', { method: 'POST' });
  return parseJsonOrThrow<{ message: string }>(res);
}

export async function listSessions(): Promise<SessionDto[]> {
  const res = await apiFetch('/auth/sessions');
  return parseJsonOrThrow<SessionDto[]>(res);
}

export async function revokeSession(id: string): Promise<void> {
  const res = await apiFetch(`/auth/sessions/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    throw new Error(typeof message === 'string' ? message : 'Gagal keluar dari perangkat');
  }
}

export async function logoutOthers(): Promise<{ success: boolean }> {
  const res = await apiFetch('/auth/logout-others', { method: 'POST' });
  return parseJsonOrThrow<{ success: boolean }>(res);
}

// Tahap 2 Step 2 Sprint 2b (Session Elevation) - currentPassword dropped;
// this route is now gated by RecentMfaGuard server-side (see
// ElevationRequiredError above).
export async function changePassword(newPassword: string): Promise<void> {
  const res = await apiFetch('/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword }),
  });
  await parseJsonOrThrow<{ success: boolean }>(res);
}

export interface ElevateResultDto {
  success: boolean;
  elevatedUntil: string;
}

// Tahap 3 Sprint 3 (Passkey Elevation) - the third credential shape
// AuthController.elevate accepts, alongside {code}/{password}.
export async function elevateSession(
  credential:
    | { code: string }
    | { password: string }
    | { passkeyResponse: AuthenticationResponseJSON; passkeyChallengeToken: string },
): Promise<ElevateResultDto> {
  const res = await apiFetch('/auth/elevate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credential),
  });
  return parseJsonOrThrow<ElevateResultDto>(res);
}

// Scoped to the caller's own passkeys (unlike getPasskeyLoginOptions'
// deliberate usernameless-ness) - the caller is already authenticated here.
export async function getPasskeyElevationOptions(): Promise<{
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeToken: string;
}> {
  const res = await apiFetch('/auth/passkeys/elevate/options', { method: 'POST' });
  return parseJsonOrThrow(res);
}

// Tahap 2 Step 2 Sprint 1 (MFA Foundation) - matches apps/api's
// MfaController.status. enabledAt arrives as an ISO string or null, same
// "leave timestamps as strings" convention as SessionDto above.
export interface MfaStatusDto {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

export interface MfaEnrollmentDto {
  secret: string;
  qrCodeDataUrl: string;
}

export interface MfaRecoveryCodesDto {
  recoveryCodes: string[];
}

export async function getMfaStatus(): Promise<MfaStatusDto> {
  const res = await apiFetch('/auth/mfa/status');
  return parseJsonOrThrow<MfaStatusDto>(res);
}

export async function enrollMfa(): Promise<MfaEnrollmentDto> {
  const res = await apiFetch('/auth/mfa/enroll', { method: 'POST' });
  return parseJsonOrThrow<MfaEnrollmentDto>(res);
}

export async function confirmMfaEnrollment(code: string): Promise<MfaRecoveryCodesDto> {
  const res = await apiFetch('/auth/mfa/enroll/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return parseJsonOrThrow<MfaRecoveryCodesDto>(res);
}

// Tahap 2 Step 2 Sprint 2b (Session Elevation) - no longer takes a code of
// its own; gated by RecentMfaGuard server-side.
export async function disableMfa(): Promise<void> {
  const res = await apiFetch('/auth/mfa/disable', { method: 'POST' });
  await parseJsonOrThrow<{ success: boolean }>(res);
}

export async function regenerateRecoveryCodes(): Promise<MfaRecoveryCodesDto> {
  const res = await apiFetch('/auth/mfa/recovery-codes/regenerate', { method: 'POST' });
  return parseJsonOrThrow<MfaRecoveryCodesDto>(res);
}

// Permanently deletes the logged-in user's account and everything it owns.
// 204 No Content on success; the session cookie is cleared server-side.
export async function deleteAccount(): Promise<void> {
  const res = await apiFetch('/auth/me', { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    if (body && typeof body === 'object' && body.elevationRequired === true) {
      throw new ElevationRequiredError(
        typeof message === 'string' ? message : 'Recent verification required',
      );
    }
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
  options?: {
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
    processingOptions?: ProcessingOptions;
  },
): Promise<VideoDto> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('transcriptionProvider', provider);
  // Pre-Processing Settings roadmap (Phase 0/1) - a multipart form field can
  // only ever be a string, so this is JSON-encoded here and decoded by
  // UploadVideoDto's own @Transform (see that DTO's comment).
  if (options?.processingOptions) {
    formData.append('processingOptions', JSON.stringify(options.processingOptions));
  }

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
  processingOptions?: ProcessingOptions,
): Promise<VideoDto> {
  const res = await apiFetch('/videos/import-youtube', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, transcriptionProvider: provider, processingOptions }),
  });
  return parseJsonOrThrow<VideoDto>(res);
}

export async function getVideo(id: string): Promise<VideoWithClipsDto> {
  const res = await apiFetch(`/videos/${id}`);
  return parseJsonOrThrow<VideoWithClipsDto>(res);
}

// Quality Validation roadmap (Fase 0 design, Phase 1) - submits Processing
// Settings once a video has finished probing (status PENDING_SETTINGS),
// persisting processingOptions and enqueueing TRANSCRIBE. See
// VideosService.startProcessing.
export async function startProcessing(
  id: string,
  processingOptions: ProcessingOptions,
): Promise<VideoWithClipsDto> {
  const res = await apiFetch(`/videos/${id}/start-processing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ processingOptions }),
  });
  return parseJsonOrThrow<VideoWithClipsDto>(res);
}

export async function retryVideo(id: string): Promise<VideoWithClipsDto> {
  const res = await apiFetch(`/videos/${id}/retry`, { method: 'POST' });
  return parseJsonOrThrow<VideoWithClipsDto>(res);
}

// Generate More Clips roadmap (Phase C) - see VideosService.generateMore for
// the RENDERED/not-mid-render validation this call relies on. The returned
// VideoWithClipsDto reflects the video at request time (new clips haven't
// rendered yet) - same "immediately return findOne()'s shape" convention as
// startProcessing/retryVideo above; the caller is responsible for polling to
// see new clips actually appear.
export async function generateMoreClips(
  id: string,
  params: {
    requestedCount: number;
    minClipDurationSeconds?: number;
    maxClipDurationSeconds?: number;
    minConfidence?: number;
    avoidOverlap: boolean;
  },
): Promise<VideoWithClipsDto> {
  const res = await apiFetch(`/videos/${id}/generate-more`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow<VideoWithClipsDto>(res);
}

// Dashboard Improvement Sprint Phase A - attaches an already-uploaded/
// imported video to a project right after the fact, reusing Sprint 5A's
// existing PATCH /videos/:id/move rather than threading projectId through
// upload/import-youtube (see the Phase A plan for why).
export async function moveVideo(
  id: string,
  target: { workspaceId?: string; projectId?: string | null; folderId?: string | null },
): Promise<VideoDto> {
  const res = await apiFetch(`/videos/${id}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(target),
  });
  return parseJsonOrThrow<VideoDto>(res);
}

// Not fetched - used directly as an <a href> so the browser handles the
// download, same convention as dashboardExportCsvUrl/clipDownloadUrl.
export function videoReportCsvUrl(videoId: string): string {
  return `${API_URL}/videos/${videoId}/export/report.csv`;
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

// Subtitle Studio roadmap (P2a) - manual caption text edit.
export async function updateTranscriptSegment(
  videoId: string,
  segmentId: string,
  text: string,
): Promise<TranscriptSegment> {
  const res = await apiFetch(`/videos/${videoId}/transcript-segments/${segmentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return parseJsonOrThrow<TranscriptSegment>(res);
}

// Subtitle Studio roadmap (P2b) - combine two chronologically adjacent
// segments; returns the merged row.
export async function mergeTranscriptSegments(
  videoId: string,
  firstSegmentId: string,
  secondSegmentId: string,
): Promise<TranscriptSegment> {
  const res = await apiFetch(`/videos/${videoId}/transcript-segments/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstSegmentId, secondSegmentId }),
  });
  return parseJsonOrThrow<TranscriptSegment>(res);
}

export interface SplitTranscriptSegmentResult {
  segments: [TranscriptSegment, TranscriptSegment];
  // true when the split point was estimated by character-length ratio
  // rather than a real Whisper word boundary (pre-Fase-3 segments with no
  // word-level timestamps) - the UI should flag this as approximate.
  approximate: boolean;
}

// Subtitle Studio roadmap (P2b) - split one segment into two at a word
// boundary (or, for a segment with no word-level data, an approximate
// character-ratio split).
export async function splitTranscriptSegment(
  videoId: string,
  segmentId: string,
  atWordIndex: number,
): Promise<SplitTranscriptSegmentResult> {
  const res = await apiFetch(`/videos/${videoId}/transcript-segments/${segmentId}/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ atWordIndex }),
  });
  return parseJsonOrThrow<SplitTranscriptSegmentResult>(res);
}

// Subtitle Studio roadmap (P2f) - enqueues one LLM call translating this
// video's whole transcript into languageCode. Fire-and-forget from the
// client's perspective - it returns immediately ({status: 'queued'}); the
// caller polls getVideoTranscript() again and checks whether every segment
// has translations[languageCode] populated, same "poll the resource
// itself, no dedicated job-status row" contract TranslateTranscriptJobData
// documents on the backend.
export async function translateTranscript(
  videoId: string,
  languageCode: string,
): Promise<{ status: 'queued'; languageCode: string }> {
  const res = await apiFetch(`/videos/${videoId}/transcript-segments/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ languageCode }),
  });
  return parseJsonOrThrow<{ status: 'queued'; languageCode: string }>(res);
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

// Dashboard Improvement Sprint Phase B ("View All" video processing
// history) - separate from listVideos/PaginatedVideos on purpose (see
// VideosService.findHistory's own comment): a history table only needs a
// lean row shape, not every clip's full AI-feature JSON. sortBy newest/
// oldest use cursor (nextCursor set, page/totalPages/totalCount null);
// processingTime/topScore use page-number pagination instead (opposite
// nullness) - see the response shape itself, not a second return type.
export async function listVideoHistory(params?: {
  cursor?: string;
  page?: number;
  limit?: number;
  workspaceId?: string;
  ownerId?: string;
  status?: VideoHistoryStatusFilter;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: VideoHistorySortBy;
}): Promise<VideoHistoryPage> {
  const res = await apiFetch(
    `/videos/history${toQueryString({
      cursor: params?.cursor,
      page: params?.page,
      limit: params?.limit,
      workspaceId: params?.workspaceId,
      ownerId: params?.ownerId,
      status: params?.status,
      search: params?.search,
      dateFrom: params?.dateFrom,
      dateTo: params?.dateTo,
      sortBy: params?.sortBy,
    })}`,
  );
  return parseJsonOrThrow<VideoHistoryPage>(res);
}

export function clipDownloadUrl(downloadUrl: string): string {
  return `${API_URL}${downloadUrl}`;
}

// AI Clip Library roadmap (P1) - the first cross-video, filterable clip
// listing this app has ever had (GET /videos only ever nests clips under one
// video). Same named-param-interface + toQueryString pattern as
// getAnalyticsPerformanceClips - topics is joined into a comma-separated
// string here (the API's own parseTopics splits on comma) rather than
// widening toQueryString to accept arrays for this one caller.
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

export async function getClipLibrary(
  params: ClipLibraryFilterParams = {},
): Promise<ClipLibraryPageDto> {
  const { topics, ...rest } = params;
  const res = await apiFetch(
    `/clips${toQueryString({
      ...(rest as Record<string, string | number | undefined>),
      topics: topics && topics.length > 0 ? topics.join(',') : undefined,
    })}`,
  );
  return parseJsonOrThrow<ClipLibraryPageDto>(res);
}

export async function getClipLibraryFacets(params: {
  workspaceId?: string;
  projectId?: string;
}): Promise<ClipLibraryFacetsDto> {
  const res = await apiFetch(`/clips/facets${toQueryString(params)}`);
  return parseJsonOrThrow<ClipLibraryFacetsDto>(res);
}

// Natural Language AI Search roadmap (P4) - a thin parser on top of the
// Clip Library filters above: translates free text into a partial
// ClipLibraryFilterParams, which the caller merges into its own filter
// state and re-issues as a normal getClipLibrary() call - this function
// never returns clips itself.
export interface ParseClipQueryResult {
  filters: Partial<ClipLibraryFilterParams>;
  summary: string;
}

export async function parseClipQuery(
  query: string,
  params: { workspaceId?: string; projectId?: string } = {},
): Promise<ParseClipQueryResult> {
  const res = await apiFetch('/clips/ai-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, ...params }),
  });
  return parseJsonOrThrow<ParseClipQueryResult>(res);
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

// Sprint 6C (Analytics Dashboard Expansion - Per-Clip Performance) - same
// "per-clip round trip only when the user actually looks" reasoning as
// getClipExplainability above.
export async function getClipPerformance(clipId: string): Promise<ClipPerformanceDto> {
  const res = await apiFetch(`/clips/${clipId}/performance`);
  return parseJsonOrThrow<ClipPerformanceDto>(res);
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

// Sprint 6E (Campaign-level analytics rollup).
export async function getCampaignAnalytics(
  id: string,
  params: { granularity?: TrendGranularity } = {},
): Promise<CampaignAnalyticsDto> {
  const res = await apiFetch(
    `/campaigns/${id}/analytics${toQueryString(params as Record<string, string | number | undefined>)}`,
  );
  return parseJsonOrThrow<CampaignAnalyticsDto>(res);
}

// Sprint 6K (Conversion) - creates a Speedora-owned trackable short link
// attributed to exactly one publishRecordId or campaignId (server-enforced,
// see TrackedLinksService). destinationUrl is the creator's own landing
// page/product link, not the platform post URL itself - see
// TrackedLinksService.assertNotSelfRedirect's own comment.
export async function createTrackedLink(
  workspaceId: string,
  input: { destinationUrl: string; publishRecordId?: string; campaignId?: string },
): Promise<TrackedLinkDto> {
  const res = await apiFetch(`/workspaces/${workspaceId}/tracked-links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<TrackedLinkDto>(res);
}

export async function listTrackedLinks(workspaceId: string): Promise<TrackedLinkListDto> {
  const res = await apiFetch(`/workspaces/${workspaceId}/tracked-links`);
  return parseJsonOrThrow<TrackedLinkListDto>(res);
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
  days?: 7 | 30 | 90 | 180 | 365;
  platform?: SocialPlatform;
  // Sprint 6B (Trend granularity) - only meaningful to getAnalyticsPerformance
  // (the other two performance endpoints don't return a trend), but kept on
  // the shared param interface rather than a one-off extension since every
  // caller already spreads PerformanceFilterParams.
  granularity?: TrendGranularity;
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

// PR #44 (Queue & Worker Observability Dashboard). Unlike GET /ops/ai/*
// above, these three (GET /queues, /workers, /workers/health) are NOT
// server-side role-guarded - apps/api/src/monitoring/monitoring.controller.ts
// deliberately leaves every monitoring route unauthenticated so a load
// balancer/uptime checker can reach it without a session (see
// docs/monitoring.md). The /ops/queues page still restricts who can *see*
// this data in the UI (checking user.role client-side, same visibility-only
// treatment Nav.tsx already gives the "AI Ops" link) - it's a UX boundary,
// not a security one, since the underlying data was already reachable by
// anyone with the URL before this page existed.
export async function getQueues(): Promise<QueuesDto> {
  const res = await apiFetch('/queues');
  return parseJsonOrThrow<QueuesDto>(res);
}

export async function getWorkers(): Promise<WorkersDto> {
  const res = await apiFetch('/workers');
  return parseJsonOrThrow<WorkersDto>(res);
}

export async function getWorkersHealth(): Promise<WorkersHealthDto> {
  const res = await apiFetch('/workers/health');
  return parseJsonOrThrow<WorkersHealthDto>(res);
}

// Sprint 1-2 (Dashboard Redesign) - Statistics Row.
export async function getDashboardStats(): Promise<DashboardStatsDto> {
  const res = await apiFetch('/dashboard/stats');
  return parseJsonOrThrow<DashboardStatsDto>(res);
}

// Activity Timeline v2 - cursor pagination + optional type/q filters, same
// `{ <items>, nextCursor }` + query-param convention as
// listNotificationsV2.
export interface DashboardActivityParams {
  cursor?: string;
  limit?: number;
  q?: string;
  type?: ActivityEventType;
}

export async function getDashboardActivity(
  params: DashboardActivityParams = {},
): Promise<DashboardActivityDto> {
  const res = await apiFetch(
    `/dashboard/activity${toQueryString(params as Record<string, string | number | undefined>)}`,
  );
  return parseJsonOrThrow<DashboardActivityDto>(res);
}

// Bulk-delete-by-ids (1-or-many; empty array is a no-op) vs. clear-all
// below - two distinct endpoints, same reasoning as
// DashboardController.removeActivity/removeAllActivity.
export async function deleteActivityEvents(ids: string[]): Promise<ActivityDeleteResult> {
  const res = await apiFetch('/dashboard/activity', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return parseJsonOrThrow<ActivityDeleteResult>(res);
}

export async function deleteAllActivityEvents(): Promise<ActivityDeleteResult> {
  const res = await apiFetch('/dashboard/activity/all', { method: 'DELETE' });
  return parseJsonOrThrow<ActivityDeleteResult>(res);
}

// Phase E (Dashboard & Recent Activity) - Export Center visibility.
export async function getDashboardExports(): Promise<DashboardExportsDto> {
  const res = await apiFetch('/dashboard/exports');
  return parseJsonOrThrow<DashboardExportsDto>(res);
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

// Workspace Settings (General tab) - ADMIN+ server-side (WorkspaceService.update),
// mirrored client-side for UX only.
export async function updateWorkspace(id: string, name: string): Promise<WorkspaceDetailDto> {
  const res = await apiFetch(`/workspaces/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow<WorkspaceDetailDto>(res);
}

// Project Management UI - ProjectService (Sprint 5A) has always exposed
// full CRUD (create/list/get/update/delete), but nothing in apps/web called
// it until now. EDITOR+ can create/rename/archive/unarchive, ADMIN+ can
// permanently delete - enforced server-side by WorkspaceAccessService,
// mirrored client-side in /projects for UX only. Archive roadmap (P1) adds
// archivedAt filtering (listProjects) plus archive()/unarchive().
export async function listProjects(
  workspaceId: string,
  includeArchived = false,
): Promise<ProjectListDto> {
  const res = await apiFetch(
    `/workspaces/${workspaceId}/projects${includeArchived ? '?includeArchived=true' : ''}`,
  );
  return parseJsonOrThrow<ProjectListDto>(res);
}

export async function createProject(workspaceId: string, name: string): Promise<ProjectDto> {
  const res = await apiFetch(`/workspaces/${workspaceId}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow<ProjectDto>(res);
}

export async function updateProject(id: string, name: string): Promise<ProjectDto> {
  const res = await apiFetch(`/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow<ProjectDto>(res);
}

export async function deleteProject(id: string): Promise<void> {
  const res = await apiFetch(`/projects/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    throw new Error(typeof message === 'string' ? message : 'Gagal menghapus project');
  }
}

export async function archiveProject(id: string): Promise<ProjectDto> {
  const res = await apiFetch(`/projects/${id}/archive`, { method: 'POST' });
  return parseJsonOrThrow<ProjectDto>(res);
}

export async function unarchiveProject(id: string): Promise<ProjectDto> {
  const res = await apiFetch(`/projects/${id}/unarchive`, { method: 'POST' });
  return parseJsonOrThrow<ProjectDto>(res);
}

// Move roadmap - ADMIN+ on both workspaces, and only for a project with zero
// videos (see ProjectService.move's own comment for why: Video.workspaceId
// is independent of its project's, so a non-empty move would orphan it).
export async function moveProject(id: string, targetWorkspaceId: string): Promise<ProjectDto> {
  const res = await apiFetch(`/projects/${id}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetWorkspaceId }),
  });
  return parseJsonOrThrow<ProjectDto>(res);
}

// Bulk Actions roadmap - each id runs through the single-item endpoint's own
// role/business-rule checks server-side, so a batch is partial-success (see
// ProjectBulkActionResultDto's own comment) - callers should render
// `failed` even on a 200 response, not just on a thrown error.
export async function bulkArchiveProjects(
  projectIds: string[],
): Promise<ProjectBulkActionResultDto> {
  const res = await apiFetch('/projects/bulk/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectIds }),
  });
  return parseJsonOrThrow<ProjectBulkActionResultDto>(res);
}

export async function bulkUnarchiveProjects(
  projectIds: string[],
): Promise<ProjectBulkActionResultDto> {
  const res = await apiFetch('/projects/bulk/unarchive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectIds }),
  });
  return parseJsonOrThrow<ProjectBulkActionResultDto>(res);
}

export async function bulkMoveProjects(
  projectIds: string[],
  targetWorkspaceId: string,
): Promise<ProjectBulkActionResultDto> {
  const res = await apiFetch('/projects/bulk/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectIds, targetWorkspaceId }),
  });
  return parseJsonOrThrow<ProjectBulkActionResultDto>(res);
}

export async function bulkDeleteProjects(
  projectIds: string[],
): Promise<ProjectBulkActionResultDto> {
  const res = await apiFetch('/projects/bulk/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectIds }),
  });
  return parseJsonOrThrow<ProjectBulkActionResultDto>(res);
}

// Sprint 6D (Leaderboard) - workspace-scoped, parallel to
// getAnalyticsPerformance's owner-scoped fetch (never merged with it).
export interface WorkspaceLeaderboardParams {
  metric?: LeaderboardMetric;
  days?: 7 | 30 | 90 | 180 | 365;
  limit?: number;
}

export async function getWorkspaceLeaderboard(
  workspaceId: string,
  params: WorkspaceLeaderboardParams = {},
): Promise<WorkspaceLeaderboardDto> {
  const res = await apiFetch(
    `/workspaces/${workspaceId}/analytics/leaderboard${toQueryString(params as Record<string, string | number | undefined>)}`,
  );
  return parseJsonOrThrow<WorkspaceLeaderboardDto>(res);
}

// Sprint 6F (Followers).
export async function getAnalyticsFollowers(
  params: { days?: 7 | 30 | 90 | 180 | 365 } = {},
): Promise<FollowersDto> {
  const res = await apiFetch(
    `/analytics/followers${toQueryString(params as Record<string, string | number | undefined>)}`,
  );
  return parseJsonOrThrow<FollowersDto>(res);
}

export async function getWorkspaceFollowers(
  workspaceId: string,
  params: { days?: 7 | 30 | 90 | 180 | 365 } = {},
): Promise<FollowersDto> {
  const res = await apiFetch(
    `/workspaces/${workspaceId}/analytics/followers${toQueryString(params as Record<string, string | number | undefined>)}`,
  );
  return parseJsonOrThrow<FollowersDto>(res);
}

// Sprint 6H (Heatmap).
export async function getAnalyticsHeatmap(
  params: { days?: 7 | 30 | 90 | 180 | 365 } = {},
): Promise<AnalyticsHeatmapDto> {
  const res = await apiFetch(
    `/analytics/heatmap${toQueryString(params as Record<string, string | number | undefined>)}`,
  );
  return parseJsonOrThrow<AnalyticsHeatmapDto>(res);
}

export async function getWorkspaceHeatmap(
  workspaceId: string,
  params: { days?: 7 | 30 | 90 | 180 | 365 } = {},
): Promise<AnalyticsHeatmapDto> {
  const res = await apiFetch(
    `/workspaces/${workspaceId}/analytics/heatmap${toQueryString(params as Record<string, string | number | undefined>)}`,
  );
  return parseJsonOrThrow<AnalyticsHeatmapDto>(res);
}

// Sprint 6J (Predicted performance) - workspace-level transparency
// diagnostic, echoing /ops/ai/correlation's shape.
export async function getWorkspacePredictionModel(
  workspaceId: string,
): Promise<WorkspacePredictionModelDto> {
  const res = await apiFetch(`/workspaces/${workspaceId}/analytics/prediction-model`);
  return parseJsonOrThrow<WorkspacePredictionModelDto>(res);
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

// Publishing Expansion Phase 6D (Calendar view) - start/end are ISO 8601
// instants for a half-open [start, end) range, same convention as
// WorkspaceService.getCalendar.
export async function getWorkspaceCalendar(
  workspaceId: string,
  start: string,
  end: string,
): Promise<CalendarDto> {
  const query = new URLSearchParams({ start, end });
  const res = await apiFetch(`/workspaces/${workspaceId}/calendar?${query.toString()}`);
  return parseJsonOrThrow<CalendarDto>(res);
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

// Transfer Ownership roadmap - OWNER-only (enforced server-side against
// Workspace.ownerId, not just OWNER-rank membership - see
// WorkspaceService.transferOwnership's own comment). newOwnerUserId must
// already be a member; blocked for isPersonal workspaces.
export async function transferWorkspaceOwnership(
  workspaceId: string,
  newOwnerUserId: string,
): Promise<WorkspaceDto> {
  const res = await apiFetch(`/workspaces/${workspaceId}/transfer-ownership`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newOwnerUserId }),
  });
  return parseJsonOrThrow<WorkspaceDto>(res);
}

// Workspace Lifecycle Management roadmap - OWNER-only server-side. Rejects
// (409) with a specific message when the workspace still has other
// members/projects/videos/campaigns/recurring schedules/tracked links - see
// WorkspaceService.remove().
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const res = await apiFetch(`/workspaces/${workspaceId}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    throw new Error(typeof message === 'string' ? message : 'Gagal menghapus workspace');
  }
}

// Workspace Lifecycle Management roadmap - any non-OWNER member; the OWNER
// is rejected server-side with a message pointing at transfer-ownership.
export async function leaveWorkspace(workspaceId: string): Promise<void> {
  const res = await apiFetch(`/workspaces/${workspaceId}/leave`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body ? body.message : res.statusText;
    throw new Error(typeof message === 'string' ? message : 'Gagal keluar dari workspace');
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
  // Export format expansion (Phase D).
  | 'report.md'
  | 'report.html'
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
export async function listExportJobs(filter: {
  videoId?: string;
  type?: ExportType;
}): Promise<ExportJobListDto> {
  const res = await apiFetch(
    `/export${toQueryString(filter as Record<string, string | undefined>)}`,
  );
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

export async function deleteNotification(id: string): Promise<void> {
  const res = await apiFetch(`/notifications/${id}`, { method: 'DELETE' });
  await parseJsonOrThrow<void>(res);
}

export async function deleteAllNotifications(): Promise<{ count: number }> {
  const res = await apiFetch('/notifications', { method: 'DELETE' });
  return parseJsonOrThrow<{ count: number }>(res);
}

// ============================================================================
// Notification Center v2 Phase 4 (Realtime & Frontend Integration) - every
// function below hits /notifications/v2/* (Phase 3's additive API), never
// /notifications/* (V1, above) - the two never share a call site.
// ============================================================================

export interface NotificationV2ListParams {
  cursor?: string;
  limit?: number;
  state?: NotificationV2StateFilter;
  category?: NotificationCategoryV2;
  priority?: NotificationPriorityV2;
  q?: string;
}

export async function listNotificationsV2(
  params: NotificationV2ListParams = {},
): Promise<NotificationV2ListDto> {
  const res = await apiFetch(
    `/notifications/v2${toQueryString(params as Record<string, string | number | undefined>)}`,
  );
  return parseJsonOrThrow<NotificationV2ListDto>(res);
}

export async function getUnreadNotificationCountV2(): Promise<NotificationUnreadCountDto> {
  const res = await apiFetch('/notifications/v2/unread-count');
  return parseJsonOrThrow<NotificationUnreadCountDto>(res);
}

export async function getNotificationThreadDetail(
  threadId: string,
): Promise<NotificationThreadDetailDto> {
  const res = await apiFetch(`/notifications/v2/threads/${threadId}`);
  return parseJsonOrThrow<NotificationThreadDetailDto>(res);
}

export async function markNotificationsReadV2(
  ids: string[],
): Promise<NotificationV2BulkActionResult> {
  const res = await apiFetch('/notifications/v2/read', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return parseJsonOrThrow<NotificationV2BulkActionResult>(res);
}

export async function markAllNotificationsReadV2(): Promise<NotificationV2BulkActionResult> {
  const res = await apiFetch('/notifications/v2/read-all', { method: 'PATCH' });
  return parseJsonOrThrow<NotificationV2BulkActionResult>(res);
}

export async function archiveNotificationsV2(
  ids: string[],
): Promise<NotificationV2BulkActionResult> {
  const res = await apiFetch('/notifications/v2/archive', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return parseJsonOrThrow<NotificationV2BulkActionResult>(res);
}

export async function deleteNotificationsV2(
  ids: string[],
): Promise<NotificationV2BulkActionResult> {
  const res = await apiFetch('/notifications/v2', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return parseJsonOrThrow<NotificationV2BulkActionResult>(res);
}

// Notification Center v2 Phase 5 (Preferences & Delivery) - the simplified
// preferences UI's own 3 endpoints. Never touches /notifications/preferences
// (V1, above) - a separate, coarser contract.
export async function getNotificationPreferencesV2(): Promise<NotificationPreferencesV2Dto> {
  const res = await apiFetch('/notifications/v2/preferences');
  return parseJsonOrThrow<NotificationPreferencesV2Dto>(res);
}

export async function updateInAppPreferenceV2(group: string, enabled: boolean): Promise<void> {
  const res = await apiFetch(`/notifications/v2/preferences/in-app/${group}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  await parseJsonOrThrow<void>(res);
}

export async function updateChannelPreferenceV2(
  channel: NotificationChannelV2,
  enabled: boolean,
): Promise<void> {
  const res = await apiFetch(`/notifications/v2/preferences/channel/${channel}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  await parseJsonOrThrow<void>(res);
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
//
// Workspace-level Brand Kit roadmap (P3g) - every function below now takes
// an optional workspaceId, forwarded to apps/api as a `?workspaceId=`
// query param (see BrandKitController.resolveTarget). Omitted (or the
// caller's own personal workspace) edits the same User fields as before -
// existing callers that never pass it see zero behavior change. The
// `brandKit*Url()` helpers are used directly as <img>/<video> `src`
// attributes (the browser issues the GET itself, not fetch()), so
// workspaceId has to be baked into the URL string rather than passed as a
// request option.
export async function getBrandKit(workspaceId?: string): Promise<BrandKitDto> {
  const res = await apiFetch(`/brand-kit${toQueryString({ workspaceId })}`);
  return parseJsonOrThrow<BrandKitDto>(res);
}

export async function updateBrandKit(
  input: {
    primaryColor?: string;
    secondaryColor?: string;
    // Brand Kit roadmap (P3a) - one of FONT_FAMILIES's curated keys.
    fontFamily?: string;
    // Watermark roadmap (P3c) - opacity/scale/margin are 0-1 fractions;
    // scale/margin are fractions of the OUTPUT video's width.
    watermarkOpacity?: number;
    watermarkScale?: number;
    watermarkMargin?: number;
    watermarkPosition?: string;
    // Intro roadmap (P3d) - only meaningful when the current intro is an
    // image (a video's own duration isn't user-editable).
    introImageDurationSeconds?: number;
    // Outro roadmap (P3e) - same shape as introImageDurationSeconds above.
    outroImageDurationSeconds?: number;
  },
  workspaceId?: string,
): Promise<BrandKitDto> {
  const res = await apiFetch(`/brand-kit${toQueryString({ workspaceId })}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<BrandKitDto>(res);
}

// multipart/form-data - no Content-Type header set explicitly, the browser
// fills in the correct boundary itself (setting it manually here would
// break the multipart parse on the server side).
export async function uploadBrandLogo(file: File, workspaceId?: string): Promise<BrandKitDto> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch(`/brand-kit/logo${toQueryString({ workspaceId })}`, {
    method: 'POST',
    body: formData,
  });
  return parseJsonOrThrow<BrandKitDto>(res);
}

export function brandKitLogoUrl(workspaceId?: string): string {
  return `${API_URL}/brand-kit/logo${toQueryString({ workspaceId })}`;
}

// Watermark roadmap (P3c) - same upload/download shape as the logo above.
export async function uploadBrandWatermark(file: File, workspaceId?: string): Promise<BrandKitDto> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch(`/brand-kit/watermark${toQueryString({ workspaceId })}`, {
    method: 'POST',
    body: formData,
  });
  return parseJsonOrThrow<BrandKitDto>(res);
}

export function brandKitWatermarkUrl(workspaceId?: string): string {
  return `${API_URL}/brand-kit/watermark${toQueryString({ workspaceId })}`;
}

export async function removeBrandWatermark(workspaceId?: string): Promise<void> {
  await apiFetch(`/brand-kit/watermark${toQueryString({ workspaceId })}`, { method: 'DELETE' });
}

// Intro roadmap (P3d) - same upload/download/delete shape as the watermark
// above.
export async function uploadBrandIntro(file: File, workspaceId?: string): Promise<BrandKitDto> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch(`/brand-kit/intro${toQueryString({ workspaceId })}`, {
    method: 'POST',
    body: formData,
  });
  return parseJsonOrThrow<BrandKitDto>(res);
}

export function brandKitIntroUrl(workspaceId?: string): string {
  return `${API_URL}/brand-kit/intro${toQueryString({ workspaceId })}`;
}

export async function removeBrandIntro(workspaceId?: string): Promise<void> {
  await apiFetch(`/brand-kit/intro${toQueryString({ workspaceId })}`, { method: 'DELETE' });
}

// Outro roadmap (P3e) - same upload/download/delete shape as the intro
// above.
export async function uploadBrandOutro(file: File, workspaceId?: string): Promise<BrandKitDto> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch(`/brand-kit/outro${toQueryString({ workspaceId })}`, {
    method: 'POST',
    body: formData,
  });
  return parseJsonOrThrow<BrandKitDto>(res);
}

export function brandKitOutroUrl(workspaceId?: string): string {
  return `${API_URL}/brand-kit/outro${toQueryString({ workspaceId })}`;
}

export async function removeBrandOutro(workspaceId?: string): Promise<void> {
  await apiFetch(`/brand-kit/outro${toQueryString({ workspaceId })}`, { method: 'DELETE' });
}

// Template Presets roadmap (P3f) - "save current Brand Kit as template" +
// a switcher list.
export async function listBrandKitTemplates(): Promise<{ templates: BrandKitTemplateDto[] }> {
  const res = await apiFetch('/brand-kit/templates');
  return parseJsonOrThrow<{ templates: BrandKitTemplateDto[] }>(res);
}

// Workspace-level Brand Kit roadmap (P3g) - workspaceId picks which kit is
// snapshotted (list/rename/delete don't need it - a template row itself is
// always userId-owned, independent of which kit is currently active).
export async function createBrandKitTemplate(
  name: string,
  workspaceId?: string,
): Promise<BrandKitTemplateDto> {
  const res = await apiFetch(`/brand-kit/templates${toQueryString({ workspaceId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow<BrandKitTemplateDto>(res);
}

export async function renameBrandKitTemplate(
  id: string,
  name: string,
): Promise<BrandKitTemplateDto> {
  const res = await apiFetch(`/brand-kit/templates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow<BrandKitTemplateDto>(res);
}

export async function deleteBrandKitTemplate(id: string): Promise<void> {
  await apiFetch(`/brand-kit/templates/${id}`, { method: 'DELETE' });
}

// Copies the saved template's fields back onto the live Brand Kit -
// returns the resulting BrandKitDto so the caller can refresh in one round
// trip instead of apply-then-refetch.
export async function applyBrandKitTemplate(
  id: string,
  workspaceId?: string,
): Promise<BrandKitDto> {
  const res = await apiFetch(`/brand-kit/templates/${id}/apply${toQueryString({ workspaceId })}`, {
    method: 'POST',
  });
  return parseJsonOrThrow<BrandKitDto>(res);
}

// Subtitle Presets roadmap (P3b) - a named, user-saved bundle of
// captionStyle/speakerColorCaptions/fontFamily, selectable per clip in the
// Timeline Editor.
export async function listSubtitlePresets(): Promise<SubtitlePresetListDto> {
  const res = await apiFetch('/subtitle-presets');
  return parseJsonOrThrow<SubtitlePresetListDto>(res);
}

export async function createSubtitlePreset(input: {
  name: string;
  captionStyle: string;
  speakerColorCaptions: boolean;
  fontFamily?: string;
}): Promise<SubtitlePresetDto> {
  const res = await apiFetch('/subtitle-presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<SubtitlePresetDto>(res);
}

export async function deleteSubtitlePreset(id: string): Promise<void> {
  await apiFetch(`/subtitle-presets/${id}`, { method: 'DELETE' });
}

// Pre-Processing Settings roadmap (Phase 0/1) - same CRUD shape as the
// SubtitlePreset functions just above.
export async function listProcessingPresets(): Promise<ProcessingPresetListDto> {
  const res = await apiFetch('/processing-presets');
  return parseJsonOrThrow<ProcessingPresetListDto>(res);
}

export async function createProcessingPreset(input: {
  name: string;
  config: ProcessingOptions;
}): Promise<ProcessingPresetDto> {
  const res = await apiFetch('/processing-presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<ProcessingPresetDto>(res);
}

export async function deleteProcessingPreset(id: string): Promise<void> {
  await apiFetch(`/processing-presets/${id}`, { method: 'DELETE' });
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

export async function addCommentAttachment(id: string, file: File): Promise<CommentAttachmentDto> {
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
