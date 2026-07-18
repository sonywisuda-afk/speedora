/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { ExportJobStatus, ExportType, type ExportJobDto } from '@speedora/shared';
import { createExportJob, getExportJob, listExportJobs } from '@/lib/api';
import { AnalyticsReportExport } from './AnalyticsReportExport';

jest.mock('@/lib/api', () => ({
  createExportJob: jest.fn(),
  getExportJob: jest.fn(),
  listExportJobs: jest.fn(),
  exportJobDownloadUrl: (id: string) => `/api/export/${id}/download`,
}));

const mockCreateExportJob = createExportJob as jest.Mock;
const mockGetExportJob = getExportJob as jest.Mock;
const mockListExportJobs = listExportJobs as jest.Mock;

function job(overrides: Partial<ExportJobDto>): ExportJobDto {
  return {
    id: 'job-1',
    videoId: null,
    type: ExportType.ANALYTICS_REPORT,
    status: ExportJobStatus.READY,
    resultUrl: null,
    failReason: null,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

// Same static-SWR-key cache-leak concern as NotificationBell.spec.tsx - a
// fresh cache provider per render.
function renderComponent() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <AnalyticsReportExport />
    </SWRConfig>,
  );
}

describe('AnalyticsReportExport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListExportJobs.mockResolvedValue({ jobs: [] });
  });

  it('shows the Export button when no prior job exists', async () => {
    renderComponent();

    expect(await screen.findByText('Analytics Report')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('seeds from the most recent ANALYTICS_REPORT job on mount (Recent Exports)', async () => {
    mockListExportJobs.mockResolvedValue({ jobs: [job({ id: 'job-prev', status: ExportJobStatus.READY })] });
    mockGetExportJob.mockResolvedValue(job({ id: 'job-prev', status: ExportJobStatus.READY }));

    renderComponent();

    expect(await screen.findByText('Unduh')).toBeInTheDocument();
    expect(mockListExportJobs).toHaveBeenCalledWith({ type: ExportType.ANALYTICS_REPORT });
  });

  it('creates a job with no videoId and polls until READY', async () => {
    mockCreateExportJob.mockResolvedValue(job({ status: ExportJobStatus.PROCESSING }));
    mockGetExportJob.mockResolvedValue(job({ status: ExportJobStatus.READY }));

    renderComponent();
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }));

    await waitFor(() => expect(mockCreateExportJob).toHaveBeenCalledWith(undefined, ExportType.ANALYTICS_REPORT));
    expect(await screen.findByText('Unduh')).toBeInTheDocument();
  });

  it('shows a download link pointing at the job download endpoint once READY', async () => {
    mockListExportJobs.mockResolvedValue({ jobs: [job({ id: 'job-ready' })] });
    mockGetExportJob.mockResolvedValue(job({ id: 'job-ready', status: ExportJobStatus.READY }));

    renderComponent();

    const link = (await screen.findByText('Unduh')).closest('a');
    expect(link).toHaveAttribute('href', '/api/export/job-ready/download');
  });

  it('shows an error message and offers Coba Lagi when generation fails', async () => {
    mockListExportJobs.mockResolvedValue({ jobs: [job({ id: 'job-failed' })] });
    mockGetExportJob.mockResolvedValue(
      job({ id: 'job-failed', status: ExportJobStatus.FAILED, failReason: 'boom' }),
    );

    renderComponent();

    expect(await screen.findByRole('button', { name: 'Coba Lagi' })).toBeInTheDocument();
  });
});
