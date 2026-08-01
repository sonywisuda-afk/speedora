/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { ExportJobStatus, ExportType, type DashboardExportsDto, type ExportJobDto } from '@speedora/shared';
import { ExportActivityPanel } from './ExportActivityPanel';

function job(overrides: Partial<ExportJobDto> = {}): ExportJobDto {
  return {
    id: 'job-1',
    videoId: 'video-1',
    type: ExportType.PDF,
    status: ExportJobStatus.READY,
    resultUrl: '/export/job-1/download',
    failReason: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function dashboardExports(overrides: Partial<DashboardExportsDto> = {}): DashboardExportsDto {
  return {
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
    },
    ...overrides,
  } as DashboardExportsDto;
}

describe('ExportActivityPanel', () => {
  it('shows the empty state when the user has never exported anything', () => {
    render(<ExportActivityPanel exports={dashboardExports()} />);
    expect(screen.getByText('Belum ada export.')).toBeInTheDocument();
  });

  it('renders the running/queue/failed/success-rate tiles', () => {
    render(
      <ExportActivityPanel
        exports={dashboardExports({
          totalExports: 8,
          pendingCount: 2,
          processingCount: 1,
          failedCount: 3,
          readyCount: 5,
          successRate: 5 / 8,
        })}
      />,
    );
    expect(screen.getByText('Sedang Diproses')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Antre')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Gagal')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('63%')).toBeInTheDocument();
  });

  it('renders a dash for success rate when no job has ever reached a terminal status', () => {
    render(
      <ExportActivityPanel exports={dashboardExports({ totalExports: 1, pendingCount: 1 })} />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders only the non-zero per-type breakdown entries', () => {
    render(
      <ExportActivityPanel
        exports={dashboardExports({
          totalExports: 6,
          readyCount: 6,
          successRate: 1,
          exportsByType: {
            PDF: 4,
            EXCEL: 0,
            HIGHLIGHT_REPORT: 0,
            BRAND_REPORT: 0,
            ANALYTICS_REPORT: 0,
            PPTX: 2,
          },
        })}
      />,
    );
    expect(screen.getByText(/PDF/)).toBeInTheDocument();
    expect(screen.getByText(/PowerPoint/)).toBeInTheDocument();
    expect(screen.queryByText(/Excel/)).not.toBeInTheDocument();
  });

  it('renders a recent export row with its status badge and a download link when ready', () => {
    render(
      <ExportActivityPanel
        exports={dashboardExports({
          totalExports: 1,
          readyCount: 1,
          successRate: 1,
          recentExports: [
            job({ status: ExportJobStatus.READY, resultUrl: '/export/job-1/download' }),
          ],
        })}
      />,
    );
    expect(screen.getByText('Siap')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Unduh/ })).toBeInTheDocument();
  });

  it('omits the download link for a job that is not ready yet', () => {
    render(
      <ExportActivityPanel
        exports={dashboardExports({
          totalExports: 1,
          pendingCount: 1,
          recentExports: [job({ status: ExportJobStatus.PENDING, resultUrl: null })],
        })}
      />,
    );
    expect(screen.getByText('Menunggu')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Unduh/ })).not.toBeInTheDocument();
  });
});
