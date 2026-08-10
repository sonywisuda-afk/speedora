'use client';

import { WorkspaceRole, type WorkspaceMemberDto } from '@speedora/shared';
import { useState } from 'react';
import useSWR from 'swr';
import { getWorkspace } from '@/lib/api';

// Collaboration roadmap follow-up (2026-08-10) - the shared workspace-
// member-picker building block CommentsPanel's mention feature and
// ApprovalPanel's reviewer feature were both left waiting for (see
// project_collaboration_roadmap.md). A thin SWR wrap of the same
// getWorkspace() WorkspaceMembersDialog.tsx already uses, not a new
// endpoint - members are already returned on WorkspaceDetailDto, no
// dedicated "list members" route exists or is needed.
const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  [WorkspaceRole.VIEWER]: 0,
  [WorkspaceRole.REVIEWER]: 1,
  [WorkspaceRole.EDITOR]: 2,
  [WorkspaceRole.ADMIN]: 3,
  [WorkspaceRole.OWNER]: 4,
};

// minRole mirrors each consumer's own real server-side validation, so the
// picker never offers a choice the server would reject:
// - CommentsService.create's mentionedUserIds check is "any workspace
//   member" (no minRole - the default here).
// - ApprovalsService.request's reviewerId check requires REVIEWER+ (see
//   ApprovalPanel.tsx's own use of this hook).
export function useWorkspaceMembers(
  workspaceId: string | null,
  minRole?: WorkspaceRole,
): { members: WorkspaceMemberDto[]; isLoading: boolean } {
  const { data, isLoading } = useSWR(workspaceId ? ['workspace-members', workspaceId] : null, () =>
    getWorkspace(workspaceId as string),
  );
  const members = (data?.members ?? []).filter(
    (m) => !minRole || WORKSPACE_ROLE_RANK[m.role] >= WORKSPACE_ROLE_RANK[minRole],
  );
  return { members, isLoading };
}

// Chip-based mention picker (resolved via AskUserQuestion over an inline
// "@" autocomplete - simpler to build correctly, no cursor-position
// tracking, and the comment body itself stays plain free text - a user can
// still type "@name" by hand in the text, this control is purely what
// actually populates CreateCommentDto.mentionedUserIds). Selected members
// render as removable chips; "+ Mention" opens a small dropdown of
// not-yet-selected members.
export function MentionPicker({
  workspaceId,
  selectedUserIds,
  onChange,
}: {
  workspaceId: string | null;
  selectedUserIds: string[];
  onChange: (userIds: string[]) => void;
}) {
  const { members } = useWorkspaceMembers(workspaceId);
  const [open, setOpen] = useState(false);

  const selected = members.filter((m) => selectedUserIds.includes(m.userId));
  const available = members.filter((m) => !selectedUserIds.includes(m.userId));

  function add(userId: string) {
    onChange([...selectedUserIds, userId]);
    setOpen(false);
  }

  function remove(userId: string) {
    onChange(selectedUserIds.filter((id) => id !== userId));
  }

  if (!workspaceId) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((member) => (
        <span
          key={member.userId}
          className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-body text-xs text-primary"
        >
          @{member.email}
          <button
            onClick={() => remove(member.userId)}
            aria-label={`Hapus mention ${member.email}`}
            className="hover:text-destructive"
          >
            ×
          </button>
        </span>
      ))}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-full border border-dashed border-border px-2 py-0.5 font-body text-xs text-muted-foreground hover:bg-accent"
        >
          + Mention
        </button>
        {open && (
          <div className="absolute left-0 top-full z-10 mt-1 min-w-[10rem] rounded-md border border-border bg-card p-1 shadow-dialog">
            {available.length === 0 ? (
              <p className="px-2 py-1 font-body text-xs text-muted-foreground">
                Tidak ada anggota lain.
              </p>
            ) : (
              available.map((member) => (
                <button
                  key={member.userId}
                  onClick={() => add(member.userId)}
                  className="block w-full rounded px-2 py-1 text-left font-body text-xs text-foreground hover:bg-accent"
                >
                  {member.email}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
