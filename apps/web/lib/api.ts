import { VideoStatus } from '@viral-clip-app/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface UserDto {
  id: string;
  email: string;
}

export interface ClipDto {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  viralityScore: number;
  downloadUrl: string | null;
}

export interface VideoDto {
  id: string;
  ownerId: string;
  sourceUrl: string;
  status: VideoStatus;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoWithClipsDto extends VideoDto {
  clips: ClipDto[];
}

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

export async function listVideos(): Promise<VideoWithClipsDto[]> {
  const res = await apiFetch('/videos');
  return parseJsonOrThrow<VideoWithClipsDto[]>(res);
}

export function clipDownloadUrl(downloadUrl: string): string {
  return `${API_URL}${downloadUrl}`;
}

export { API_URL };
