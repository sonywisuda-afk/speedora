import { useCallback, useEffect, useState } from 'react';
import { logout as apiLogout, me, refreshSession, type UserDto } from './api';

// Reliability fix (2026-08) - refreshes well ahead of the access token's own
// 15m TTL (apps/api's ACCESS_COOKIE_MAX_AGE_MS) so an active session's SSE
// stream and SWR polling never actually hit a 401 in normal use, rather than
// only recovering reactively after the fact. See the fuller root-cause
// comment on refreshSession in lib/api.ts.
const SILENT_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

// `initialUser` (Product Experience performance pass) - when a Server
// Component already fetched GET /auth/me (using the forwarded httpOnly
// cookie, see lib/api.server.ts), pass its result here so the dashboard
// renders as logged-in on the very first client render instead of starting
// at `null` and waiting on a redundant client-side round trip. Callers with
// no server-fetched user (every other page) omit it and get the original
// client-only behavior.
export function useAuth(initialUser: UserDto | null = null) {
  const [user, setUser] = useState<UserDto | null>(initialUser);
  const [checkingAuth, setCheckingAuth] = useState(initialUser === null);

  useEffect(() => {
    if (initialUser !== null) return;
    me()
      .then(setUser)
      .finally(() => setCheckingAuth(false));
    // Only ever meant to run once per mount, seeded by the initial prop at
    // mount time - re-running on every initialUser identity change would
    // defeat the point (and initialUser is only ever passed by the
    // dashboard's Server Component, which doesn't re-render this hook).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  // Keyed on `Boolean(user)`, not `user` itself - setUser gets called with a
  // fresh object on every me()/login revalidation even when "logged in"
  // hasn't actually changed, and re-keying on identity would tear down and
  // reschedule this interval far more often than intended.
  const isLoggedIn = Boolean(user);
  useEffect(() => {
    if (!isLoggedIn) return;
    const id = setInterval(() => {
      void refreshSession();
    }, SILENT_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isLoggedIn]);

  return { user, setUser, checkingAuth, logout };
}
