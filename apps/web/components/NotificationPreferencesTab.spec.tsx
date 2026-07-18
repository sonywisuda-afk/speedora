/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { NotificationChannel, NotificationType } from '@speedora/shared';
import {
  deleteNotificationWebhook,
  getNotificationPreferences,
  getNotificationWebhooks,
  updateNotificationPreference,
  upsertNotificationWebhook,
  upsertTelegramWebhook,
} from '@/lib/api';
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
  getNotificationWebhooks: jest.fn(),
  upsertNotificationWebhook: jest.fn(),
  deleteNotificationWebhook: jest.fn(),
  upsertTelegramWebhook: jest.fn(),
}));

const mockGetNotificationPreferences = getNotificationPreferences as jest.Mock;
const mockUpdateNotificationPreference = updateNotificationPreference as jest.Mock;
const mockGetNotificationWebhooks = getNotificationWebhooks as jest.Mock;
const mockUpsertNotificationWebhook = upsertNotificationWebhook as jest.Mock;
const mockDeleteNotificationWebhook = deleteNotificationWebhook as jest.Mock;
const mockUpsertTelegramWebhook = upsertTelegramWebhook as jest.Mock;

describe('NotificationPreferencesTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetNotificationPreferences.mockResolvedValue({ preferences: [] });
    mockUpdateNotificationPreference.mockResolvedValue({
      type: NotificationType.RENDER_FAILED,
      enabled: true,
      toast: true,
    });
    mockGetNotificationWebhooks.mockResolvedValue({
      webhooks: [
        { channel: NotificationChannel.SLACK, configured: false },
        { channel: NotificationChannel.DISCORD, configured: false },
        { channel: NotificationChannel.WEBHOOK, configured: false },
        { channel: NotificationChannel.TELEGRAM, configured: false, pending: false },
      ],
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

  describe('outbound destinations (Milestone 04d)', () => {
    it('renders all 4 destination rows as "Belum diatur" by default', async () => {
      renderTab();

      expect(await screen.findByText('Slack')).toBeInTheDocument();
      expect(screen.getByText('Discord')).toBeInTheDocument();
      expect(screen.getByText('Webhook Generik')).toBeInTheDocument();
      expect(screen.getByText('Telegram')).toBeInTheDocument();
      expect(screen.getAllByText('Belum diatur')).toHaveLength(4);
    });

    it('saves a webhook url and refreshes to show it as configured', async () => {
      mockUpsertNotificationWebhook.mockResolvedValue({
        channel: NotificationChannel.SLACK,
        configured: true,
      });
      renderTab();
      await screen.findByText('Slack');

      const input = screen.getAllByPlaceholderText('https://...')[0];
      fireEvent.change(input, { target: { value: 'https://hooks.slack.com/services/x' } });

      mockGetNotificationWebhooks.mockResolvedValue({
        webhooks: [
          { channel: NotificationChannel.SLACK, configured: true },
          { channel: NotificationChannel.DISCORD, configured: false },
          { channel: NotificationChannel.WEBHOOK, configured: false },
        ],
      });
      fireEvent.click(screen.getAllByRole('button', { name: 'Simpan' })[0]);

      await waitFor(() =>
        expect(mockUpsertNotificationWebhook).toHaveBeenCalledWith(
          NotificationChannel.SLACK,
          'https://hooks.slack.com/services/x',
        ),
      );
      expect(await screen.findByText('Terhubung')).toBeInTheDocument();
    });

    it('removes a configured destination', async () => {
      mockGetNotificationWebhooks.mockResolvedValue({
        webhooks: [
          { channel: NotificationChannel.SLACK, configured: true },
          { channel: NotificationChannel.DISCORD, configured: false },
          { channel: NotificationChannel.WEBHOOK, configured: false },
        ],
      });
      renderTab();
      await screen.findByText('Terhubung');

      fireEvent.click(screen.getByRole('button', { name: 'Hapus' }));

      await waitFor(() =>
        expect(mockDeleteNotificationWebhook).toHaveBeenCalledWith(NotificationChannel.SLACK),
      );
    });

    it('shows a per-channel toggle column only for configured channels', async () => {
      mockGetNotificationWebhooks.mockResolvedValue({
        webhooks: [
          { channel: NotificationChannel.SLACK, configured: true },
          { channel: NotificationChannel.DISCORD, configured: false },
          { channel: NotificationChannel.WEBHOOK, configured: false },
        ],
      });
      mockGetNotificationPreferences.mockImplementation((channel?: NotificationChannel) =>
        Promise.resolve({
          preferences:
            channel === NotificationChannel.SLACK
              ? [{ type: NotificationType.RENDER_FAILED, enabled: true, toast: true }]
              : [],
        }),
      );

      renderTab();

      expect(
        await screen.findByRole('switch', { name: 'Kirim Proses gagal ke Slack' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('switch', { name: 'Kirim Proses gagal ke Discord' }),
      ).not.toBeInTheDocument();
    });

    it('toggling a channel column calls updateNotificationPreference with { enabled, channel }', async () => {
      mockGetNotificationWebhooks.mockResolvedValue({
        webhooks: [
          { channel: NotificationChannel.SLACK, configured: true },
          { channel: NotificationChannel.DISCORD, configured: false },
          { channel: NotificationChannel.WEBHOOK, configured: false },
        ],
      });
      mockGetNotificationPreferences.mockImplementation((channel?: NotificationChannel) =>
        Promise.resolve({
          preferences:
            channel === NotificationChannel.SLACK
              ? [{ type: NotificationType.RENDER_FAILED, enabled: true, toast: true }]
              : [],
        }),
      );
      mockUpdateNotificationPreference.mockResolvedValue({
        type: NotificationType.RENDER_FAILED,
        enabled: false,
        toast: true,
      });

      renderTab();
      const slackSwitch = await screen.findByRole('switch', {
        name: 'Kirim Proses gagal ke Slack',
      });
      fireEvent.click(slackSwitch);

      await waitFor(() =>
        expect(mockUpdateNotificationPreference).toHaveBeenCalledWith(
          NotificationType.RENDER_FAILED,
          { enabled: false, channel: NotificationChannel.SLACK },
        ),
      );
    });
  });

  describe('Telegram destination (Milestone 04e)', () => {
    it('saves a bot token via upsertTelegramWebhook', async () => {
      mockUpsertTelegramWebhook.mockResolvedValue({
        channel: NotificationChannel.TELEGRAM,
        configured: false,
        pending: true,
        telegramBotUsername: 'my_speedora_bot',
      });
      renderTab();
      await screen.findByText('Telegram');

      const input = screen.getByPlaceholderText('Token bot dari @BotFather...');
      fireEvent.change(input, { target: { value: '123:abcdefghij' } });
      // Telegram's row is rendered last among the 4 destination rows -
      // every "not configured" row shows its own "Simpan" button.
      const saveButtons = screen.getAllByRole('button', { name: 'Simpan' });
      fireEvent.click(saveButtons[saveButtons.length - 1]);

      await waitFor(() =>
        expect(mockUpsertTelegramWebhook).toHaveBeenCalledWith('123:abcdefghij'),
      );
    });

    it('renders a t.me deep link and "Menunggu konfirmasi..." status while pending', async () => {
      mockGetNotificationWebhooks.mockResolvedValue({
        webhooks: [
          { channel: NotificationChannel.SLACK, configured: false },
          { channel: NotificationChannel.DISCORD, configured: false },
          { channel: NotificationChannel.WEBHOOK, configured: false },
          {
            channel: NotificationChannel.TELEGRAM,
            configured: false,
            pending: true,
            telegramBotUsername: 'my_speedora_bot',
          },
        ],
      });

      renderTab();

      expect(await screen.findByText('Menunggu konfirmasi...')).toBeInTheDocument();
      const link = screen.getByRole('link', { name: /t\.me\/my_speedora_bot/ });
      expect(link).toHaveAttribute('href', 'https://t.me/my_speedora_bot');
    });

    it('shows "Terhubung" once chatId has been discovered (configured: true)', async () => {
      mockGetNotificationWebhooks.mockResolvedValue({
        webhooks: [
          { channel: NotificationChannel.SLACK, configured: false },
          { channel: NotificationChannel.DISCORD, configured: false },
          { channel: NotificationChannel.WEBHOOK, configured: false },
          {
            channel: NotificationChannel.TELEGRAM,
            configured: true,
            pending: false,
            telegramBotUsername: 'my_speedora_bot',
          },
        ],
      });

      renderTab();

      expect(await screen.findByText('Terhubung')).toBeInTheDocument();
      expect(screen.queryByText('Menunggu konfirmasi...')).not.toBeInTheDocument();
    });

    it('removes a connected Telegram destination', async () => {
      mockGetNotificationWebhooks.mockResolvedValue({
        webhooks: [
          { channel: NotificationChannel.SLACK, configured: false },
          { channel: NotificationChannel.DISCORD, configured: false },
          { channel: NotificationChannel.WEBHOOK, configured: false },
          {
            channel: NotificationChannel.TELEGRAM,
            configured: true,
            pending: false,
            telegramBotUsername: 'my_speedora_bot',
          },
        ],
      });
      renderTab();
      await screen.findByText('Terhubung');

      fireEvent.click(screen.getByRole('button', { name: 'Hapus' }));

      await waitFor(() =>
        expect(mockDeleteNotificationWebhook).toHaveBeenCalledWith(NotificationChannel.TELEGRAM),
      );
    });
  });
});
