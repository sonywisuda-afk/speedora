'use client';

import { WorkspaceRole } from '@speedora/shared';
import type { AuditLogEntryDto, WorkspaceDetailDto, WorkspaceMemberDto } from '@speedora/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Nav } from '@/components/Nav';
import { Badge } from '@/components/ui/badge';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  createWorkspaceInvite,
  deleteWorkspace,
  getWorkspace,
  leaveWorkspace,
  listWorkspaceAuditLog,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
  updateWorkspace,
  updateWorkspaceMemberRole,
} from '@/lib/api';
import { getAuditActionLabel } from '@/lib/audit-log-labels';
import { formatRelativeTime } from '@/lib/dashboard';
import { toast } from '@/lib/toast-store';
import { useAuth } from '@/lib/useAuth';
import { useWorkspaceStore } from '@/lib/workspaceStore';

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  [WorkspaceRole.OWNER]: 'Owner',
  [WorkspaceRole.ADMIN]: 'Admin',
  [WorkspaceRole.EDITOR]: 'Editor',
  [WorkspaceRole.REVIEWER]: 'Reviewer',
  [WorkspaceRole.VIEWER]: 'Viewer',
};

// Workspace Lifecycle Management roadmap - completes the Workspace's
// lifecycle (CRUD/Archive/Move/Bulk/Transfer Ownership already exist for
// Project; Workspace itself had Transfer Ownership but no Settings surface
// at all, no Delete, no Leave). This is the first General Workspace
// Settings page (previously only a standalone Audit Log route existed).
// Members/Audit Log tabs are self-contained re-implementations (not the
// modal-based WorkspaceMembersDialog, which reads the globally *active*
// workspace from workspaceStore - this page must work for the workspace in
// the URL regardless of which one is currently active) - Audit Log reuses
// the same ACTION_LABELS as the dedicated /workspaces/[id]/audit-log route
// so the two never drift.
export default function WorkspaceSettingsPage({ params }: { params: { id: string } }) {
  const { user, checkingAuth, logout } = useAuth();
  const router = useRouter();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);

  const {
    data: workspace,
    error,
    mutate,
  } = useSWR(user ? ['workspace-settings', params.id] : null, () => getWorkspace(params.id));

  const isAdmin = workspace ? workspace.role === 'OWNER' || workspace.role === 'ADMIN' : false;
  const isOwner = workspace ? workspace.role === 'OWNER' : false;

  function afterLeaveOrDelete() {
    if (activeWorkspaceId === params.id) {
      setActiveWorkspaceId(null);
    }
    router.push('/projects');
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
              Workspace Settings
            </h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              {workspace ? (workspace.isPersonal ? 'Personal' : workspace.name) : 'Memuat...'}
            </p>
          </div>
        </div>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat pengaturan workspace.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {error && (
              <p className="mt-4 font-body text-sm text-destructive">
                {error instanceof Error ? error.message : 'Gagal memuat workspace'}
              </p>
            )}

            {workspace && (
              <Tabs defaultValue="general" className="mt-8">
                <TabsList>
                  <TabsTrigger value="general">General</TabsTrigger>
                  <TabsTrigger value="members">Members</TabsTrigger>
                  {isAdmin && <TabsTrigger value="audit-log">Audit Log</TabsTrigger>}
                  <TabsTrigger value="danger-zone">Danger Zone</TabsTrigger>
                </TabsList>

                <TabsContent value="general">
                  <GeneralTab workspace={workspace} isAdmin={isAdmin} onChanged={() => mutate()} />
                </TabsContent>

                <TabsContent value="members">
                  <MembersTab
                    workspace={workspace}
                    isAdmin={isAdmin}
                    isOwner={isOwner}
                    onChanged={() => mutate()}
                  />
                </TabsContent>

                {isAdmin && (
                  <TabsContent value="audit-log">
                    <AuditLogTab workspaceId={workspace.id} />
                  </TabsContent>
                )}

                <TabsContent value="danger-zone">
                  <DangerZoneTab
                    workspace={workspace}
                    isOwner={isOwner}
                    onTransferred={() => mutate()}
                    onLeft={afterLeaveOrDelete}
                    onDeleted={afterLeaveOrDelete}
                  />
                </TabsContent>
              </Tabs>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function GeneralTab({
  workspace,
  isAdmin,
  onChanged,
}: {
  workspace: WorkspaceDetailDto;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(workspace.name);
  }, [workspace.name]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await updateWorkspace(workspace.id, name.trim());
      toast({ title: 'Workspace disimpan', tone: 'good' });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan workspace');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Nama Workspace
        </label>
        {workspace.isPersonal ? (
          <p className="font-body text-sm text-foreground">
            Personal <span className="text-muted-foreground">(tidak bisa diubah)</span>
          </p>
        ) : (
          <div className="flex max-w-sm gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} />
            {isAdmin && (
              <Button
                disabled={saving || !name.trim() || name.trim() === workspace.name}
                onClick={handleSave}
              >
                {saving ? 'Menyimpan...' : 'Simpan'}
              </Button>
            )}
          </div>
        )}
        {error && <p className="font-body text-xs text-destructive">{error}</p>}
      </div>

      <dl className="grid max-w-sm grid-cols-2 gap-y-2 font-body text-sm">
        <dt className="text-muted-foreground">Tipe</dt>
        <dd className="text-foreground">{workspace.isPersonal ? 'Personal' : 'Team'}</dd>
        <dt className="text-muted-foreground">Peranmu</dt>
        <dd className="text-foreground">{ROLE_LABELS[workspace.role]}</dd>
        <dt className="text-muted-foreground">Jumlah Anggota</dt>
        <dd className="text-foreground">{workspace.memberCount}</dd>
        <dt className="text-muted-foreground">Dibuat</dt>
        <dd className="text-foreground">{formatRelativeTime(workspace.createdAt)}</dd>
      </dl>
    </div>
  );
}

function MembersTab({
  workspace,
  isAdmin,
  isOwner,
  onChanged,
}: {
  workspace: WorkspaceDetailDto;
  isAdmin: boolean;
  isOwner: boolean;
  onChanged: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>(WorkspaceRole.EDITOR);
  const [sending, setSending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<{ userId: string; email: string } | null>(
    null,
  );
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  async function handleInvite() {
    setInviteError(null);
    setSending(true);
    try {
      await createWorkspaceInvite(workspace.id, email, role);
      toast({ title: 'Undangan dikirim', description: email, tone: 'good' });
      setEmail('');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Gagal mengirim undangan');
    } finally {
      setSending(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: WorkspaceRole) {
    await updateWorkspaceMemberRole(workspace.id, userId, newRole);
    onChanged();
  }

  async function handleRemove(userId: string) {
    await removeWorkspaceMember(workspace.id, userId);
    toast({ title: 'Anggota dihapus', tone: 'neutral' });
    onChanged();
  }

  async function handleTransferConfirm() {
    if (!transferTarget) return;
    setTransferError(null);
    setTransferring(true);
    try {
      await transferWorkspaceOwnership(workspace.id, transferTarget.userId);
      toast({ title: 'Kepemilikan ditransfer', description: transferTarget.email, tone: 'good' });
      setTransferTarget(null);
      onChanged();
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : 'Gagal mentransfer kepemilikan');
    } finally {
      setTransferring(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        {workspace.members.map((member: WorkspaceMemberDto) => (
          <div
            key={member.userId}
            className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted px-3 py-2 font-body text-sm"
          >
            <span className="truncate text-foreground">{member.email}</span>
            {isAdmin && member.role !== WorkspaceRole.OWNER ? (
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member.userId, e.target.value as WorkspaceRole)}
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
                {isOwner && (
                  <button
                    onClick={() =>
                      setTransferTarget({ userId: member.userId, email: member.email })
                    }
                    className="font-body text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Jadikan Owner
                  </button>
                )}
                <button
                  onClick={() => handleRemove(member.userId)}
                  className="font-body text-xs text-destructive hover:underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <Badge variant="muted">{ROLE_LABELS[member.role]}</Badge>
            )}
          </div>
        ))}
      </div>

      {transferTarget && (
        <div className="rounded-md border border-border bg-muted p-3 font-body text-sm">
          <p className="text-foreground">
            Jadikan <span className="font-medium">{transferTarget.email}</span> owner workspace ini?
            Kamu akan turun jadi Admin.
          </p>
          {transferError && <p className="mt-1.5 text-xs text-destructive">{transferError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => setTransferTarget(null)}
              className="font-body text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Batal
            </button>
            <Button size="sm" disabled={transferring} onClick={handleTransferConfirm}>
              {transferring ? 'Mentransfer...' : 'Ya, Transfer'}
            </Button>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="max-w-sm space-y-3 rounded-md border border-border p-4">
          <p className="font-display text-xs uppercase tracking-wide text-foreground">
            Invite Member
          </p>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teman@contoh.com"
          />
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
          {inviteError && <p className="font-body text-xs text-destructive">{inviteError}</p>}
          <Button disabled={sending || !email} onClick={handleInvite}>
            {sending ? 'Mengirim...' : 'Send Invite'}
          </Button>
        </div>
      )}
    </div>
  );
}

const AUDIT_LOG_LIMIT = 20;

function AuditLogTab({ workspaceId }: { workspaceId: string }) {
  const [entries, setEntries] = useState<AuditLogEntryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listWorkspaceAuditLog(workspaceId, { limit: AUDIT_LOG_LIMIT }).then((page) => {
      if (cancelled) return;
      setEntries(page.entries);
      setNextCursor(page.nextCursor);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listWorkspaceAuditLog(workspaceId, {
        cursor: nextCursor,
        limit: AUDIT_LOG_LIMIT,
      });
      setEntries((prev) => [...prev, ...page.entries]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) return null;

  return (
    <div className="space-y-2">
      <Link
        href={`/workspaces/${workspaceId}/audit-log`}
        className="font-body text-xs text-primary underline underline-offset-2"
      >
        Buka halaman penuh
      </Link>
      {entries.length === 0 ? (
        <p className="font-body text-sm text-muted-foreground">Belum ada aktivitas.</p>
      ) : (
        entries.map((entry) => (
          <div
            key={entry.id}
            className="rounded-md border border-border bg-muted p-3 font-body text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">
                {getAuditActionLabel(entry.action)}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {formatRelativeTime(entry.createdAt)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              oleh {entry.actorEmail} · {entry.targetType}
              {entry.targetId ? ` (${entry.targetId})` : ''}
            </p>
          </div>
        ))
      )}
      {nextCursor && (
        <div className="flex justify-center pt-2">
          <Button size="sm" variant="outline" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Memuat...' : 'Load More'}
          </Button>
        </div>
      )}
    </div>
  );
}

function DangerZoneTab({
  workspace,
  isOwner,
  onTransferred,
  onLeft,
  onDeleted,
}: {
  workspace: WorkspaceDetailDto;
  isOwner: boolean;
  onTransferred: () => void;
  onLeft: () => void;
  onDeleted: () => void;
}) {
  if (workspace.isPersonal) {
    return (
      <p className="font-body text-sm text-muted-foreground">
        Personal workspace tidak dapat dihapus atau ditinggalkan - setiap akun memilikinya secara
        permanen sejak akun dibuat.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {isOwner ? (
        <>
          <DangerZoneRow
            title="Transfer Ownership"
            description="Jadikan anggota lain sebagai owner workspace ini. Kamu akan turun jadi Admin."
          >
            <TransferOwnershipDialog workspace={workspace} onTransferred={onTransferred} />
          </DangerZoneRow>
          <DangerZoneRow
            title="Delete Workspace"
            description="Hapus workspace ini secara permanen. Workspace harus kosong (tanpa project, video, campaign, recurring schedule, tracked link, atau anggota lain)."
          >
            <DeleteWorkspaceDialog workspace={workspace} onDeleted={onDeleted} />
          </DangerZoneRow>
        </>
      ) : (
        <DangerZoneRow
          title="Leave Workspace"
          description="Keluar dari workspace ini. Kamu akan kehilangan akses ke seluruh video, project, dan resource di dalamnya."
        >
          <LeaveWorkspaceDialog workspace={workspace} onLeft={onLeft} />
        </DangerZoneRow>
      )}
    </div>
  );
}

function DangerZoneRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-destructive/30 bg-destructive-surface/40 p-4">
      <div className="min-w-0">
        <p className="font-body text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 font-body text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function TransferOwnershipDialog({
  workspace,
  onTransferred,
}: {
  workspace: WorkspaceDetailDto;
  onTransferred: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = workspace.members.filter((m) => m.role !== WorkspaceRole.OWNER);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTargetUserId('');
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={candidates.length === 0}>
          Transfer Ownership
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer Ownership</DialogTitle>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="font-body text-sm text-muted-foreground">
            Belum ada anggota lain untuk dijadikan owner - undang anggota terlebih dahulu.
          </p>
        ) : (
          <>
            <p className="font-body text-sm text-muted-foreground">
              Jadikan anggota berikut sebagai owner{' '}
              <span className="font-medium text-foreground">&quot;{workspace.name}&quot;</span>.
              Kamu akan turun jadi Admin, dan tindakan ini tidak bisa dibatalkan sendiri (harus
              ditransfer balik oleh owner baru).
            </p>
            <select
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 font-body text-sm text-foreground"
            >
              <option value="" disabled>
                Pilih anggota
              </option>
              {candidates.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.email}
                </option>
              ))}
            </select>
          </>
        )}
        {error && <p className="font-body text-xs text-destructive">{error}</p>}
        {candidates.length > 0 && (
          <DialogFooter>
            <Button
              disabled={transferring || !targetUserId}
              onClick={async () => {
                setError(null);
                setTransferring(true);
                try {
                  await transferWorkspaceOwnership(workspace.id, targetUserId);
                  setOpen(false);
                  toast({ title: 'Kepemilikan ditransfer', tone: 'good' });
                  onTransferred();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Gagal mentransfer kepemilikan');
                } finally {
                  setTransferring(false);
                }
              }}
            >
              {transferring ? 'Mentransfer...' : 'Ya, Transfer'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteWorkspaceDialog({
  workspace,
  onDeleted,
}: {
  workspace: WorkspaceDetailDto;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Delete Workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Workspace</DialogTitle>
        </DialogHeader>
        <p className="font-body text-sm text-muted-foreground">
          Hapus <span className="font-medium text-foreground">&quot;{workspace.name}&quot;</span>{' '}
          secara permanen? Tindakan ini tidak bisa dibatalkan. Workspace ini tidak akan dihapus jika
          masih berisi project, video, campaign, recurring schedule, tracked link, atau anggota
          lain.
        </p>
        {error && <p className="font-body text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={deleting}
            onClick={async () => {
              setError(null);
              setDeleting(true);
              try {
                await deleteWorkspace(workspace.id);
                setOpen(false);
                toast({ title: 'Workspace dihapus', description: workspace.name, tone: 'good' });
                onDeleted();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Gagal menghapus workspace');
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? 'Menghapus...' : 'Hapus Workspace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveWorkspaceDialog({
  workspace,
  onLeft,
}: {
  workspace: WorkspaceDetailDto;
  onLeft: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Leave Workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave Workspace</DialogTitle>
        </DialogHeader>
        <p className="font-body text-sm text-muted-foreground">
          Keluar dari{' '}
          <span className="font-medium text-foreground">&quot;{workspace.name}&quot;</span>? Kamu
          akan kehilangan akses ke seluruh video, project, dan resource di workspace ini sampai
          diundang kembali.
        </p>
        {error && <p className="font-body text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={leaving}
            onClick={async () => {
              setError(null);
              setLeaving(true);
              try {
                await leaveWorkspace(workspace.id);
                setOpen(false);
                toast({ title: 'Kamu telah keluar', description: workspace.name, tone: 'neutral' });
                onLeft();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Gagal keluar dari workspace');
              } finally {
                setLeaving(false);
              }
            }}
          >
            {leaving ? 'Keluar...' : 'Ya, Keluar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
