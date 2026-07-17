/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { NotificationType } from '@speedora/shared';
import { getNotificationPreferences, updateNotificationPreference } from '@/lib/api';
import { NotificationPreferencesTab } from './NotificationPreferencesTab';

function renderTab() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <NotificationPreferencesTab />
    </SWRConfig>,
  );
}

jest.mock('@/lib/api', () => ({
  getNotificationPreferences: jest.fn(),
  updateNotificationPreference: jest.fn(),
}));

const mockGetNotificationPreferences = getNotificationPreferences as jest.Mock;
const mockUpdateNotificationPreference = updateNotificationPreference as jest.Mock;

describe('NotificationPreferencesTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetNotificationPreferences.mockResolvedValue({ preferences: [] });
    mockUpdateNotificationPreference.mockResolvedValue({
      type: NotificationType.RENDER_FAILED,
      enabled: true,
      toast: true,
    });
  });

  it('renders 4 rows, one per notification type', async () => {
    renderTab();

    expect(await screen.findByText('Upload selesai')).toBeInTheDocument();
    expect(screen.getByText('Klip siap')).toBeInTheDocument();
    expect(screen.getByText('Export siap')).toBeInTheDocument();
    expect(screen.getByText('Proses gagal')).toBeInTheDocument();
  });

  it('toggling the Inbox switch calls updateNotificationPreference with { enabled }', async () => {
    renderTab();
    await screen.findByText('Proses gagal');

    const inboxSwitch = screen.getByRole('switch', {
      name: 'Tampilkan Proses gagal di Inbox',
    });
    fireEvent.click(inboxSwitch);

    await waitFor(() =>
      expect(mockUpdateNotificationPreference).toHaveBeenCalledWith(
        NotificationType.RENDER_FAILED,
        { enabled: false },
      ),
    );
  });

  it('toggling the Toast switch calls updateNotificationPreference with { toast }', async () => {
    renderTab();
    await screen.findByText('Proses gagal');

    const toastSwitch = screen.getByRole('switch', {
      name: 'Tampilkan Toast untuk Proses gagal',
    });
    fireEvent.click(toastSwitch);

    await waitFor(() =>
      expect(mockUpdateNotificationPreference).toHaveBeenCalledWith(
        NotificationType.RENDER_FAILED,
        { toast: false },
      ),
    );
  });

  it('disables the Toast switch when Inbox is off (inert - nothing to toast about)', async () => {
    mockGetNotificationPreferences.mockResolvedValue({
      preferences: [{ type: NotificationType.RENDER_FAILED, enabled: false, toast: true }],
    });

    renderTab();
    await screen.findByText('Proses gagal');

    const toastSwitch = screen.getByRole('switch', {
      name: 'Tampilkan Toast untuk Proses gagal',
    });
    expect(toastSwitch).toBeDisabled();
  });
});
