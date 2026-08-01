/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { createProject, listProjects } from '@/lib/api';
import { ProjectPickerDialog } from './ProjectPickerDialog';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/api', () => ({
  listProjects: jest.fn(),
  createProject: jest.fn(),
}));

const mockListProjects = listProjects as jest.Mock;
const mockCreateProject = createProject as jest.Mock;

function project(overrides: Partial<{ id: string; name: string }> = {}) {
  return {
    id: 'proj-1',
    name: 'My Project',
    workspaceId: 'ws-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

// Dashboard Improvement Sprint Phase A - covers the gate the Dashboard's
// "Upload Video"/"Import YouTube URL" quick actions sit behind: an empty
// workspace dead-ends helpfully into inline project creation, a populated
// one lets the user pick or create, and confirming always navigates to
// /upload with the chosen project attached (see the Phase A plan).
function renderPicker(mode: 'file' | 'youtube' = 'file') {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ProjectPickerDialog workspaceId="ws-1" mode={mode} open onOpenChange={jest.fn()} />
    </SWRConfig>,
  );
}

describe('ProjectPickerDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the empty state with inline creation when there are no projects', async () => {
    mockListProjects.mockResolvedValue({ projects: [] });
    mockCreateProject.mockResolvedValue(project({ id: 'proj-new', name: 'First Project' }));

    renderPicker();

    expect(await screen.findByText("You don't have any project yet.")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Nama project'), {
      target: { value: 'First Project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buat Project' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/upload?projectId=proj-new'));
  });

  it('lists existing projects and continues to upload with the selected one', async () => {
    mockListProjects.mockResolvedValue({ projects: [project({ id: 'proj-1', name: 'Existing' })] });

    renderPicker();

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'proj-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Upload' }));

    expect(mockPush).toHaveBeenCalledWith('/upload?projectId=proj-1');
  });

  it('youtube mode appends &import=youtube to the destination', async () => {
    mockListProjects.mockResolvedValue({ projects: [project({ id: 'proj-1' })] });

    renderPicker('youtube');

    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'proj-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Upload' }));

    expect(mockPush).toHaveBeenCalledWith('/upload?projectId=proj-1&import=youtube');
  });

  it('"+ New Project" switches a populated picker into inline creation', async () => {
    mockListProjects.mockResolvedValue({ projects: [project({ id: 'proj-1' })] });
    mockCreateProject.mockResolvedValue(project({ id: 'proj-new', name: 'Another' }));

    renderPicker();

    await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: '+ New Project' }));

    expect(screen.getByPlaceholderText('Nama project')).toBeInTheDocument();
  });

  // QA pass finding: "+ New Project" previously had no way back to the
  // select list short of closing the whole dialog - a real dead end for a
  // user who clicked it by mistake.
  it('"+ New Project" can be cancelled back to the select list', async () => {
    mockListProjects.mockResolvedValue({ projects: [project({ id: 'proj-1' })] });

    renderPicker();

    await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: '+ New Project' }));
    expect(screen.getByPlaceholderText('Nama project')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Batal/ }));

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Nama project')).not.toBeInTheDocument();
  });

  // The empty-state path has no list to go back to, so no "Batal" affordance
  // should render there - closing the dialog is the only way out, which is
  // correct since it's the forced path, not a user choice.
  it('does not show a "Batal" back button in the forced empty-state path', async () => {
    mockListProjects.mockResolvedValue({ projects: [] });

    renderPicker();

    await screen.findByText("You don't have any project yet.");

    expect(screen.queryByRole('button', { name: /Batal/ })).not.toBeInTheDocument();
  });
});
