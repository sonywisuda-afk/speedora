/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { DashboardStatsDto } from '@speedora/shared';
import { StatisticsRow } from './StatisticsRow';

// Phase F (performance hardening) - StatisticsRow had zero test coverage
// (the survey's own finding) despite being the actively-used top row of
// the dashboard summary.
function stats(overrides: Partial<DashboardStatsDto> = {}): DashboardStatsDto {
  return {
    totalVideos: 5,
    totalClips: 12,
    avgProcessingTimeSeconds: 125,
    storageUsedBytes: 1_500_000,
    monthlyVideos: 2,
    monthlyClips: 4,
    premiumCreditsThisMonth: 3,
    ...overrides,
  };
}

describe('StatisticsRow', () => {
  it('renders all six tiles with formatted values', () => {
    render(<StatisticsRow stats={stats()} />);

    expect(screen.getByText('Total Video')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Total Klip')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Waktu Proses')).toBeInTheDocument();
    expect(screen.getByText('Storage Terpakai')).toBeInTheDocument();
    expect(screen.getByText('Penggunaan Bulan Ini')).toBeInTheDocument();
    expect(screen.getByText('2 video')).toBeInTheDocument();
    expect(screen.getByText('4 klip')).toBeInTheDocument();
    expect(screen.getByText('Kredit Premium')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows a "no data" placeholder for avgProcessingTimeSeconds when null, not zero seconds', () => {
    render(<StatisticsRow stats={stats({ avgProcessingTimeSeconds: null })} />);

    // formatDuration(null) returns '—' - see lib/dashboard.ts's own "no
    // data, not a fabricated zero" convention, matching
    // DashboardStatsDto.avgProcessingTimeSeconds's own comment.
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
