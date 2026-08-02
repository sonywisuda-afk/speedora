/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { QueueName, type WorkerHealthEntry } from '@speedora/shared';
import { WorkerHeartbeatTable } from './WorkerHeartbeatTable';

describe('WorkerHeartbeatTable', () => {
  it('shows a placeholder when no worker has an active heartbeat', () => {
    render(<WorkerHeartbeatTable workers={[]} />);
    expect(
      screen.getByText('Tidak ada worker dengan heartbeat aktif saat ini.'),
    ).toBeInTheDocument();
  });

  it('renders a worker running every queue (unset WORKER_QUEUES) - shape observed against a live dev worker', () => {
    const worker: WorkerHealthEntry = {
      worker: 'DESKTOP-F59O79S-37980',
      queues: Object.values(QueueName),
      jobsActive: 0,
      jobsWaiting: 0,
      startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      heartbeatTtlSeconds: 39,
    };
    render(<WorkerHeartbeatTable workers={[worker]} />);

    expect(screen.getByText('DESKTOP-F59O79S-37980')).toBeInTheDocument();
    // 16 queues, truncated to 4 visible + an overflow badge.
    expect(screen.getByText('import-youtube')).toBeInTheDocument();
    expect(screen.getByText(`+${Object.values(QueueName).length - 4}`)).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('shows a distinct entry per worker, e.g. a specialized render-only worker', () => {
    const workers: WorkerHealthEntry[] = [
      {
        worker: 'worker-render',
        queues: [QueueName.RENDER_CLIP],
        jobsActive: 2,
        jobsWaiting: 5,
        startedAt: new Date().toISOString(),
        heartbeatTtlSeconds: 44,
      },
      {
        worker: 'worker-light',
        queues: [QueueName.PROBE_VIDEO, QueueName.TRANSCRIBE],
        jobsActive: 0,
        jobsWaiting: 0,
        startedAt: new Date().toISOString(),
        heartbeatTtlSeconds: 8,
      },
    ];
    render(<WorkerHeartbeatTable workers={workers} />);

    expect(screen.getByText('worker-render')).toBeInTheDocument();
    expect(screen.getByText('worker-light')).toBeInTheDocument();
    expect(screen.getByText('render-clip')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    // worker-light's ttlSeconds=8 crosses the "Stale" threshold.
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('does not truncate a worker with 4 or fewer queues (no overflow badge)', () => {
    const worker: WorkerHealthEntry = {
      worker: 'worker-ai',
      queues: [QueueName.DETECT_CLIPS, QueueName.GENERATE_MORE_CLIPS],
      jobsActive: 1,
      jobsWaiting: 0,
      startedAt: new Date().toISOString(),
      heartbeatTtlSeconds: 30,
    };
    render(<WorkerHeartbeatTable workers={[worker]} />);

    expect(screen.getByText('detect-clips')).toBeInTheDocument();
    expect(screen.getByText('generate-more-clips')).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });
});
