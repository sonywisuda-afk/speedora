/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { ShareRole } from '@speedora/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { createShareLink, listShareLinks, revokeShareLink } from '@/lib/api';
import { ShareDialog } from './ShareDialog';

jest.mock('@/lib/api', () => ({
  createShareLink: jest.fn(),
  listShareLinks: jest.fn(),
  revokeShareLink: jest.fn(),
}));

const mockCreateShareLink = createShareLink as jest.Mock;
const mockListShareLinks = listShareLinks as jest.Mock;
const mockRevokeShareLink = revokeShareLink as jest.Mock;

function shareLink(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'link-1',
    videoId: 'video-1',
    clipId: null,
    role: ShareRole.VIEWER,
    expiresAt: null,
    revoked: false,
    createdAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

function clip(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'clip-1', hookText: 'A great hook', startTime: 0, endTime: 15, ...overrides };
}

function renderDialog(clips: ReturnType<typeof clip>[] = []) {
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ShareDialog videoId="video-1" clips={clips} />
    </SWRConfig>,
  );
  fireEvent.click(screen.getByText('Share'));
}

// Collaboration roadmap follow-up (clip-level Share scoping, 2026-08-10) - Sprint 5B's original
// video-only Share flow, now with an optional clip picker.
describe('ShareDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListShareLinks.mockResolvedValue({ links: [] });
  });

  it('does not show a scope picker when no clips are given (existing video-only behavior)', async () => {
    renderDialog();

    await screen.findByText('Buat Link');
    expect(screen.queryByLabelText('Cakupan link')).not.toBeInTheDocument();
  });

  it('creates a video-level link (clipId undefined) when no clip is selected', async () => {
    mockCreateShareLink.mockResolvedValue({ ...shareLink(), url: 'https://app.test/share/abc' });
    renderDialog([clip()]);

    fireEvent.click(await screen.findByText('Buat Link'));

    await waitFor(() =>
      expect(mockCreateShareLink).toHaveBeenCalledWith('video-1', {
        role: ShareRole.VIEWER,
        expiresInDays: undefined,
        clipId: undefined,
      }),
    );
  });

  it('creates a clip-scoped link when a clip is selected from the scope picker', async () => {
    mockCreateShareLink.mockResolvedValue({
      ...shareLink({ clipId: 'clip-1' }),
      url: 'https://app.test/share/abc',
    });
    renderDialog([clip({ id: 'clip-1', hookText: 'A great hook' })]);

    const select = await screen.findByLabelText('Cakupan link');
    fireEvent.change(select, { target: { value: 'clip-1' } });
    fireEvent.click(screen.getByText('Buat Link'));

    await waitFor(() =>
      expect(mockCreateShareLink).toHaveBeenCalledWith('video-1', {
        role: ShareRole.VIEWER,
        expiresInDays: undefined,
        clipId: 'clip-1',
      }),
    );
  });

  it('shows the just-created URL once, for copying', async () => {
    mockCreateShareLink.mockResolvedValue({
      ...shareLink(),
      url: 'https://app.test/share/raw-token',
    });
    renderDialog();

    fireEvent.click(await screen.findByText('Buat Link'));

    expect(await screen.findByDisplayValue('https://app.test/share/raw-token')).toBeInTheDocument();
  });

  it('marks a clip-scoped active link with a "1 klip" badge', async () => {
    mockListShareLinks.mockResolvedValue({ links: [shareLink({ clipId: 'clip-1' })] });
    renderDialog();

    expect(await screen.findByText('1 klip')).toBeInTheDocument();
  });

  it('does not badge a video-level active link', async () => {
    mockListShareLinks.mockResolvedValue({ links: [shareLink({ clipId: null })] });
    renderDialog();

    await screen.findByText('Viewer');
    expect(screen.queryByText('1 klip')).not.toBeInTheDocument();
  });

  it('revoking an active link calls revokeShareLink and refetches', async () => {
    mockListShareLinks.mockResolvedValue({ links: [shareLink({ id: 'link-1' })] });
    mockRevokeShareLink.mockResolvedValue(undefined);
    renderDialog();

    fireEvent.click(await screen.findByText('Revoke'));

    await waitFor(() => expect(mockRevokeShareLink).toHaveBeenCalledWith('link-1'));
  });
});
