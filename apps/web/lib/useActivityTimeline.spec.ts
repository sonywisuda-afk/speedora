/** @jest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { ActivityEventType, type ActivityEventDto } from '@speedora/shared';
import { deleteActivityEvents, deleteAllActivityEvents, getDashboardActivity } from './api';
import { useActivityTimeline } from './useActivityTimeline';

jest.mock('./api', () => ({
  getDashboardActivity: jest.fn(),
  deleteActivityEvents: jest.fn(),
  deleteAllActivityEvents: jest.fn(),
}));

const mockList = getDashboardActivity as jest.Mock;
const mockDelete = deleteActivityEvents as jest.Mock;
const mockDeleteAll = deleteAllActivityEvents as jest.Mock;

function event(overrides: Partial<ActivityEventDto> = {}): ActivityEventDto {
  return {
    id: 'event-1',
    type: ActivityEventType.VIDEO_UPLOADED,
    videoId: 'video-1',
    clipId: null,
    metadata: null,
    title: 'Video diunggah',
    description: 'My Video',
    createdAt: '2026-08-15T08:00:00.000Z',
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children);
}

// The hook fires two independent GET /dashboard/activity calls (the main
// paginated list and the { limit: 1 } "new activity" peek) through the same
// mocked function - route by the limit param so each test can control them
// independently without a second mock.
function mockListAndPeek(
  listResult: unknown,
  peekResult: unknown = { events: [], nextCursor: null },
) {
  mockList.mockImplementation((params: { limit?: number } = {}) =>
    Promise.resolve(params.limit === 1 ? peekResult : listResult),
  );
}

describe('useActivityTimeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the first page and exposes it flattened', async () => {
    mockListAndPeek({ events: [event()], nextCursor: null });

    const { result } = renderHook(() => useActivityTimeline(), { wrapper });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.hasMore).toBe(false);
  });

  it('reports hasMore: true when a page returns a nextCursor', async () => {
    mockListAndPeek({ events: [event()], nextCursor: 'event-2' });

    const { result } = renderHook(() => useActivityTimeline(), { wrapper });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);
  });

  it('loadMore fetches the next page using the previous nextCursor', async () => {
    mockListAndPeek({ events: [event({ id: 'event-1' })], nextCursor: 'event-2' });

    const { result } = renderHook(() => useActivityTimeline(), { wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    mockList.mockImplementation((params: { limit?: number; cursor?: string } = {}) => {
      if (params.limit === 1) return Promise.resolve({ events: [], nextCursor: null });
      if (params.cursor === 'event-2') {
        return Promise.resolve({ events: [event({ id: 'event-2' })], nextCursor: null });
      }
      return Promise.resolve({ events: [event({ id: 'event-1' })], nextCursor: 'event-2' });
    });

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
  });

  it('does not load more while already validating or with no more pages', async () => {
    mockListAndPeek({ events: [event()], nextCursor: null });
    const { result } = renderHook(() => useActivityTimeline(), { wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    const callsBefore = mockList.mock.calls.length;
    act(() => result.current.loadMore());
    expect(mockList.mock.calls.length).toBe(callsBefore);
  });

  it('re-queries with the new filter and clears selection when filters change', async () => {
    mockListAndPeek({ events: [event()], nextCursor: null });
    const { result } = renderHook(() => useActivityTimeline(), { wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    act(() => result.current.toggleSelected('event-1'));
    expect(result.current.selected.has('event-1')).toBe(true);

    act(() => result.current.updateFilters({ q: 'acme' }));

    expect(result.current.selected.size).toBe(0);
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ q: 'acme' })),
    );
  });

  it('deleteSelected and deleteOne are no-ops with nothing selected/no id', async () => {
    mockListAndPeek({ events: [], nextCursor: null });
    const { result } = renderHook(() => useActivityTimeline(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteSelected();
    });

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deleteSelected sends only the selected ids and clears selection afterward', async () => {
    mockListAndPeek({
      events: [event({ id: 'a' }), event({ id: 'b' })],
      nextCursor: null,
    });
    mockDelete.mockResolvedValue({ count: 1 });
    const { result } = renderHook(() => useActivityTimeline(), { wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(2));

    act(() => result.current.toggleSelected('a'));
    await act(async () => {
      await result.current.deleteSelected();
    });

    expect(mockDelete).toHaveBeenCalledWith(['a']);
    expect(result.current.selected.size).toBe(0);
  });

  it('deleteOne sends a single-element ids array', async () => {
    mockListAndPeek({ events: [event({ id: 'a' })], nextCursor: null });
    mockDelete.mockResolvedValue({ count: 1 });
    const { result } = renderHook(() => useActivityTimeline(), { wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    await act(async () => {
      await result.current.deleteOne('a');
    });

    expect(mockDelete).toHaveBeenCalledWith(['a']);
  });

  it('deleteAll calls the clear-all endpoint and collapses back to one page', async () => {
    mockListAndPeek({ events: [event()], nextCursor: 'event-2' });
    mockDeleteAll.mockResolvedValue({ count: 37 });
    const { result } = renderHook(() => useActivityTimeline(), { wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    mockListAndPeek({ events: [], nextCursor: null });
    await act(async () => {
      await result.current.deleteAll();
    });

    expect(mockDeleteAll).toHaveBeenCalled();
    expect(result.current.events).toHaveLength(0);
  });

  it('does not flag new activity on the initial mount', async () => {
    mockListAndPeek(
      { events: [event({ id: 'event-1' })], nextCursor: null },
      { events: [event({ id: 'event-1' })], nextCursor: null },
    );

    const { result } = renderHook(() => useActivityTimeline(), { wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    expect(result.current.hasNewActivity).toBe(false);
  });

  it('flags new activity once the peek sees a newer id than the loaded baseline', async () => {
    mockListAndPeek(
      { events: [event({ id: 'event-1' })], nextCursor: null },
      { events: [event({ id: 'event-1' })], nextCursor: null },
    );

    const { result } = renderHook(() => useActivityTimeline(), { wrapper });
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.hasNewActivity).toBe(false);

    mockList.mockImplementation((params: { limit?: number } = {}) =>
      Promise.resolve(
        params.limit === 1
          ? { events: [event({ id: 'event-2' })], nextCursor: null }
          : { events: [event({ id: 'event-1' })], nextCursor: null },
      ),
    );

    await waitFor(() => expect(result.current.hasNewActivity).toBe(true), { timeout: 15000 });
  }, 20000);
});
