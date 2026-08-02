/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { QueueName, type QueueCounts } from '@speedora/shared';
import { QueueMetricsTable } from './QueueMetricsTable';

// Fixtures shaped like the real GET /queues response observed against a
// live dev API during PR #42's merge review (not synthetic round numbers) -
// covers a queue with a high failure rate + real retries (publish-clip),
// one with no completed/failed data yet (null failureRate/avgProcessingTimeMs),
// and one with a likelyStalled count.
function counts(overrides: Partial<QueueCounts> = {}): QueueCounts {
  return {
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    paused: 0,
    likelyStalled: 0,
    failureRate: null,
    avgProcessingTimeMs: null,
    retriedJobs: 0,
    ...overrides,
  };
}

describe('QueueMetricsTable', () => {
  it('shows a placeholder when there are no queues', () => {
    render(<QueueMetricsTable queues={{}} />);
    expect(screen.getByText('Tidak ada data queue.')).toBeInTheDocument();
  });

  it('renders every queue with its real counts', () => {
    render(
      <QueueMetricsTable
        queues={{
          [QueueName.PUBLISH_CLIP]: counts({
            completed: 4,
            failed: 235,
            failureRate: 0.9832635983263598,
            avgProcessingTimeMs: 165,
            retriedJobs: 50,
          }),
          [QueueName.SYNC_PUBLISH_STATS]: counts({
            completed: 3,
            failed: 0,
            delayed: 1,
            failureRate: 0,
            avgProcessingTimeMs: 2520,
          }),
        }}
      />,
    );

    expect(screen.getByText('publish-clip')).toBeInTheDocument();
    expect(screen.getByText('235')).toBeInTheDocument();
    expect(screen.getByText('98.3%')).toBeInTheDocument();
    expect(screen.getByText('165ms')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();

    expect(screen.getByText('sync-publish-stats')).toBeInTheDocument();
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(screen.getByText('2.5s')).toBeInTheDocument();
  });

  it('shows an em dash for a queue with no completed/failed sample yet, not a fabricated rate', () => {
    render(
      <QueueMetricsTable
        queues={{
          [QueueName.GENERATE_MORE_CLIPS]: counts({ waiting: 2 }),
        }}
      />,
    );
    // Both failureRate and avgProcessingTimeMs are null for this fixture -
    // two separate em dashes, one per column.
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('flags a likely-stalled count instead of showing a plain 0', () => {
    render(
      <QueueMetricsTable
        queues={{
          [QueueName.RENDER_CLIP]: counts({ active: 1, likelyStalled: 2 }),
        }}
      />,
    );
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('sorts the busiest queue (waiting + active) first', () => {
    render(
      <QueueMetricsTable
        queues={{
          [QueueName.TRANSCRIBE]: counts({ waiting: 1 }),
          [QueueName.RENDER_CLIP]: counts({ waiting: 5, active: 3 }),
        }}
      />,
    );

    const rows = screen.getAllByRole('row');
    // rows[0] is the header row.
    expect(rows[1]).toHaveTextContent('render-clip');
    expect(rows[2]).toHaveTextContent('transcribe');
  });
});
