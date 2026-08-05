/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { ActivityEventType, type ActivityEventDto } from '@speedora/shared';
import { deleteActivityEvents, deleteAllActivityEvents, getDashboardActivity } from '@/lib/api';
import { ActivityTimeline } from './ActivityTimeline';

jest.mock('@/lib/api', () => ({
  getDashboardActivity: jest.fn(),
  deleteActivityEvents: jest.fn(),
  deleteAllActivityEvents: jest.fn(),
}));

const mockList = getDashboardActivity as jest.Mock;
const mockDelete = deleteActivityEvents as jest.Mock;
const mockDeleteAll = deleteAllActivityEvents as jest.Mock;

function event(
  overrides: { type: string } & Partial<Omit<ActivityEventDto, 'type'>>,
): ActivityEventDto {
  return {
    id: 'event-1',
    videoId: null,
    clipId: null,
    metadata: null,
    title: null,
    description: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as ActivityEventDto;
}

// Every render is wrapped in a fresh SWRConfig cache provider, same
// isolation convention useNotificationCenter.spec.ts uses, so one test's
// cached 'dashboard-activity'/'dashboard-activity-peek' keys never leak
// into the next.
function renderTimeline() {
  return render(
    createElement(
      SWRConfig,
      { value: { provider: () => new Map() } },
      createElement(ActivityTimeline, {}),
    ),
  );
}

// Routes the shared getDashboardActivity mock to the right response by
// limit (the hook fires a { limit: 1 } peek alongside the main paginated
// list through the same function) - same convention as
// lib/useActivityTimeline.spec.ts's own mockListAndPeek.
function mockListAndPeek(
  listResult: unknown,
  peekResult: unknown = { events: [], nextCursor: null },
) {
  mockList.mockImplementation((params: { limit?: number } = {}) =>
    Promise.resolve(params.limit === 1 ? peekResult : listResult),
  );
}

describe('ActivityTimeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a known event type with title/description', async () => {
    mockListAndPeek({
      events: [
        event({
          type: 'WORKSPACE_DELETED',
          title: 'Menghapus workspace',
          description: 'Acme',
        }),
      ],
      nextCursor: null,
    });

    renderTimeline();

    expect(await screen.findByText('Menghapus workspace')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  // Tahap 5 - runtime safety net: an event.type the frontend build doesn't
  // recognize yet (e.g. a live frontend/backend version skew mid-deploy)
  // must degrade to a generic row, never throw "Element type is invalid"
  // the way the original WORKSPACE_DELETED bug did.
  it('falls back to a generic row instead of crashing on an unrecognized event type', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockListAndPeek({
      events: [event({ type: 'SOMETHING_NEW_FROM_A_NEWER_BACKEND' })],
      nextCursor: null,
    });

    renderTimeline();

    expect(await screen.findByText('Unknown activity')).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('SOMETHING_NEW_FROM_A_NEWER_BACKEND'),
      expect.anything(),
    );

    warnSpy.mockRestore();
  });

  it('shows the empty state when there are no events', async () => {
    mockListAndPeek({ events: [], nextCursor: null });

    renderTimeline();

    expect(await screen.findByText('Belum ada aktivitas.')).toBeInTheDocument();
  });

  it('shows a retryable error state when the fetch fails', async () => {
    mockList.mockRejectedValue(new Error('network down'));

    renderTimeline();

    expect(await screen.findByText('Tidak dapat memuat aktivitas.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba Lagi' })).toBeInTheDocument();
  });

  it('groups events under their time-bucket header', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 25 * 3600 * 1000);
    mockListAndPeek({
      events: [
        event({
          id: 'today-1',
          type: 'CLIP_GENERATED',
          title: 'Klip baru berhasil dibuat',
          createdAt: now.toISOString(),
        }),
        event({
          id: 'yesterday-1',
          type: 'CLIP_GENERATED',
          title: 'Klip baru berhasil dibuat',
          createdAt: yesterday.toISOString(),
        }),
      ],
      nextCursor: null,
    });

    renderTimeline();

    expect(await screen.findByText('Hari Ini')).toBeInTheDocument();
    expect(screen.getByText('Kemarin')).toBeInTheDocument();
  });

  it('shows a Load More button when hasMore, and fetches the next page on click', async () => {
    mockListAndPeek({
      events: [event({ id: 'e1', type: 'CLIP_GENERATED', title: 'Klip baru berhasil dibuat' })],
      nextCursor: 'e2',
    });

    renderTimeline();
    const loadMoreButton = await screen.findByRole('button', { name: 'Muat lebih banyak' });

    mockList.mockImplementation((params: { limit?: number; cursor?: string } = {}) => {
      if (params.limit === 1) return Promise.resolve({ events: [], nextCursor: null });
      if (params.cursor === 'e2') {
        return Promise.resolve({
          events: [event({ id: 'e2', type: 'CLIP_GENERATED', title: 'Klip baru berhasil dibuat' })],
          nextCursor: null,
        });
      }
      return Promise.resolve({
        events: [event({ id: 'e1', type: 'CLIP_GENERATED', title: 'Klip baru berhasil dibuat' })],
        nextCursor: 'e2',
      });
    });

    fireEvent.click(loadMoreButton);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).not.toBeInTheDocument(),
    );
  });

  it('re-fetches with the type filter when a filter chip is clicked', async () => {
    mockListAndPeek({ events: [], nextCursor: null });
    renderTimeline();
    await screen.findByText('Belum ada aktivitas.');

    fireEvent.click(screen.getByRole('button', { name: /Klip Dibuat/ }));

    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ type: ActivityEventType.CLIP_GENERATED }),
      ),
    );
  });

  it('re-fetches with the search query after the debounce settles', async () => {
    mockListAndPeek({ events: [], nextCursor: null });
    renderTimeline();
    await screen.findByText('Belum ada aktivitas.');

    fireEvent.change(screen.getByLabelText('Cari aktivitas'), { target: { value: 'acme' } });

    await waitFor(
      () => expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ q: 'acme' })),
      { timeout: 2000 },
    );
  });

  it('selecting a row shows the bulk toolbar, and deleting refreshes the list', async () => {
    mockListAndPeek({
      events: [event({ id: 'e1', type: 'CLIP_GENERATED', title: 'Klip baru berhasil dibuat' })],
      nextCursor: null,
    });
    mockDelete.mockResolvedValue({ count: 1 });
    renderTimeline();
    await screen.findByText('Klip baru berhasil dibuat');

    fireEvent.click(screen.getByLabelText(/Pilih aktivitas/));

    expect(
      await screen.findByRole('toolbar', { name: 'Aksi massal aktivitas' }),
    ).toBeInTheDocument();

    mockListAndPeek({ events: [], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Hapus Terpilih' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(['e1']));
  });

  it('deletes a single row via its own delete button', async () => {
    mockListAndPeek({
      events: [event({ id: 'e1', type: 'CLIP_GENERATED', title: 'Klip baru berhasil dibuat' })],
      nextCursor: null,
    });
    mockDelete.mockResolvedValue({ count: 1 });
    renderTimeline();
    await screen.findByText('Klip baru berhasil dibuat');

    fireEvent.click(screen.getByLabelText('Hapus aktivitas ini'));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(['e1']));
  });

  it('gates Clear All behind typing the literal word DELETE', async () => {
    mockListAndPeek({ events: [], nextCursor: null });
    mockDeleteAll.mockResolvedValue({ count: 5 });
    renderTimeline();
    await screen.findByText('Belum ada aktivitas.');

    fireEvent.click(screen.getByRole('button', { name: 'Hapus Semua' }));
    const confirmButton = await screen.findByRole('button', { name: 'Ya, Hapus Semua' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Ketik/), { target: { value: 'wrong' } });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Ketik/), { target: { value: 'DELETE' } });
    expect(confirmButton).not.toBeDisabled();

    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockDeleteAll).toHaveBeenCalled());
  });

  it('shows a new-activity banner once the peek sees a newer event, and refreshes on click', async () => {
    mockListAndPeek(
      {
        events: [event({ id: 'e1', type: 'CLIP_GENERATED', title: 'Klip baru berhasil dibuat' })],
        nextCursor: null,
      },
      { events: [event({ id: 'e1', type: 'CLIP_GENERATED' })], nextCursor: null },
    );
    renderTimeline();
    await screen.findByText('Klip baru berhasil dibuat');
    expect(screen.queryByText('Aktivitas baru tersedia')).not.toBeInTheDocument();

    mockList.mockImplementation((params: { limit?: number } = {}) =>
      Promise.resolve(
        params.limit === 1
          ? { events: [event({ id: 'e2', type: 'CLIP_GENERATED' })], nextCursor: null }
          : {
              events: [
                event({ id: 'e2', type: 'CLIP_GENERATED', title: 'Klip baru berhasil dibuat' }),
              ],
              nextCursor: null,
            },
      ),
    );

    await screen.findByText('Aktivitas baru tersedia', {}, { timeout: 15000 });

    fireEvent.click(screen.getByRole('button', { name: 'Tampilkan' }));

    await waitFor(() =>
      expect(screen.queryByText('Aktivitas baru tersedia')).not.toBeInTheDocument(),
    );
  }, 20000);
});
