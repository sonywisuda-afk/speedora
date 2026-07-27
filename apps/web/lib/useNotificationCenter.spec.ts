/** @jest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import {
  archiveNotificationsV2,
  deleteNotificationsV2,
  getUnreadNotificationCountV2,
  listNotificationsV2,
  markAllNotificationsReadV2,
  markNotificationsReadV2,
} from './api';
import { useNotificationCenter } from './useNotificationCenter';

jest.mock('./api', () => ({
  listNotificationsV2: jest.fn(),
  getUnreadNotificationCountV2: jest.fn(),
  markNotificationsReadV2: jest.fn(),
  markAllNotificationsReadV2: jest.fn(),
  archiveNotificationsV2: jest.fn(),
  deleteNotificationsV2: jest.fn(),
}));

const mockList = listNotificationsV2 as jest.Mock;
const mockUnreadCount = getUnreadNotificationCountV2 as jest.Mock;
const mockMarkRead = markNotificationsReadV2 as jest.Mock;
const mockMarkAllRead = markAllNotificationsReadV2 as jest.Mock;
const mockArchive = archiveNotificationsV2 as jest.Mock;
const mockDelete = deleteNotificationsV2 as jest.Mock;

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }
  close() {}
}

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notif-1',
    type: 'CLIP_READY',
    category: 'CLIP_GENERATION',
    priority: 'SUCCESS',
    title: 'Klip siap!',
    body: 'Klip Anda sudah siap ditonton.',
    videoId: 'video-1',
    clipId: 'clip-1',
    metadata: null,
    readAt: null,
    archivedAt: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    thread: null,
    group: null,
    deepLink: '/videos/video-1/edit',
    actions: ['DISMISS'],
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children);
}

describe('useNotificationCenter', () => {
  const originalEventSource = (global as { EventSource?: unknown }).EventSource;

  beforeEach(() => {
    jest.clearAllMocks();
    MockEventSource.instances = [];
    (global as { EventSource?: unknown }).EventSource = MockEventSource;
    mockUnreadCount.mockResolvedValue({ count: 2 });
  });

  afterEach(() => {
    (global as { EventSource?: unknown }).EventSource = originalEventSource;
  });

  it('loads the first page and exposes it flattened', async () => {
    mockList.mockResolvedValue({ notifications: [notification()], nextCursor: null });

    const { result } = renderHook(() => useNotificationCenter(), { wrapper });

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    expect(result.current.hasMore).toBe(false);
    expect(result.current.unreadCount).toBe(2);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'all', cursor: undefined }),
    );
  });

  it('reports hasMore: true when a page returns a nextCursor', async () => {
    mockList.mockResolvedValue({
      notifications: [notification()],
      nextCursor: 'notif-2',
    });

    const { result } = renderHook(() => useNotificationCenter(), { wrapper });

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);
  });

  it('re-queries with the new filter and clears selection when filters change', async () => {
    mockList.mockResolvedValue({ notifications: [notification()], nextCursor: null });
    const { result } = renderHook(() => useNotificationCenter(), { wrapper });
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));

    act(() => result.current.toggleSelected('notif-1'));
    expect(result.current.selected.has('notif-1')).toBe(true);

    act(() => result.current.updateFilters({ state: 'unread' }));

    expect(result.current.selected.size).toBe(0);
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ state: 'unread' })),
    );
  });

  it('bulkMarkRead sends only the selected ids and clears selection afterward', async () => {
    mockList.mockResolvedValue({
      notifications: [notification({ id: 'a' }), notification({ id: 'b' })],
      nextCursor: null,
    });
    mockMarkRead.mockResolvedValue({ count: 1 });
    const { result } = renderHook(() => useNotificationCenter(), { wrapper });
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));

    act(() => result.current.toggleSelected('a'));
    await act(async () => {
      await result.current.bulkMarkRead();
    });

    expect(mockMarkRead).toHaveBeenCalledWith(['a']);
    expect(result.current.selected.size).toBe(0);
  });

  it('bulkArchive and bulkDelete are no-ops with an empty selection', async () => {
    mockList.mockResolvedValue({ notifications: [], nextCursor: null });
    const { result } = renderHook(() => useNotificationCenter(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.bulkArchive();
      await result.current.bulkDelete();
    });

    expect(mockArchive).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('markAllRead calls the bulk read-all endpoint and refreshes', async () => {
    mockList.mockResolvedValue({ notifications: [notification()], nextCursor: null });
    mockMarkAllRead.mockResolvedValue({ count: 2 });
    const { result } = renderHook(() => useNotificationCenter(), { wrapper });
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));

    await act(async () => {
      await result.current.markAllRead();
    });

    expect(mockMarkAllRead).toHaveBeenCalled();
  });

  it('names what changed in the SSE announcement when an existing notification is updated', async () => {
    mockList
      .mockResolvedValueOnce({ notifications: [notification()], nextCursor: null })
      .mockResolvedValueOnce({
        notifications: [notification({ title: 'Video selesai diproses', updatedAt: '2026-07-27T00:05:00.000Z' })],
        nextCursor: null,
      });

    const { result } = renderHook(() => useNotificationCenter(), { wrapper });
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));

    const instance = MockEventSource.instances[0];
    await act(async () => {
      instance.onmessage?.({ data: JSON.stringify({ userId: 'user-1' }) });
      await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    });

    await waitFor(() =>
      expect(result.current.announcement).toBe('Notifikasi diperbarui: Video selesai diproses'),
    );
  });

  it('does not announce anything for the initial load itself', async () => {
    mockList.mockResolvedValue({ notifications: [notification()], nextCursor: null });
    const { result } = renderHook(() => useNotificationCenter(), { wrapper });
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));

    expect(result.current.announcement).toBe('');
  });
});
