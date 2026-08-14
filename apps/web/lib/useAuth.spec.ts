/** @jest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { UserRole } from '@speedora/shared';
import { useAuth } from './useAuth';
import { refreshSession } from './api';

// Reliability fix (2026-08) - see refreshSession's own comment in api.ts for
// the full root-cause story. me()/logout aren't under test here, only the
// scheduled-refresh addition, so both are stubbed to keep these tests
// focused.
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  me: jest.fn().mockResolvedValue(null),
  logout: jest.fn().mockResolvedValue(undefined),
  refreshSession: jest.fn().mockResolvedValue(true),
}));

const SILENT_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

describe('useAuth scheduled silent refresh', () => {
  const user = { id: 'u1', email: 'a@b.com', role: UserRole.CREATOR, emailVerified: true };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(refreshSession).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not schedule a refresh when no user is logged in', async () => {
    const { result } = renderHook(() => useAuth(null));

    // Lets the mocked me() call (initialUser === null triggers it) settle
    // before advancing timers, so its own unrelated setState isn't what
    // trips the assertion below.
    await waitFor(() => expect(result.current.checkingAuth).toBe(false));

    jest.advanceTimersByTime(SILENT_REFRESH_INTERVAL_MS * 2);

    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes on the scheduled interval while a user is logged in', () => {
    renderHook(() => useAuth(user));

    expect(refreshSession).not.toHaveBeenCalled();

    jest.advanceTimersByTime(SILENT_REFRESH_INTERVAL_MS);
    expect(refreshSession).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(SILENT_REFRESH_INTERVAL_MS);
    expect(refreshSession).toHaveBeenCalledTimes(2);
  });

  it('stops refreshing after logout', async () => {
    const { result } = renderHook(() => useAuth(user));

    await waitFor(() => expect(result.current.user).toEqual(user));

    // logout() itself is mocked (no real API call) - what matters here is
    // that setUser(null) unschedules the interval, same as never having
    // been logged in. Wrapped in act() so the resulting re-render (and the
    // interval-clearing effect cleanup it triggers) actually flushes before
    // fake timers are advanced below.
    await act(async () => {
      await result.current.logout();
    });

    jest.advanceTimersByTime(SILENT_REFRESH_INTERVAL_MS * 2);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('unschedules the refresh interval on unmount', () => {
    const { unmount } = renderHook(() => useAuth(user));

    unmount();

    jest.advanceTimersByTime(SILENT_REFRESH_INTERVAL_MS * 2);
    expect(refreshSession).not.toHaveBeenCalled();
  });
});
