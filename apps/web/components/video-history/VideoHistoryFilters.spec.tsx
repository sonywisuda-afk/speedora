/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceRole } from '@speedora/shared';
import { VideoHistoryFilters, type VideoHistoryFiltersValue } from './VideoHistoryFilters';

const owner = {
  userId: 'user-1',
  email: 'owner@example.com',
  role: WorkspaceRole.OWNER,
  createdAt: '',
};

function renderFilters(
  value: VideoHistoryFiltersValue,
  overrides: { owners?: (typeof owner)[]; isPersonal?: boolean } = {},
) {
  const onChange = jest.fn();
  render(
    <VideoHistoryFilters
      value={value}
      onChange={onChange}
      owners={overrides.owners ?? [owner]}
      isPersonal={overrides.isPersonal ?? false}
    />,
  );
  return onChange;
}

// Dashboard Improvement Sprint Phase B ("View All" video processing
// history).
describe('VideoHistoryFilters', () => {
  it('debounces search input before calling onChange', async () => {
    const onChange = renderFilters({});

    fireEvent.change(screen.getByLabelText('Cari'), { target: { value: 'zoo' } });
    expect(onChange).not.toHaveBeenCalled();

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ search: 'zoo' }));
  });

  it('reports the selected status filter', () => {
    const onChange = renderFilters({});

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'FAILED' } });

    expect(onChange).toHaveBeenCalledWith({ status: 'FAILED' });
  });

  it('reports the selected date range', () => {
    const onChange = renderFilters({});

    fireEvent.change(screen.getByLabelText('Dari tanggal'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Sampai tanggal'), { target: { value: '2026-02-01' } });

    expect(onChange).toHaveBeenNthCalledWith(1, { dateFrom: '2026-01-01' });
    expect(onChange).toHaveBeenNthCalledWith(2, { dateTo: '2026-02-01' });
  });

  it('shows the Owner select for a non-personal workspace and reports the chosen owner', () => {
    const onChange = renderFilters({}, { isPersonal: false });

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'user-1' } });

    expect(onChange).toHaveBeenCalledWith({ ownerId: 'user-1' });
  });

  it('hides the Owner select entirely for a personal workspace', () => {
    renderFilters({}, { isPersonal: true });

    expect(screen.queryByLabelText('Owner')).not.toBeInTheDocument();
  });
});
