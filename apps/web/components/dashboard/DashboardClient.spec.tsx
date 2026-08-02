/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import type { UserDto, VideoWithClipsDto } from '@/lib/api';
import { DashboardClient } from './DashboardClient';

// Phase F (performance hardening) - DashboardClient had no test file at all
// before this pass. This covers only what this pass changed: extracting
// ClipRow/VideoRow into memoized components must (a) render identically to
// the original inline JSX and (b) actually stop typing in one clip's
// schedule input from re-rendering a sibling clip's row - the exact
// complaint the performance survey found. Every child component this file
// pulls in is stubbed to a trivial marker so the test stays focused on
// DashboardClient's own render/memoization behavior, not each child's.

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return {
    ...actual,
    listVideos: jest.fn(),
    listSocialAccounts: jest
      .fn()
      .mockResolvedValue([{ id: 'account-1', platform: 'YOUTUBE', displayName: 'My Channel' }]),
    listCampaigns: jest.fn().mockResolvedValue({ campaigns: [] }),
    listRecurringSchedules: jest.fn().mockResolvedValue({ recurringSchedules: [] }),
    publishClip: jest.fn(),
    cancelScheduledPublish: jest.fn(),
    reschedulePublish: jest.fn(),
    retryVideo: jest.fn(),
    deleteVideo: jest.fn(),
    deleteClip: jest.fn(),
    clipDownloadUrl: (key: string) => `/api/${key}`,
    clipStreamUrl: (id: string) => `/api/clips/${id}/stream`,
  };
});

jest.mock('@/components/ProgressSteps', () => ({
  ProgressSteps: () => <div data-testid="progress-steps" />,
}));
jest.mock('@/components/ScoreGauge', () => ({
  ScoreGauge: () => <div data-testid="score-gauge" />,
}));
jest.mock('@/components/dashboard/ShareDialog', () => ({
  ShareDialog: () => <div data-testid="share-dialog" />,
}));
jest.mock('@/components/seo/PlatformFitHint', () => ({
  PlatformFitHint: () => <div data-testid="platform-fit-hint" />,
}));
// The one child mocked as a jest.fn() rather than a plain stub - its call
// count is the render-count signal these tests assert on, since it's the
// deepest/last thing ClipRow renders in the publish-form branch.
const platformCopyPanelSpy = jest.fn((props: { clipId: string }) => {
  void props;
  return <div data-testid="platform-copy-panel" />;
});
jest.mock('@/components/seo/PlatformCopyPanel', () => ({
  PlatformCopyPanel: (props: { clipId: string }) => platformCopyPanelSpy(props),
}));
jest.mock('../Nav', () => ({ Nav: () => <div data-testid="nav" /> }));
jest.mock('./ProcessingQueue', () => ({ ProcessingQueue: () => <div data-testid="queue" /> }));
jest.mock('./QuickActions', () => ({ QuickActions: () => <div data-testid="quick-actions" /> }));
jest.mock('./RecentProjectsGrid', () => ({ RecentProjectsGrid: () => <div data-testid="grid" /> }));
jest.mock('./SearchBar', () => ({ SearchBar: () => <div data-testid="search-bar" /> }));
jest.mock('./UploadVideoQuickAction', () => ({
  UploadVideoQuickAction: () => <div data-testid="upload-cta" />,
}));

const user: UserDto = {
  id: 'user-1',
  email: 'a@example.com',
  role: 'CREATOR',
  emailVerified: true,
} as UserDto;

function clip(overrides: Partial<VideoWithClipsDto['clips'][number]> = {}) {
  return {
    id: 'clip-1',
    videoId: 'video-1',
    startTime: 0,
    endTime: 10,
    viralityScore: 50,
    highlightScore: null,
    downloadUrl: 'clips/clip-1.mp4',
    hookText: null,
    hashtags: [],
    ocrTracks: [],
    publishRecords: [],
    ...overrides,
  } as unknown as VideoWithClipsDto['clips'][number];
}

function video(overrides: Partial<VideoWithClipsDto> = {}): VideoWithClipsDto {
  return {
    id: 'video-1',
    title: 'My video',
    status: 'RENDERED',
    createdAt: '2026-08-01T00:00:00.000Z',
    clips: [clip({ id: 'clip-1' }), clip({ id: 'clip-2' })],
    ...overrides,
  } as unknown as VideoWithClipsDto;
}

describe('DashboardClient - ClipRow memoization', () => {
  beforeEach(() => {
    platformCopyPanelSpy.mockClear();
    const { listVideos } = jest.requireMock('@/lib/api');
    (listVideos as jest.Mock).mockResolvedValue({ videos: [video()], nextCursor: null });
  });

  it('renders every clip in the video with its own publish panel', async () => {
    render(<DashboardClient user={user} initialVideos={[video()]} initialNextCursor={null} />);

    expect(await screen.findAllByTestId('platform-copy-panel')).toHaveLength(2);
  });

  it('does not re-render a sibling clip when typing in one clip schedule input', async () => {
    render(<DashboardClient user={user} initialVideos={[video()]} initialNextCursor={null} />);
    await screen.findAllByTestId('platform-copy-panel');
    platformCopyPanelSpy.mockClear();

    // clip-1's own <input type="datetime-local"> - the exact interaction
    // the performance survey flagged as re-rendering the whole list. Scoped
    // by clip via the clip-1 ClipRow's own DOM subtree (its "Unduh" link's
    // closest <li>), since both clips render an otherwise-identical form.
    const clip1DownloadLink = screen.getAllByRole('link', { name: 'Unduh' })[0];
    const clip1Row = clip1DownloadLink.closest('li') as HTMLElement;
    const clip1Input = clip1Row.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(clip1Input).toBeTruthy();

    fireEvent.change(clip1Input, { target: { value: '2026-09-01T10:00' } });

    // clip-1's own ClipRow legitimately re-renders (its scheduleValue prop
    // changed) - what matters is that clip-2's PlatformCopyPanel is never
    // called again, proving ClipRow's memo boundary skipped clip-2
    // entirely rather than reconciling the whole list.
    const clip2Calls = platformCopyPanelSpy.mock.calls.filter(
      ([props]) => (props as { clipId: string }).clipId === 'clip-2',
    );
    expect(clip2Calls).toHaveLength(0);
  });
});
