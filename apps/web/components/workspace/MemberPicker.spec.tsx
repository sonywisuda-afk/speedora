/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { WorkspaceRole } from '@speedora/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { getWorkspace } from '@/lib/api';
import { MentionPicker, useWorkspaceMembers } from './MemberPicker';

jest.mock('@/lib/api', () => ({
  getWorkspace: jest.fn(),
}));

const mockGetWorkspace = getWorkspace as jest.Mock;

function member(overrides: Partial<{ userId: string; email: string; role: WorkspaceRole }> = {}) {
  return {
    userId: 'user-1',
    email: 'user1@example.com',
    role: WorkspaceRole.EDITOR,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function workspace(members: ReturnType<typeof member>[]) {
  return {
    id: 'ws-1',
    name: 'My Workspace',
    isPersonal: false,
    role: WorkspaceRole.OWNER,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    members,
  };
}

function renderWithSwr(node: React.ReactNode) {
  return render(<SWRConfig value={{ provider: () => new Map() }}>{node}</SWRConfig>);
}

// Collaboration roadmap follow-up (2026-08-10) - the shared building block CommentsPanel's
// mention feature and ApprovalPanel's reviewer feature were both left waiting for.
describe('useWorkspaceMembers', () => {
  beforeEach(() => jest.clearAllMocks());

  function Probe({ workspaceId, minRole }: { workspaceId: string; minRole?: WorkspaceRole }) {
    const { members } = useWorkspaceMembers(workspaceId, minRole);
    return (
      <ul>
        {members.map((m) => (
          <li key={m.userId}>{m.email}</li>
        ))}
      </ul>
    );
  }

  it('returns every member when no minRole is given', async () => {
    mockGetWorkspace.mockResolvedValue(
      workspace([
        member({ userId: 'u1', email: 'viewer@x.com', role: WorkspaceRole.VIEWER }),
        member({ userId: 'u2', email: 'owner@x.com', role: WorkspaceRole.OWNER }),
      ]),
    );

    renderWithSwr(<Probe workspaceId="ws-1" />);

    expect(await screen.findByText('viewer@x.com')).toBeInTheDocument();
    expect(screen.getByText('owner@x.com')).toBeInTheDocument();
  });

  it('filters out members below minRole (mirrors ApprovalsService.request REVIEWER+ check)', async () => {
    mockGetWorkspace.mockResolvedValue(
      workspace([
        member({ userId: 'u1', email: 'viewer@x.com', role: WorkspaceRole.VIEWER }),
        member({ userId: 'u2', email: 'reviewer@x.com', role: WorkspaceRole.REVIEWER }),
        member({ userId: 'u3', email: 'owner@x.com', role: WorkspaceRole.OWNER }),
      ]),
    );

    renderWithSwr(<Probe workspaceId="ws-1" minRole={WorkspaceRole.REVIEWER} />);

    await waitFor(() => expect(screen.getByText('reviewer@x.com')).toBeInTheDocument());
    expect(screen.getByText('owner@x.com')).toBeInTheDocument();
    expect(screen.queryByText('viewer@x.com')).not.toBeInTheDocument();
  });
});

describe('MentionPicker', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing when there is no workspace', () => {
    const { container } = renderWithSwr(
      <MentionPicker workspaceId={null} selectedUserIds={[]} onChange={jest.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the dropdown and adds a member as a chip on click', async () => {
    mockGetWorkspace.mockResolvedValue(
      workspace([member({ userId: 'u1', email: 'sony@example.com' })]),
    );
    const onChange = jest.fn();

    renderWithSwr(<MentionPicker workspaceId="ws-1" selectedUserIds={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText('+ Mention'));

    fireEvent.click(await screen.findByText('sony@example.com'));

    expect(onChange).toHaveBeenCalledWith(['u1']);
  });

  it('renders selected members as removable chips and excludes them from the add dropdown', async () => {
    mockGetWorkspace.mockResolvedValue(
      workspace([
        member({ userId: 'u1', email: 'sony@example.com' }),
        member({ userId: 'u2', email: 'budi@example.com' }),
      ]),
    );
    const onChange = jest.fn();

    renderWithSwr(
      <MentionPicker workspaceId="ws-1" selectedUserIds={['u1']} onChange={onChange} />,
    );

    expect(await screen.findByText('@sony@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByText('+ Mention'));
    expect(await screen.findByText('budi@example.com')).toBeInTheDocument();
    expect(screen.queryByText('sony@example.com', { exact: true })).not.toBeInTheDocument();
  });

  it('removing a chip calls onChange without that userId', async () => {
    mockGetWorkspace.mockResolvedValue(
      workspace([member({ userId: 'u1', email: 'sony@example.com' })]),
    );
    const onChange = jest.fn();

    renderWithSwr(
      <MentionPicker workspaceId="ws-1" selectedUserIds={['u1']} onChange={onChange} />,
    );

    fireEvent.click(await screen.findByLabelText('Hapus mention sony@example.com'));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
