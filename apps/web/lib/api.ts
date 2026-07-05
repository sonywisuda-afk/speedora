import type {
  Clip,
  PremiumCheckoutResult,
  PremiumCreditAvailability,
  PublishRecord,
  SocialAccount,
  TranscriptionProvider,
  TranscriptSegment,
  UpdateClipInput,
  Video,
  VideoWithClips,
} from '@speedora/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface UserDto {
  id: string;
  email: string;
}

// Aliased, not redefined - these are the API/UI-facing DTOs contract-shared
// with apps/api via packages/shared (see CLAUDE.md's packages/shared
// convention). Kept under their old local names so the existing pages don't
// need touching.
export type ClipDto = Clip;
export type VideoDto = Video;
export type VideoWithClipsDto = VideoWithClips;

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
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

export async function listVideos(): Promise<VideoWithClipsDto[]> {
  const res = await apiFetch('/videos');
  return parseJsonOrThrow<VideoWithClipsDto[]>(res);
}

export function clipDownloadUrl(downloadUrl: string): string {
  return `${API_URL}${downloadUrl}`;
}

// Used directly as a <video src>, not fetched - the browser's own media
// pipeline issues the (possibly many, while scrubbing) Range requests
// against this URL. crossOrigin="use-credentials" on the <video> element is
// what makes the session cookie actually go out cross-origin (api runs on a
// different port than web).
export function videoSourceUrl(videoId: string): string {
  return `${API_URL}/videos/${videoId}/source`;
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
export async function publishClip(
  clipId: string,
  socialAccountId: string,
  scheduledAt?: string,
): Promise<PublishRecord> {
  const res = await apiFetch(`/clips/${clipId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ socialAccountId, scheduledAt }),
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

// Not fetched - used directly as an <a href> so the browser does a real
// top-level navigation (OAuth needs an actual redirect to Google, which a
// fetch() can't do). The session cookie still goes out on this kind of
// navigation - see CLAUDE.md's "Publish Center" section.
export function connectYouTubeUrl(): string {
  return `${API_URL}/social/youtube/connect`;
}

// Same reasoning as connectYouTubeUrl() above, for TikTok (Fase 6d).
export function connectTikTokUrl(): string {
  return `${API_URL}/social/tiktok/connect`;
}

// Same reasoning as connectYouTubeUrl() above, for Instagram (Fase 6d
// follow-up) - this is a Facebook Login dialog, not an Instagram one, see
// CLAUDE.md's Fase 6d "Instagram" section.
export function connectInstagramUrl(): string {
  return `${API_URL}/social/instagram/connect`;
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

export { API_URL };
