import { useCallback, useEffect, useState } from 'react';
import { logout as apiLogout, me, type UserDto } from './api';

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

  return { user, setUser, checkingAuth, logout };
}
