/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { getNotificationThreadDetail, retryVideo } from '@/lib/api';
import { NotificationThreadPanel } from './NotificationThreadPanel';

jest.mock('@/lib/api', () => ({
  getNotificationThreadDetail: jest.fn(),
  retryVideo: jest.fn().mockResolvedValue({}),
}));

const mockGetThreadDetail = getNotificationThreadDetail as jest.Mock;
const mockRetry = retryVideo as jest.Mock;

function threadDetail(overrides: Record<string, unknown> = {}) {
  return {
    thread: {
      id: 'thread-1',
      videoId: 'video-1',
      title: 'Memproses "My Video"',
      status: 'IN_PROGRESS',
      lastActivityAt: '2026-07-27T00:05:00.000Z',
      archivedAt: null,
      createdAt: '2026-07-27T00:00:00.000Z',
    },
    notification: null,
    timeline: {
      videoId: 'video-1',
      overallStatus: 'in_progress',
      failureReason: null,
      failureHistory: [],
      stages: [
        {
          stage: 'UPLOAD_COMPLETED',
          label: 'Upload Completed',
          status: 'done',
          startedAt: '2026-07-27T00:00:00.000Z',
          completedAt: '2026-07-27T00:01:00.000Z',
          progressPercent: null,
          detail: null,
        },
        {
          stage: 'RENDERING',
          label: 'Rendering',
          status: 'active',
          startedAt: '2026-07-27T00:03:00.000Z',
          completedAt: null,
          progressPercent: 40,
          detail: '2 of 5 clips rendered',
        },
      ],
    },
    ...overrides,
  };
}

function renderPanel(threadId: string | null, props: Record<string, unknown> = {}) {
  const onClose = jest.fn();
  const onAfterAction = jest.fn();
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <NotificationThreadPanel
        threadId={threadId}
        onClose={onClose}
        onAfterAction={onAfterAction}
        {...props}
      />
    </SWRConfig>,
  );
  return { onClose, onAfterAction };
}

describe('NotificationThreadPanel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing (closed dialog) when threadId is null', () => {
    renderPanel(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the real per-stage timeline once loaded - never a fabricated stage', async () => {
    mockGetThreadDetail.mockResolvedValue(threadDetail());

    renderPanel('thread-1');

    await waitFor(() => expect(screen.getByText('Upload Completed')).toBeInTheDocument());
    expect(screen.getByText('Rendering')).toBeInTheDocument();
    expect(screen.getByText('2 of 5 clips rendered')).toBeInTheDocument();
    // No fabricated AI sub-stages ("OCR Detection" etc.) ever appear.
    expect(screen.queryByText(/OCR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Face Detection/)).not.toBeInTheDocument();
  });

  it('renders a real progress bar for the active stage from real progressPercent', async () => {
    mockGetThreadDetail.mockResolvedValue(threadDetail());

    renderPanel('thread-1');

    await waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument());
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  });

  it('shows failure history even when the thread later completed successfully', async () => {
    mockGetThreadDetail.mockResolvedValue(
      threadDetail({
        thread: { ...threadDetail().thread, status: 'COMPLETED' },
        timeline: {
          ...threadDetail().timeline,
          overallStatus: 'completed',
          failureHistory: [
            {
              stage: 'TRANSCRIBING',
              reason: 'Whisper API timed out',
              occurredAt: '2026-07-27T00:02:00.000Z',
            },
          ],
        },
      }),
    );

    renderPanel('thread-1');

    await waitFor(() => expect(screen.getByText(/Riwayat kegagalan/)).toBeInTheDocument());
    expect(screen.getByText(/Whisper API timed out/)).toBeInTheDocument();
  });

  it('shows a Retry button only when the thread has actually failed', async () => {
    mockGetThreadDetail.mockResolvedValue(
      threadDetail({ thread: { ...threadDetail().thread, status: 'FAILED' } }),
    );

    renderPanel('thread-1');

    await waitFor(() => expect(screen.getByText('Coba Lagi')).toBeInTheDocument());
  });

  it('does not show a Retry button for an in-progress or completed thread', async () => {
    mockGetThreadDetail.mockResolvedValue(threadDetail());

    renderPanel('thread-1');

    await waitFor(() => expect(screen.getByText('Rendering')).toBeInTheDocument());
    expect(screen.queryByText('Coba Lagi')).not.toBeInTheDocument();
  });

  it('calls retryVideo with the thread video id and refreshes after retry', async () => {
    mockGetThreadDetail.mockResolvedValue(
      threadDetail({ thread: { ...threadDetail().thread, status: 'FAILED' } }),
    );
    const { onAfterAction } = renderPanel('thread-1');

    await waitFor(() => expect(screen.getByText('Coba Lagi')).toBeInTheDocument());
    screen.getByText('Coba Lagi').click();

    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith('video-1'));
    await waitFor(() => expect(onAfterAction).toHaveBeenCalled());
  });
});
