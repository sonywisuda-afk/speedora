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

export async function resolveUser(email: string): Promise<UserDto> {
  const res = await fetch(`${API_URL}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return parseJsonOrThrow<UserDto>(res);
}

export async function uploadVideo(ownerId: string, file: File): Promise<VideoDto> {
  const formData = new FormData();
  formData.append('ownerId', ownerId);
  formData.append('file', file);

  const res = await fetch(`${API_URL}/videos`, {
    method: 'POST',
    body: formData,
  });
  return parseJsonOrThrow<VideoDto>(res);
}

export async function getVideo(id: string): Promise<VideoWithClipsDto> {
  const res = await fetch(`${API_URL}/videos/${id}`);
  return parseJsonOrThrow<VideoWithClipsDto>(res);
}

export function clipDownloadUrl(downloadUrl: string): string {
  return `${API_URL}${downloadUrl}`;
}

export { API_URL };
