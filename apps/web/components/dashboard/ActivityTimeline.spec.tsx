/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { ActivityEventDto } from '@speedora/shared';
import { ActivityTimeline } from './ActivityTimeline';

function event(
  overrides: { type: string } & Partial<Omit<ActivityEventDto, 'type'>>,
): ActivityEventDto {
  return {
    id: 'event-1',
    videoId: null,
    clipId: null,
    metadata: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ActivityEventDto;
}

describe('ActivityTimeline', () => {
  it('renders a known event type normally', () => {
    render(
      <ActivityTimeline
        events={[event({ type: 'WORKSPACE_DELETED', metadata: { name: 'Acme' } })]}
      />,
    );
    expect(screen.getByText('Menghapus workspace: Acme')).toBeInTheDocument();
  });

  // Tahap 5 - runtime safety net: an event.type the frontend build doesn't
  // recognize yet (e.g. a live frontend/backend version skew mid-deploy)
  // must degrade to a generic row, never throw "Element type is invalid"
  // the way the original WORKSPACE_DELETED bug did.
  it('falls back to a generic row instead of crashing on an unrecognized event type', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    render(<ActivityTimeline events={[event({ type: 'SOMETHING_NEW_FROM_A_NEWER_BACKEND' })]} />);

    expect(screen.getByText('Unknown activity')).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('SOMETHING_NEW_FROM_A_NEWER_BACKEND'),
      expect.anything(),
    );

    warnSpy.mockRestore();
  });

  it('shows the empty state when there are no events', () => {
    render(<ActivityTimeline events={[]} />);
    expect(screen.getByText('Belum ada aktivitas.')).toBeInTheDocument();
  });
});
