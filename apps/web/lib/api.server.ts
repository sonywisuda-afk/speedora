import { cookies } from 'next/headers';
import type {
  DashboardActivityDto,
  DashboardStatsDto,
  PaginatedVideos,
  PendingInviteDto,
  PendingInviteRole,
} from '@speedora/shared';
import { API_URL, parseJsonOrThrow, type UserDto } from './api';

// Product Experience performance pass (Dashboard <1s) - Server Component-only
// counterpart to lib/api.ts's apiFetch. The session lives in an httpOnly
// cookie (see apps/api/src/auth/auth.controller.ts's COOKIE_NAME='token'),
// which the browser attaches automatically via credentials:'include' -  but
// a Server Component's fetch has no browser cookie jar, so the cookie has to
// be read via next/headers and forwarded explicitly as a request header
// instead. Only import this from Server Components/Server Actions - next/
// headers throws if it's ever pulled into a client bundle, which is the
// enforcement mechanism (no separate 'server-only' package dependency
// needed).
function serverApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = cookies().get('token')?.value;
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, ...(token ? { Cookie: `token=${token}` } : {}) },
    cache: 'no-store',
  });
}

// Mirrors lib/api.ts's me() but never throws on a missing/expired session -
// the dashboard Server Component treats "not logged in" as a normal render
// branch (the existing "Masuk" prompt), not an error.
export async function getServerUser(): Promise<UserDto | null> {
  const res = await serverApiFetch('/auth/me');
  if (!res.ok) return null;
  return parseJsonOrThrow<UserDto>(res);
}

export async function getServerVideos(params?: {
  cursor?: string;
  limit?: number;
}): Promise<PaginatedVideos> {
  const query = new URLSearchParams();
  if (params?.cursor) query.set('cursor', params.cursor);
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  const res = await serverApiFetch(`/videos${qs ? `?${qs}` : ''}`);
  return parseJsonOrThrow<PaginatedVideos>(res);
}

export async function getServerDashboardStats(): Promise<DashboardStatsDto> {
  const res = await serverApiFetch('/dashboard/stats');
  return parseJsonOrThrow<DashboardStatsDto>(res);
}

export async function getServerDashboardActivity(): Promise<DashboardActivityDto> {
  const res = await serverApiFetch('/dashboard/activity');
  return parseJsonOrThrow<DashboardActivityDto>(res);
}

// Used by app/dashboard/actions.ts's Server Action - same POST /team/invites
// call as lib/api.ts's sendTeamInvite, just cookie-forwarded instead of
// browser-credentialed.
export async function postServerTeamInvite(
  email: string,
  role: PendingInviteRole,
): Promise<PendingInviteDto> {
  const res = await serverApiFetch('/team/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
  return parseJsonOrThrow<PendingInviteDto>(res);
}
