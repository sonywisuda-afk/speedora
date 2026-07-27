/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { NotificationListV2 } from './NotificationListV2';

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
  } as never;
}

const baseProps = {
  notifications: [] as never[],
  isLoading: false,
  error: null,
  hasMore: false,
  isValidating: false,
  onLoadMore: jest.fn(),
  selected: new Set<string>(),
  onToggleSelect: jest.fn(),
  onOpenThread: jest.fn(),
  onAfterAction: jest.fn(),
  onMarkRead: jest.fn(),
  onRetry: jest.fn(),
};

describe('NotificationListV2', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a loading skeleton (aria-busy) while loading, never an empty state', () => {
    render(<NotificationListV2 {...baseProps} isLoading />);

    expect(screen.getByLabelText('Memuat notifikasi')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Belum ada notifikasi.')).not.toBeInTheDocument();
  });

  it('shows an accessible alert with a retry action on error', () => {
    const onRetry = jest.fn();
    render(<NotificationListV2 {...baseProps} error={new Error('boom')} onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Gagal memuat notifikasi.');
    fireEvent.click(screen.getByText('Coba Lagi'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows a real empty state (not a spinner, not an error) when there is genuinely nothing', () => {
    render(<NotificationListV2 {...baseProps} notifications={[]} />);

    expect(screen.getByText('Belum ada notifikasi.')).toBeInTheDocument();
  });

  it('renders every notification as a feed item once loaded', () => {
    render(
      <NotificationListV2
        {...baseProps}
        notifications={[notification({ id: 'a' }), notification({ id: 'b', title: 'Klip 2' })]}
      />,
    );

    expect(screen.getByRole('feed', { name: 'Daftar notifikasi' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('shows the load-more control only when hasMore is true, and calls onLoadMore', () => {
    const onLoadMore = jest.fn();
    const { rerender } = render(
      <NotificationListV2
        {...baseProps}
        notifications={[notification()]}
        hasMore={false}
        onLoadMore={onLoadMore}
      />,
    );
    expect(screen.queryByText('Muat lebih banyak')).not.toBeInTheDocument();

    rerender(
      <NotificationListV2
        {...baseProps}
        notifications={[notification()]}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );
    fireEvent.click(screen.getByText('Muat lebih banyak'));
    expect(onLoadMore).toHaveBeenCalled();
  });
});
