/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { archiveNotificationsV2, retryVideo } from '@/lib/api';
import { NotificationRowV2 } from './NotificationRowV2';

jest.mock('@/lib/api', () => ({
  archiveNotificationsV2: jest.fn().mockResolvedValue({ count: 1 }),
  retryVideo: jest.fn().mockResolvedValue({}),
}));

jest.mock('next/link', () => {
  return function MockLink({ href, children }: { href: string; children: React.ReactNode }) {
    return <a href={href}>{children}</a>;
  };
});

const mockArchive = archiveNotificationsV2 as jest.Mock;
const mockRetry = retryVideo as jest.Mock;

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
    actions: ['OPEN_CLIP', 'DISMISS'],
    ...overrides,
  } as never;
}

function renderRow(
  overrides: Record<string, unknown> = {},
  props: Partial<Parameters<typeof NotificationRowV2>[0]> = {},
) {
  const onToggleSelect = jest.fn();
  const onOpenThread = jest.fn();
  const onAfterAction = jest.fn();
  const onMarkRead = jest.fn();
  render(
    <ul>
      <NotificationRowV2
        notification={notification(overrides)}
        selected={false}
        onToggleSelect={onToggleSelect}
        onOpenThread={onOpenThread}
        onAfterAction={onAfterAction}
        onMarkRead={onMarkRead}
        {...props}
      />
    </ul>,
  );
  return { onToggleSelect, onOpenThread, onAfterAction, onMarkRead };
}

describe('NotificationRowV2', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the title, body, and priority badge', () => {
    renderRow();
    expect(screen.getByText('Klip siap!')).toBeInTheDocument();
    expect(screen.getByText('Klip Anda sudah siap ditonton.')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
  });

  it('marks unread visually and announces it to screen readers, never via color alone', () => {
    renderRow({ readAt: null });
    expect(screen.getByText('(belum dibaca)')).toBeInTheDocument();
  });

  it('does not mark read a second time once already read', () => {
    renderRow({ readAt: '2026-07-27T00:01:00.000Z' });
    expect(screen.queryByText('(belum dibaca)')).not.toBeInTheDocument();
  });

  it('calls onMarkRead and onOpenThread when a thread-linked title is clicked', () => {
    const { onMarkRead, onOpenThread } = renderRow({
      thread: { id: 'thread-1', status: 'IN_PROGRESS', lastActivityAt: '2026-07-27T00:00:00.000Z' },
    });

    fireEvent.click(screen.getByText('Klip siap!'));

    expect(onMarkRead).toHaveBeenCalled();
    expect(onOpenThread).toHaveBeenCalledWith('thread-1');
  });

  it('toggles selection via the checkbox', () => {
    const { onToggleSelect } = renderRow();

    fireEvent.click(screen.getByRole('checkbox', { name: /Pilih notifikasi/ }));

    expect(onToggleSelect).toHaveBeenCalled();
  });

  it('renders a real progress bar from real renderedClips/totalClips metadata, not a fabricated value', () => {
    renderRow({
      metadata: { renderedClips: 1, totalClips: 4 },
      actions: ['DISMISS'],
    });

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '25');
  });

  it('calls retryVideo and onAfterAction when Coba Lagi is clicked', async () => {
    const { onAfterAction } = renderRow({ actions: ['RETRY', 'DISMISS'] });

    fireEvent.click(screen.getByText('Coba Lagi'));

    await screen.findByText('Coba Lagi');
    expect(mockRetry).toHaveBeenCalledWith('video-1');
    expect(onAfterAction).toHaveBeenCalled();
  });

  it('calls archiveNotificationsV2 with only this row id when Abaikan is clicked', async () => {
    const { onAfterAction } = renderRow({ actions: ['DISMISS'] });

    fireEvent.click(screen.getByText('Abaikan'));

    await screen.findByText('Abaikan');
    expect(mockArchive).toHaveBeenCalledWith(['notif-1']);
    expect(onAfterAction).toHaveBeenCalled();
  });

  it('expands technical detail (Detail Teknis) inline without navigating away', () => {
    renderRow({
      metadata: { errorMessage: 'Whisper API timed out' },
      actions: ['VIEW_LOGS', 'DISMISS'],
    });

    expect(screen.queryByText('Whisper API timed out')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Detail Teknis'));
    expect(screen.getByText('Whisper API timed out')).toBeInTheDocument();
  });

  it('renders a real destination link (not a fabricated one) for a navigation action', () => {
    renderRow({ actions: ['OPEN_CLIP'] });

    const link = screen.getByRole('link', { name: 'Buka Klip' });
    expect(link).toHaveAttribute('href', '/videos/video-1/edit');
  });

  it('shows the group occurrence badge only when occurrenceCount > 1', () => {
    renderRow({
      group: { id: 'group-1', occurrenceCount: 3, lastOccurredAt: '2026-07-27T00:00:00.000Z' },
    });
    expect(screen.getByText('×3')).toBeInTheDocument();
  });
});
