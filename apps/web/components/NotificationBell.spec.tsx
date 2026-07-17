/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { NotificationType, type NotificationDto } from '@speedora/shared';
import {
  getNotificationPreferences,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api';
import { toast } from '@/lib/toast-store';
import { NotificationBell } from './NotificationBell';

// NotificationBell's SWR keys are static strings ('notifications-list',
// 'notifications-unread-count'), not per-test-unique like ExportTypeRow's
// jobId-keyed hook - a fresh cache provider per render is needed so one
// test's cached response can't leak into the next.
function renderBell() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <NotificationBell />
    </SWRConfig>,
  );
}

jest.mock('@/lib/api', () => ({
  getNotifications: jest.fn(),
  getUnreadNotificationCount: jest.fn(),
  getNotificationPreferences: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
}));

jest.mock('@/lib/toast-store', () => ({
  toast: jest.fn(),
}));

const mockGetNotifications = getNotifications as jest.Mock;
const mockGetUnreadNotificationCount = getUnreadNotificationCount as jest.Mock;
const mockGetNotificationPreferences = getNotificationPreferences as jest.Mock;
const mockMarkNotificationRead = markNotificationRead as jest.Mock;
const mockMarkAllNotificationsRead = markAllNotificationsRead as jest.Mock;
const mockToast = toast as jest.Mock;

function notification(overrides: Partial<NotificationDto>): NotificationDto {
  return {
    id: 'notif-1',
    type: NotificationType.UPLOAD_COMPLETE,
    title: 'Upload selesai',
    body: 'Video "My Video" berhasil diunggah dan sedang diproses.',
    videoId: 'video-1',
    clipId: null,
    metadata: null,
    readAt: null,
    createdAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('NotificationBell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUnreadNotificationCount.mockResolvedValue({ count: 0 });
    mockGetNotifications.mockResolvedValue({ notifications: [] });
    mockGetNotificationPreferences.mockResolvedValue({ preferences: [] });
    mockMarkNotificationRead.mockResolvedValue(undefined);
    mockMarkAllNotificationsRead.mockResolvedValue({ count: 0 });
  });

  it('renders the unread count badge', async () => {
    mockGetUnreadNotificationCount.mockResolvedValue({ count: 3 });

    renderBell();

    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('renders no badge when there are no unread notifications', async () => {
    renderBell();

    await waitFor(() => expect(mockGetUnreadNotificationCount).toHaveBeenCalled());
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows an empty state when the dialog is opened with no notifications', async () => {
    renderBell();

    fireEvent.click(screen.getByRole('button', { name: 'Notifikasi' }));

    expect(await screen.findByText('Belum ada notifikasi.')).toBeInTheDocument();
  });

  it('renders the notification list with title/body once fetched', async () => {
    mockGetNotifications.mockResolvedValue({
      notifications: [notification({ id: 'notif-1', title: 'Upload selesai' })],
    });

    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'Notifikasi' }));

    expect(await screen.findByText('Upload selesai')).toBeInTheDocument();
    expect(
      screen.getByText('Video "My Video" berhasil diunggah dan sedang diproses.'),
    ).toBeInTheDocument();
  });

  it('clicking an unread notification marks it read', async () => {
    mockGetNotifications.mockResolvedValue({
      notifications: [notification({ id: 'notif-1', title: 'Upload selesai', readAt: null })],
    });

    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'Notifikasi' }));
    fireEvent.click(await screen.findByText('Upload selesai'));

    await waitFor(() => expect(mockMarkNotificationRead).toHaveBeenCalledWith('notif-1'));
  });

  it('"Tandai semua dibaca" calls the bulk mark-read endpoint', async () => {
    mockGetNotifications.mockResolvedValue({
      notifications: [notification({ id: 'notif-1', readAt: null })],
    });

    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'Notifikasi' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tandai semua dibaca' }));

    await waitFor(() => expect(mockMarkAllNotificationsRead).toHaveBeenCalled());
  });

  it('does not toast a newly-arrived notification when its type has toast disabled (still updates the list)', async () => {
    jest.useFakeTimers();
    mockGetNotificationPreferences.mockResolvedValue({
      preferences: [{ type: NotificationType.RENDER_FAILED, enabled: true, toast: false }],
    });
    const older = notification({
      id: 'notif-1',
      type: NotificationType.UPLOAD_COMPLETE,
      createdAt: '2026-07-18T00:00:00.000Z',
    });
    const newer = notification({
      id: 'notif-2',
      type: NotificationType.RENDER_FAILED,
      title: 'Proses gagal',
      createdAt: '2026-07-18T00:01:00.000Z',
    });
    mockGetNotifications
      .mockResolvedValueOnce({ notifications: [older] })
      .mockResolvedValueOnce({ notifications: [newer, older] });
    mockGetUnreadNotificationCount.mockResolvedValue({ count: 2 });

    const { unmount } = renderBell();
    await waitFor(() => expect(mockGetNotifications).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    await waitFor(() => expect(mockGetNotifications).toHaveBeenCalledTimes(2));

    expect(mockToast).not.toHaveBeenCalled();

    // Unmount while still on fake timers so SWR's pending refreshInterval
    // timer is cleared before switching back to real timers - otherwise a
    // dangling fake-timer-scheduled callback keeps the Jest worker alive.
    unmount();
    jest.useRealTimers();
  });
});
