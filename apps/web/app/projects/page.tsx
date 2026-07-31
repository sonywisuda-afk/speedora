'use client';

import { WorkspaceRole } from '@speedora/shared';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Nav } from '@/components/Nav';
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
import { createProject, deleteProject, getWorkspace, listProjects, updateProject } from '@/lib/api';
import { formatRelativeTime } from '@/lib/dashboard';
import { useAuth } from '@/lib/useAuth';
import { useWorkspaceStore } from '@/lib/workspaceStore';

const EDIT_ROLES: WorkspaceRole[] = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
  WorkspaceRole.EDITOR,
];
const DELETE_ROLES: WorkspaceRole[] = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN];

// Project Management UI - ProjectService (apps/api/src/workspace/project.service.ts,
// Sprint 5A) has always had full create/list/rename/delete, but apps/web never
// called it - a Project could only ever be created via a direct API call, and
// never renamed or deleted at all. This closes that gap with the minimum
// surface: a flat /projects route (same "reads activeWorkspaceId from the
// store" convention as /campaigns), a create dialog, and per-row
// rename/delete. Role buttons are hidden client-side per EDIT_ROLES/
// DELETE_ROLES purely for UX - WorkspaceAccessService.assertMinRole is the
// real enforcement.
export default function ProjectsPage() {
  const { user, checkingAuth, logout } = useAuth();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const { data: workspace } = useSWR(
    user && activeWorkspaceId ? ['workspace-detail', activeWorkspaceId] : null,
    () => getWorkspace(activeWorkspaceId as string),
  );
  const { data, error, isLoading, mutate } = useSWR(
    user && activeWorkspaceId ? ['projects', activeWorkspaceId] : null,
    () => listProjects(activeWorkspaceId as string),
  );

  const projects = data?.projects ?? [];
  const canEdit = workspace ? EDIT_ROLES.includes(workspace.role) : false;
  const canDelete = workspace ? DELETE_ROLES.includes(workspace.role) : false;

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
              Projects
            </h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              Group videos within a workspace into projects.
            </p>
          </div>
          {user && activeWorkspaceId && canEdit && (
            <CreateProjectDialog workspaceId={activeWorkspaceId} onCreated={() => mutate()} />
          )}
        </div>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat project.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {!activeWorkspaceId && (
              <p className="mt-8 font-body text-sm text-muted-foreground">
                Pilih workspace terlebih dahulu (lihat pemilih workspace di navigasi).
              </p>
            )}
            {error && (
              <p className="mt-4 font-body text-sm text-destructive">
                {error instanceof Error ? error.message : 'Gagal memuat project'}
              </p>
            )}

            {activeWorkspaceId && (
              <>
                {isLoading ? null : projects.length === 0 ? (
                  <p className="mt-8 font-body text-sm text-muted-foreground">
                    Belum ada project di workspace ini.
                  </p>
                ) : (
                  <ul className="mt-6 space-y-3">
                    {projects.map((project) => (
                      <li
                        key={project.id}
                        className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted p-4"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-body text-sm font-medium text-foreground">
                            {project.name}
                          </p>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            Dibuat {formatRelativeTime(project.createdAt)}
                          </p>
                        </div>
                        {(canEdit || canDelete) && (
                          <div className="flex shrink-0 items-center gap-1">
                            {canEdit && (
                              <RenameProjectDialog project={project} onRenamed={() => mutate()} />
                            )}
                            {canDelete && (
                              <DeleteProjectDialog project={project} onDeleted={() => mutate()} />
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function CreateProjectDialog({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setError(null);
  }

  async function handleCreate() {
    setError(null);
    setCreating(true);
    try {
      await createProject(workspaceId, name.trim());
      setOpen(false);
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat project');
    } finally {
      setCreating(false);
    }
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
        <Button size="sm">+ Project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama project" />
        {error && <p className="font-body text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button disabled={creating || !name.trim()} onClick={handleCreate}>
            {creating ? 'Membuat...' : 'Buat Project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameProjectDialog({
  project,
  onRenamed,
}: {
  project: { id: string; name: string };
  onRenamed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(project.name);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Project</DialogTitle>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        {error && <p className="font-body text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            disabled={saving || !name.trim() || name.trim() === project.name}
            onClick={async () => {
              setError(null);
              setSaving(true);
              try {
                await updateProject(project.id, name.trim());
                setOpen(false);
                onRenamed();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Gagal mengubah nama project');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProjectDialog({
  project,
  onDeleted,
}: {
  project: { id: string; name: string };
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
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Project</DialogTitle>
        </DialogHeader>
        <p className="font-body text-sm text-muted-foreground">
          Hapus <span className="font-medium text-foreground">&quot;{project.name}&quot;</span>?
          Folder di dalamnya ikut terhapus; video di dalamnya tidak terhapus, hanya dilepas kembali
          ke workspace. Tindakan ini tidak bisa dibatalkan.
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
                await deleteProject(project.id);
                setOpen(false);
                onDeleted();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Gagal menghapus project');
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? 'Menghapus...' : 'Hapus Project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
