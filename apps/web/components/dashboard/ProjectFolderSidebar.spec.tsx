/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { createFolder, deleteFolder, listFolders, listProjects, updateFolder } from '@/lib/api';
import { ProjectFolderSidebar } from './ProjectFolderSidebar';

jest.mock('@/lib/api', () => ({
  listProjects: jest.fn(),
  listFolders: jest.fn(),
  createFolder: jest.fn(),
  updateFolder: jest.fn(),
  deleteFolder: jest.fn(),
}));

const mockListProjects = listProjects as jest.Mock;
const mockListFolders = listFolders as jest.Mock;
const mockCreateFolder = createFolder as jest.Mock;
const mockUpdateFolder = updateFolder as jest.Mock;
const mockDeleteFolder = deleteFolder as jest.Mock;

function project(overrides: Partial<{ id: string; name: string }> = {}) {
  return { id: 'proj-1', name: 'My Project', workspaceId: 'ws-1', ...overrides };
}

function folder(overrides: Partial<{ id: string; name: string; parentId: string | null }> = {}) {
  return {
    id: 'folder-1',
    projectId: 'proj-1',
    parentId: null,
    name: 'Root Folder',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderSidebar(onSelect = jest.fn()) {
  const utils = render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ProjectFolderSidebar
        workspaceId="ws-1"
        selection={{ projectId: null, folderId: null }}
        onSelect={onSelect}
      />
    </SWRConfig>,
  );
  return { ...utils, onSelect };
}

// Collaboration roadmap follow-up (2026-08-10) - covers the Folder CRUD API's first frontend
// consumer: listing/selecting Projects and Folders, and the inline create/rename/delete
// interactions built directly into the tree.
describe('ProjectFolderSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListFolders.mockResolvedValue({ folders: [] });
  });

  it('renders nothing when there is no active workspace', () => {
    const { container } = render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ProjectFolderSidebar
          workspaceId={null}
          selection={{ projectId: null, folderId: null }}
          onSelect={jest.fn()}
        />
      </SWRConfig>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists every project from the real API response', async () => {
    mockListProjects.mockResolvedValue({ projects: [project({ id: 'proj-1', name: 'Podcast' })] });

    renderSidebar();

    expect(await screen.findByText('Podcast')).toBeInTheDocument();
    expect(screen.getByText('Semua Video')).toBeInTheDocument();
  });

  it('selecting "Semua Video" clears the selection', async () => {
    mockListProjects.mockResolvedValue({ projects: [project()] });
    const { onSelect } = renderSidebar();

    await screen.findByText('My Project');
    fireEvent.click(screen.getByText('Semua Video'));

    expect(onSelect).toHaveBeenCalledWith({ projectId: null, folderId: null });
  });

  it('clicking a project selects it (projectId set, folderId null)', async () => {
    mockListProjects.mockResolvedValue({ projects: [project({ id: 'proj-1' })] });
    const { onSelect } = renderSidebar();

    fireEvent.click(await screen.findByText('My Project'));

    expect(onSelect).toHaveBeenCalledWith({ projectId: 'proj-1', folderId: null });
  });

  it('expanding a project fetches and renders its folder tree, nesting children under their parent', async () => {
    mockListProjects.mockResolvedValue({ projects: [project({ id: 'proj-1' })] });
    mockListFolders.mockResolvedValue({
      folders: [
        folder({ id: 'folder-root', name: 'Root', parentId: null }),
        folder({ id: 'folder-child', name: 'Child', parentId: 'folder-root' }),
      ],
    });

    renderSidebar();
    await screen.findByText('My Project');
    fireEvent.click(screen.getByTitle('Buka'));

    expect(await screen.findByText(/Root/)).toBeInTheDocument();
    expect(await screen.findByText(/Child/)).toBeInTheDocument();
    expect(mockListFolders).toHaveBeenCalledWith('proj-1');
  });

  it('clicking a folder selects it alongside its project', async () => {
    mockListProjects.mockResolvedValue({ projects: [project({ id: 'proj-1' })] });
    mockListFolders.mockResolvedValue({ folders: [folder({ id: 'folder-1', name: 'Clips' })] });
    const { onSelect } = renderSidebar();

    await screen.findByText('My Project');
    fireEvent.click(screen.getByTitle('Buka'));
    fireEvent.click(await screen.findByText(/Clips/));

    expect(onSelect).toHaveBeenCalledWith({ projectId: 'proj-1', folderId: 'folder-1' });
  });

  it('creates a new root folder via the project-level "+" control', async () => {
    mockListProjects.mockResolvedValue({ projects: [project({ id: 'proj-1' })] });
    mockCreateFolder.mockResolvedValue(folder({ id: 'folder-new', name: 'New Folder' }));

    renderSidebar();
    await screen.findByText('My Project');
    fireEvent.click(screen.getByTitle('Folder baru'));

    const input = await screen.findByPlaceholderText('Nama folder');
    fireEvent.change(input, { target: { value: 'New Folder' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(mockCreateFolder).toHaveBeenCalledWith('proj-1', { name: 'New Folder' }),
    );
  });

  it('creates a sub-folder under an existing folder with the correct parentId', async () => {
    mockListProjects.mockResolvedValue({ projects: [project({ id: 'proj-1' })] });
    mockListFolders.mockResolvedValue({ folders: [folder({ id: 'folder-1', name: 'Parent' })] });
    mockCreateFolder.mockResolvedValue(folder({ id: 'folder-child', name: 'Child' }));

    renderSidebar();
    await screen.findByText('My Project');
    fireEvent.click(screen.getByTitle('Buka'));
    await screen.findByText(/Parent/);

    fireEvent.click(screen.getByTitle('Sub-folder baru'));
    const input = await screen.findByPlaceholderText('Nama sub-folder');
    fireEvent.change(input, { target: { value: 'Child' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(mockCreateFolder).toHaveBeenCalledWith('proj-1', {
        name: 'Child',
        parentId: 'folder-1',
      }),
    );
  });

  it('renames a folder inline', async () => {
    mockListProjects.mockResolvedValue({ projects: [project({ id: 'proj-1' })] });
    mockListFolders.mockResolvedValue({ folders: [folder({ id: 'folder-1', name: 'Old Name' })] });
    mockUpdateFolder.mockResolvedValue(folder({ id: 'folder-1', name: 'New Name' }));

    renderSidebar();
    await screen.findByText('My Project');
    fireEvent.click(screen.getByTitle('Buka'));
    await screen.findByText(/Old Name/);

    fireEvent.click(screen.getByTitle('Ganti nama'));
    const input = screen.getByDisplayValue('Old Name');
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(mockUpdateFolder).toHaveBeenCalledWith('folder-1', { name: 'New Name' }),
    );
  });

  it('deletes a folder only after the two-step confirmation', async () => {
    mockListProjects.mockResolvedValue({ projects: [project({ id: 'proj-1' })] });
    mockListFolders.mockResolvedValue({ folders: [folder({ id: 'folder-1', name: 'Doomed' })] });
    mockDeleteFolder.mockResolvedValue(undefined);

    renderSidebar();
    await screen.findByText('My Project');
    fireEvent.click(screen.getByTitle('Buka'));
    await screen.findByText(/Doomed/);

    fireEvent.click(screen.getByTitle('Hapus folder'));
    expect(mockDeleteFolder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Yakin?'));
    await waitFor(() => expect(mockDeleteFolder).toHaveBeenCalledWith('folder-1'));
  });

  it('shows a "no projects" hint when the workspace has none', async () => {
    mockListProjects.mockResolvedValue({ projects: [] });

    renderSidebar();

    expect(await screen.findByText('Belum ada project.')).toBeInTheDocument();
  });
});
