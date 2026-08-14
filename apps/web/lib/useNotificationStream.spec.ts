/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { useNotificationStream } from './useNotificationStream';
import { refreshSession } from './api';

// Reliability fix (2026-08) - onerror now fires a best-effort session
// refresh (see the hook's own comment); mocked so these tests exercise the
// call without a real network request.
jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  refreshSession: jest.fn().mockResolvedValue(true),
}));

// jsdom has no native EventSource - a small mock class standing in for it,
// capturing the instance so tests can drive onopen/onmessage/onerror
// directly.
class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;
  constructor(
    public url: string,
    public options: { withCredentials?: boolean },
  ) {
    MockEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

describe('useNotificationStream', () => {
  const originalEventSource = (global as { EventSource?: unknown }).EventSource;

  beforeEach(() => {
    MockEventSource.instances = [];
    (global as { EventSource?: unknown }).EventSource = MockEventSource;
    jest.mocked(refreshSession).mockClear();
  });

  afterEach(() => {
    (global as { EventSource?: unknown }).EventSource = originalEventSource;
  });

  it('opens an EventSource with withCredentials and reports connected on open', () => {
    const { result } = renderHook(() => useNotificationStream(jest.fn()));

    expect(result.current.connected).toBe(false);
    const instance = MockEventSource.instances[0];
    expect(instance.options).toEqual({ withCredentials: true });

    act(() => instance.onopen?.());

    expect(result.current.connected).toBe(true);
  });

  it('calls onEvent for a genuine message, but not for a heartbeat', () => {
    const onEvent = jest.fn();
    renderHook(() => useNotificationStream(onEvent));
    const instance = MockEventSource.instances[0];

    act(() => instance.onmessage?.({ data: JSON.stringify({ type: 'heartbeat' }) }));
    expect(onEvent).not.toHaveBeenCalled();

    act(() =>
      instance.onmessage?.({
        data: JSON.stringify({
          userId: 'user-1',
          notificationId: 'notif-1',
          type: 'UPLOAD_COMPLETE',
        }),
      }),
    );
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('treats a malformed message as a real nudge (fails open)', () => {
    const onEvent = jest.fn();
    renderHook(() => useNotificationStream(onEvent));
    const instance = MockEventSource.instances[0];

    act(() => instance.onmessage?.({ data: 'not json' }));

    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('reports disconnected on error', () => {
    const { result } = renderHook(() => useNotificationStream(jest.fn()));
    const instance = MockEventSource.instances[0];

    act(() => instance.onopen?.());
    expect(result.current.connected).toBe(true);

    act(() => instance.onerror?.());
    expect(result.current.connected).toBe(false);
  });

  // Reliability fix (2026-08) - the actual root cause of the
  // "(mode polling - koneksi real-time terputus)" banner staying stuck: an
  // expired access-token cookie made every one of EventSource's own
  // automatic retries fail forever, since nothing ever refreshed it. onerror
  // now fires a best-effort refresh so the cookie is fresh again for the
  // next automatic retry.
  it('fires a best-effort session refresh on error', () => {
    renderHook(() => useNotificationStream(jest.fn()));
    const instance = MockEventSource.instances[0];

    expect(refreshSession).not.toHaveBeenCalled();
    act(() => instance.onerror?.());

    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('closes the EventSource on unmount', () => {
    const { unmount } = renderHook(() => useNotificationStream(jest.fn()));
    const instance = MockEventSource.instances[0];

    unmount();

    expect(instance.closed).toBe(true);
  });

  it('stays disconnected and never throws when EventSource is unavailable', () => {
    delete (global as { EventSource?: unknown }).EventSource;

    const { result } = renderHook(() => useNotificationStream(jest.fn()));

    expect(result.current.connected).toBe(false);
    expect(MockEventSource.instances).toHaveLength(0);
  });
});
