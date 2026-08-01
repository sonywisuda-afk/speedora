/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createProject } from '@/lib/api';
import { CreateProjectDialog } from './CreateProjectDialog';

jest.mock('@/lib/api', () => ({
  createProject: jest.fn(),
}));

const mockCreateProject = createProject as jest.Mock;

// Dashboard Improvement Sprint Phase A - covers the extracted, shared
// create-project form (previously a private component only reachable from
// /projects) in both its dialog-with-trigger mode (used by /projects and
// QuickActions' "New Project") and its inline hideTrigger mode (used by
// ProjectPickerDialog's empty state, see ProjectPickerDialog.spec.tsx).
describe('CreateProjectDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables submit until a name is entered', () => {
    render(<CreateProjectDialog workspaceId="ws-1" onCreated={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Project' }));

    expect(screen.getByRole('button', { name: 'Buat Project' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Nama project'), {
      target: { value: 'My Project' },
    });

    expect(screen.getByRole('button', { name: 'Buat Project' })).not.toBeDisabled();
  });

  it('calls createProject and onCreated on success', async () => {
    const created = { id: 'proj-1', name: 'My Project' };
    mockCreateProject.mockResolvedValue(created);
    const onCreated = jest.fn();

    render(<CreateProjectDialog workspaceId="ws-1" onCreated={onCreated} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Project' }));
    fireEvent.change(screen.getByPlaceholderText('Nama project'), {
      target: { value: 'My Project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buat Project' }));

    expect(mockCreateProject).toHaveBeenCalledWith('ws-1', 'My Project');
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(screen.queryByPlaceholderText('Nama project')).not.toBeInTheDocument();
  });

  it('shows an error message when creation fails', async () => {
    mockCreateProject.mockRejectedValue(new Error('Nama sudah dipakai'));

    render(<CreateProjectDialog workspaceId="ws-1" onCreated={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Project' }));
    fireEvent.change(screen.getByPlaceholderText('Nama project'), {
      target: { value: 'Dup' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buat Project' }));

    expect(await screen.findByText('Nama sudah dipakai')).toBeInTheDocument();
  });

  it('hideTrigger mode renders the form inline with no dialog trigger', async () => {
    const created = { id: 'proj-2', name: 'Inline Project' };
    mockCreateProject.mockResolvedValue(created);
    const onCreated = jest.fn();

    render(<CreateProjectDialog workspaceId="ws-1" onCreated={onCreated} hideTrigger />);

    expect(screen.queryByRole('button', { name: '+ Project' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Nama project'), {
      target: { value: 'Inline Project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buat Project' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
  });
});
