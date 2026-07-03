import type {
  Clip,
  SocialAccount,
  TranscriptSegment,
  UpdateClipInput,
  Video,
  VideoWithClips,
} from '@viral-clip-app/shared';

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

export async function me(): Promise<UserDto | null> {
  const res = await apiFetch('/auth/me');
  if (res.status === 401) return null;
  return parseJsonOrThrow<UserDto>(res);
}

export async function uploadVideo(file: File): Promise<VideoDto> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await apiFetch('/videos', {
    method: 'POST',
    body: formData,
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

export async function listSocialAccounts(): Promise<SocialAccount[]> {
  const res = await apiFetch('/social/accounts');
  return parseJsonOrThrow<SocialAccount[]>(res);
}

export async function disconnectSocialAccount(id: string): Promise<void> {
  await apiFetch(`/social/accounts/${id}`, { method: 'DELETE' });
}

// Not fetched - used directly as an <a href> so the browser does a real
// top-level navigation (OAuth needs an actual redirect to Google, which a
// fetch() can't do). The session cookie still goes out on this kind of
// navigation - see CLAUDE.md's "Publish Center" section.
export function connectYouTubeUrl(): string {
  return `${API_URL}/social/youtube/connect`;
}

export { API_URL };
