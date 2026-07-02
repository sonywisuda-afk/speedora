import { useCallback, useEffect, useState } from 'react';
import { logout as apiLogout, me, type UserDto } from './api';

export function useAuth() {
  const [user, setUser] = useState<UserDto | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    me()
      .then(setUser)
      .finally(() => setCheckingAuth(false));
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return { user, setUser, checkingAuth, logout };
}
