'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from './api';

// Milestone 04c - a thin EventSource wrapper. `withCredentials: true` is
// required for the httpOnly auth cookie to be sent cross-origin (same
// reasoning apiFetch's `credentials: 'include'` already documents).
// EventSource has native auto-reconnect built in - this hook doesn't
// reimplement retry logic, it only tracks connection health so the caller
// (NotificationBell) can decide how aggressively to keep polling as a
// fallback.
export function useNotificationStream(onEvent: () => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (typeof window === 'undefined' || !('EventSource' in window)) return;

    const es = new EventSource(`${API_URL}/notifications/stream`, { withCredentials: true });
    es.onopen = () => setConnected(true);
    // EventSource auto-reconnects on its own - this just tracks health so
    // polling can speed back up until it reconnects.
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload?.type === 'heartbeat') return;
      } catch {
        // Malformed payload - fail open and treat it as a real nudge rather
        // than silently dropping a notification.
      }
      onEventRef.current();
    };

    return () => es.close();
  }, []);

  return { connected };
}
