'use client';

import { WorkspaceRole } from '@speedora/shared';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import {
  createWorkspaceInvite,
  getWorkspace,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useWorkspaceStore } from '@/lib/workspaceStore';

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  [WorkspaceRole.OWNER]: 'Owner',
  [WorkspaceRole.ADMIN]: 'Admin',
  [WorkspaceRole.EDITOR]: 'Editor',
  [WorkspaceRole.REVIEWER]: 'Reviewer',
  [WorkspaceRole.VIEWER]: 'Viewer',
};

// Sprint 5A (Collaboration Foundation) - replaces InviteMemberDialog
// (Sprint 1-2's "no shared access, no role enforcement" stub). Operates on
// whichever workspace WorkspaceSwitcher currently has selected (see
// workspaceStore.ts) - real shared access and real 5-tier role enforcement
// now back this, unlike the old dialog's display-only role field.
export function WorkspaceMembersDialog() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>(WorkspaceRole.EDITOR);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: workspace, mutate } = useSWR(
    open && activeWorkspaceId ? ['workspace-detail', activeWorkspaceId] : null,
    () => getWorkspace(activeWorkspaceId as string),
  );

  const isAdmin = workspace ? workspace.role === 'OWNER' || workspace.role === 'ADMIN' : false;

  function reset() {
    setEmail('');
    setRole(WorkspaceRole.EDITOR);
    setSent(false);
    setError(null);
  }

  async function handleSend() {
    if (!activeWorkspaceId) return;
    setError(null);
    setSending(true);
    try {
      await createWorkspaceInvite(activeWorkspaceId, email, role);
      setSent(true);
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim undangan');
    } finally {
      setSending(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: WorkspaceRole) {
    if (!activeWorkspaceId) return;
    await updateWorkspaceMemberRole(activeWorkspaceId, userId, newRole);
    await mutate();
  }

  async function handleRemove(userId: string) {
    if (!activeWorkspaceId) return;
    await removeWorkspaceMember(activeWorkspaceId, userId);
    await mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!activeWorkspaceId}>
          Invite Member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{workspace ? `Members - ${workspace.name}` : 'Members'}</DialogTitle>
        </DialogHeader>

        {isAdmin && activeWorkspaceId && (
          <Link
            href={`/workspaces/${activeWorkspaceId}/audit-log`}
            className="font-body text-xs text-primary underline underline-offset-2"
          >
            Lihat Audit Log
          </Link>
        )}

        {workspace && workspace.members.length > 0 && (
          <div className="max-h-40 space-y-1.5 overflow-y-auto">
            {workspace.members.map((member) => (
              <div
                key={member.userId}
                className="flex items-center justify-between gap-2 font-body text-sm"
              >
                <span className="truncate text-foreground">{member.email}</span>
                {isAdmin && member.role !== WorkspaceRole.OWNER ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <select
                      value={member.role}
                      onChange={(e) =>
                        handleRoleChange(member.userId, e.target.value as WorkspaceRole)
                      }
                      className="h-8 rounded-md border border-input bg-background px-1.5 font-body text-xs text-foreground"
                    >
                      {Object.values(WorkspaceRole)
                        .filter((r) => r !== WorkspaceRole.OWNER)
                        .map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={() => handleRemove(member.userId)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {ROLE_LABELS[member.role]}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {sent ? (
          <p className="font-body text-sm text-success">Invitation sent!</p>
        ) : (
          <>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  Email
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teman@contoh.com"
                />
              </div>
              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  Role
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as WorkspaceRole)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 font-body text-sm text-foreground"
                >
                  {Object.values(WorkspaceRole)
                    .filter((r) => r !== WorkspaceRole.OWNER)
                    .map((value) => (
                      <option key={value} value={value}>
                        {ROLE_LABELS[value]}
                      </option>
                    ))}
                </select>
              </div>
              {error && <p className="font-body text-xs text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button disabled={sending || !email || !isAdmin} onClick={handleSend}>
                {sending ? 'Mengirim...' : 'Send Invite'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
