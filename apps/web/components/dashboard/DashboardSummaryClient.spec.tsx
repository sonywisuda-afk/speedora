/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import type {
  DashboardActivityDto,
  DashboardExportsDto,
  DashboardStatsDto,
} from '@speedora/shared';
import { getDashboardActivity, getDashboardExports, getDashboardStats } from '@/lib/api';
import { DashboardSummaryClient } from './DashboardSummaryClient';

jest.mock('@/lib/api', () => ({
  getDashboardStats: jest.fn(),
  getDashboardActivity: jest.fn(),
  getDashboardExports: jest.fn(),
}));

const mockGetDashboardStats = getDashboardStats as jest.Mock;
const mockGetDashboardActivity = getDashboardActivity as jest.Mock;
const mockGetDashboardExports = getDashboardExports as jest.Mock;

const stats: DashboardStatsDto = {
  totalVideos: 1,
  totalClips: 2,
  avgProcessingTimeSeconds: null,
  storageUsedBytes: 0,
  monthlyVideos: 0,
  monthlyClips: 0,
  premiumCreditsThisMonth: 0,
};

const activity: DashboardActivityDto = { events: [], nextCursor: null };

const exportsData: DashboardExportsDto = {
  recentExports: [],
  totalExports: 0,
  pendingCount: 0,
  processingCount: 0,
  failedCount: 0,
  readyCount: 0,
  successRate: null,
  lastReadyAt: null,
  exportsByType: {
    PDF: 0,
    EXCEL: 0,
    HIGHLIGHT_REPORT: 0,
    BRAND_REPORT: 0,
    ANALYTICS_REPORT: 0,
    PPTX: 0,
  } as DashboardExportsDto['exportsByType'],
};

// Fresh SWR cache per render (Activity Timeline v2) - ActivityTimeline is
// now hook-driven (useActivityTimeline -> useSWRInfinite/useSWR under
// module-level keys like 'dashboard-activity-peek'), so without this, one
// test's resolved cache would leak into the next render in the same file -
// same isolation convention lib/useNotificationCenter.spec.ts already uses.
function renderSummary(props: {
  initialStats: DashboardStatsDto;
  initialActivity: DashboardActivityDto;
  initialExports: DashboardExportsDto;
}) {
  return render(
    createElement(
      SWRConfig,
      { value: { provider: () => new Map() } },
      createElement(DashboardSummaryClient, props),
    ),
  );
}

// Phase F (performance hardening) - previously a fetch failure for any of
// the 3 sections silently rendered nothing (only `data` was destructured
// from useSWR, `error` was ignored). These prove the fallback error+retry
// UI actually appears, and that only the failing section is affected - not
// the whole summary.
describe('DashboardSummaryClient - error states', () => {
  beforeEach(() => {
    mockGetDashboardStats.mockResolvedValue(stats);
    mockGetDashboardActivity.mockResolvedValue(activity);
    mockGetDashboardExports.mockResolvedValue(exportsData);
  });

  it('renders every section normally when every fetch succeeds', async () => {
    renderSummary({ initialStats: stats, initialActivity: activity, initialExports: exportsData });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await screen.findByText('Belum ada aktivitas.')).toBeInTheDocument();
    expect(screen.getByText('Belum ada export.')).toBeInTheDocument();
  });

  it('shows a retryable error just for stats when only that fetch fails, other sections unaffected', async () => {
    mockGetDashboardStats.mockRejectedValue(new Error('network down'));

    renderSummary({ initialStats: stats, initialActivity: activity, initialExports: exportsData });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Gagal memuat statistik.');
    // Activity/Exports still render normally - the failure is isolated.
    expect(await screen.findByText('Belum ada aktivitas.')).toBeInTheDocument();
    expect(screen.getByText('Belum ada export.')).toBeInTheDocument();

    mockGetDashboardStats.mockResolvedValue(stats);
    fireEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }));

    await screen.findByText('Belum ada aktivitas.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
