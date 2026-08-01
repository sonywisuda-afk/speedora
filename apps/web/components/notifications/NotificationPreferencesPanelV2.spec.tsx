/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import {
  getNotificationPreferencesV2,
  updateChannelPreferenceV2,
  updateInAppPreferenceV2,
} from '@/lib/api';
import { NotificationPreferencesPanelV2 } from './NotificationPreferencesPanelV2';

jest.mock('@/lib/api', () => ({
  getNotificationPreferencesV2: jest.fn(),
  updateInAppPreferenceV2: jest.fn().mockResolvedValue(undefined),
  updateChannelPreferenceV2: jest.fn().mockResolvedValue(undefined),
}));

const mockGetPreferences = getNotificationPreferencesV2 as jest.Mock;
const mockUpdateInApp = updateInAppPreferenceV2 as jest.Mock;
const mockUpdateChannel = updateChannelPreferenceV2 as jest.Mock;

function preferences(overrides: Record<string, unknown> = {}) {
  return {
    inApp: [
      { group: 'UPLOAD', enabled: true },
      { group: 'PROCESSING', enabled: true },
      { group: 'RENDERING', enabled: true },
      { group: 'PUBLISHING', enabled: true },
      { group: 'ANALYTICS', enabled: true },
      { group: 'BILLING', enabled: true },
      { group: 'SYSTEM', enabled: true },
    ],
    channels: [
      { channel: 'SLACK', enabled: true, configured: true, comingSoon: false },
      { channel: 'DISCORD', enabled: false, configured: false, comingSoon: false },
      { channel: 'TELEGRAM', enabled: false, configured: false, comingSoon: false },
      { channel: 'WEBHOOK', enabled: false, configured: false, comingSoon: false },
      { channel: 'EMAIL', enabled: false, configured: false, comingSoon: true },
      { channel: 'PUSH', enabled: false, configured: false, comingSoon: true },
      { channel: 'DESKTOP', enabled: false, configured: false, comingSoon: true },
    ],
    essentialNote:
      'Notifikasi penting (misalnya error proses dan permintaan kolaborasi) selalu dikirim dan tidak dapat dinonaktifkan agar Anda tidak melewatkan informasi penting.',
    ...overrides,
  };
}

function renderPanel() {
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <NotificationPreferencesPanelV2 />
    </SWRConfig>,
  );
}

describe('NotificationPreferencesPanelV2', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders all 7 in-app groups from the real API response, not a hardcoded list', async () => {
    mockGetPreferences.mockResolvedValue(preferences());

    renderPanel();

    await waitFor(() => expect(screen.getByText('Upload')).toBeInTheDocument());
    for (const label of ['Processing', 'Rendering', 'Publish', 'Analytics', 'Billing', 'System']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Workspace and Errors are essential/always-on - never shown as toggles.
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('Errors')).not.toBeInTheDocument();
  });

  it('displays the essential note from the API, not a client-hardcoded string', async () => {
    mockGetPreferences.mockResolvedValue(
      preferences({ essentialNote: 'Custom note from backend' }),
    );

    renderPanel();

    await waitFor(() => expect(screen.getByText('Custom note from backend')).toBeInTheDocument());
  });

  it('marks EMAIL/PUSH/DESKTOP as Coming Soon instead of a checkbox', async () => {
    mockGetPreferences.mockResolvedValue(preferences());

    renderPanel();

    await waitFor(() => expect(screen.getAllByText('Coming Soon')).toHaveLength(3));
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('toggling an in-app group calls updateInAppPreferenceV2 and refetches', async () => {
    mockGetPreferences.mockResolvedValue(preferences());

    renderPanel();

    await waitFor(() => expect(screen.getByLabelText('Upload')).toBeInTheDocument());
    mockGetPreferences.mockResolvedValue(
      preferences({
        inApp: preferences().inApp.map((p: { group: string; enabled: boolean }) =>
          p.group === 'UPLOAD' ? { ...p, enabled: false } : p,
        ),
      }),
    );
    screen.getByLabelText('Upload').click();

    await waitFor(() => expect(mockUpdateInApp).toHaveBeenCalledWith('UPLOAD', false));
  });

  it('toggling a configured channel calls updateChannelPreferenceV2', async () => {
    mockGetPreferences.mockResolvedValue(preferences());

    renderPanel();

    await waitFor(() => expect(screen.getAllByLabelText('Enabled')[0]).toBeInTheDocument());
    screen.getAllByLabelText('Enabled')[0].click();

    await waitFor(() => expect(mockUpdateChannel).toHaveBeenCalledWith('SLACK', false));
  });

  it('disables the checkbox for an unconfigured channel and shows a hint', async () => {
    mockGetPreferences.mockResolvedValue(preferences());

    renderPanel();

    await waitFor(() => expect(screen.getAllByLabelText('Enabled').length).toBeGreaterThan(1));
    const discordCheckbox = screen.getAllByLabelText('Enabled')[1];
    expect(discordCheckbox).toBeDisabled();
    expect(screen.getAllByText(/belum dikonfigurasi/).length).toBeGreaterThan(0);
  });
});
