/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { GrowthSummary as GrowthSummaryDto } from '@speedora/shared';
import { GrowthSummary } from './GrowthSummary';

function makeSummary(overrides: Partial<GrowthSummaryDto> = {}): GrowthSummaryDto {
  return {
    views: { current: 150, previous: 100, growthPct: 50 },
    engagementScore: { current: 0.5, previous: 0.4, growthPct: 25 },
    videos: { current: 5, previous: 3, growthPct: 66.7 },
    clips: { current: 12, previous: 10, growthPct: 20 },
    ...overrides,
  };
}

describe('GrowthSummary', () => {
  it('renders all 4 metric tiles with their current value and a positive growth indicator', () => {
    render(<GrowthSummary growthSummary={makeSummary()} />);

    expect(screen.getByText('Total Views')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('+50%')).toBeInTheDocument();
    expect(screen.getByText('Rata-rata Engagement')).toBeInTheDocument();
    expect(screen.getByText('Total Video')).toBeInTheDocument();
    expect(screen.getByText('Total Klip')).toBeInTheDocument();
  });

  it('renders a negative growthPct without a fabricated sign', () => {
    render(
      <GrowthSummary
        growthSummary={makeSummary({ views: { current: 50, previous: 100, growthPct: -50 } })}
      />,
    );

    expect(screen.getByText('-50%')).toBeInTheDocument();
  });

  it('renders "Tidak ada data" for a null growthPct, not a fabricated 0%', () => {
    render(
      <GrowthSummary
        growthSummary={makeSummary({ videos: { current: 5, previous: 0, growthPct: null } })}
      />,
    );

    expect(screen.getByText('Tidak ada data')).toBeInTheDocument();
  });

  it('renders "—" for a null current value (engagementScore with no scored records)', () => {
    render(
      <GrowthSummary
        growthSummary={makeSummary({
          engagementScore: { current: null, previous: null, growthPct: null },
        })}
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
