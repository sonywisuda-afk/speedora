'use client';

import { WorkspaceRole } from '@speedora/shared';
import type { ProjectBulkActionResultDto, ProjectDto } from '@speedora/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Nav } from '@/components/Nav';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
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
import {
  archiveProject,
  bulkArchiveProjects,
  bulkDeleteProjects,
  bulkMoveProjects,
  bulkUnarchiveProjects,
  deleteProject,
  getWorkspace,
  listProjects,
  listWorkspaces,
  moveProject,
  unarchiveProject,
  updateProject,
} from '@/lib/api';
import { formatRelativeTime } from '@/lib/dashboard';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';
import { useWorkspaceStore } from '@/lib/workspaceStore';

const EDIT_ROLES: WorkspaceRole[] = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
  WorkspaceRole.EDITOR,
];
const DELETE_ROLES: WorkspaceRole[] = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN];
// Move roadmap - same ADMIN+ bar as delete (a cross-workspace boundary
// change, requiring ADMIN+ on the target workspace too - enforced
// server-side, see ProjectService.move).
const MOVE_ROLES = DELETE_ROLES;

type Tab = 'active' | 'archived';

// Project Management UI - ProjectService (apps/api/src/workspace/project.service.ts,
// Sprint 5A) has always had full create/list/rename/delete, but apps/web never
// called it - a Project could only ever be created via a direct API call, and
// never renamed or deleted at all. This closes that gap with the minimum
// surface: a flat /projects route (same "reads activeWorkspaceId from the
// store" convention as /campaigns), a create dialog, and per-row
// rename/delete. Archive roadmap (P1) adds an Active/Archived tab plus
// archive/restore, sitting alongside the permanent (ADMIN+) delete rather
// than replacing it. Role buttons are hidden client-side per EDIT_ROLES/
// DELETE_ROLES purely for UX - WorkspaceAccessService.assertMinRole is the
// real enforcement. Archive/restore are one-click (no confirm dialog) since
// they're fully reversible; only permanent delete gets a confirm dialog.
// Move roadmap adds a Move dialog (ADMIN+ on both workspaces, project must
// have zero videos - see ProjectService.move for why) picking a target from
// listWorkspaces(), reusing the same Dialog pattern as Create/Rename.
// Bulk Actions roadmap adds a checkbox per row plus a selection toolbar
// (Archive/Restore/Move/Delete on the whole selection at once) - each bulk
// call is partial-success (see ProjectBulkActionResultDto), so
// `bulkResult`'s failed list is rendered even though the request itself
// didn't throw.
export default function ProjectsPage() {
  const { user, checkingAuth, logout } = useAuth();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  // Dashboard Improvement Sprint Phase A - "Open Last Project" deep-links
  // here as /projects?highlight=<id> instead of a new per-project page (see
  // the Phase A plan for why). Read directly off window.location rather
  // than next/navigation's useSearchParams() - same convention as
  // social/page.tsx's readRedirectParams(), avoids the Suspense-boundary
  // requirement for reading one query param once.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    setHighlightId(new URLSearchParams(window.location.search).get('highlight'));
  }, []);
  const [tab, setTab] = useState<Tab>('active');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = useState<{
    succeededCount: number;
    failed: { name: string; reason: string }[];
  } | null>(null);

  const { data: workspace } = useSWR(
    user && activeWorkspaceId ? ['workspace-detail', activeWorkspaceId] : null,
    () => getWorkspace(activeWorkspaceId as string),
  );
  // Fetch active + archived together (includeArchived:true) so switching
  // tabs is instant and both tabs share one mutate() after any action.
  const { data, error, isLoading, mutate } = useSWR(
    user && activeWorkspaceId ? ['projects', activeWorkspaceId] : null,
    () => listProjects(activeWorkspaceId as string, true),
  );

  const allProjects = data?.projects ?? [];
  const projects = allProjects.filter((p) => (tab === 'active' ? !p.archivedAt : !!p.archivedAt));
  const archivedCount = allProjects.filter((p) => p.archivedAt).length;
  const canEdit = workspace ? EDIT_ROLES.includes(workspace.role) : false;
  const canDelete = workspace ? DELETE_ROLES.includes(workspace.role) : false;
  const canMove = workspace ? MOVE_ROLES.includes(workspace.role) : false;
  const canSelect = canEdit || canDelete || canMove;
  const allVisibleSelected = projects.length > 0 && projects.every((p) => selected.has(p.id));

  function handleTabChange(next: Tab) {
    setTab(next);
    setSelected(new Set());
    setBulkResult(null);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        projects.forEach((p) => next.delete(p.id));
      } else {
        projects.forEach((p) => next.add(p.id));
      }
      return next;
    });
  }

  function applyBulkResult(result: ProjectBulkActionResultDto) {
    const nameById = new Map(allProjects.map((p) => [p.id, p.name]));
    setBulkResult({
      succeededCount: result.succeeded.length,
      failed: result.failed.map((f) => ({ name: nameById.get(f.id) ?? f.id, reason: f.reason })),
    });
    setSelected(new Set());
    mutate();
  }

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
            <CreateProjectDialog
              workspaceId={activeWorkspaceId}
              onCreated={() => mutate()}
              triggerLabel="+ Project"
            />
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
                <div className="mt-6 flex gap-1">
                  {(['active', 'archived'] as Tab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleTabChange(t)}
                      aria-current={tab === t ? 'true' : undefined}
                      className={cn(
                        'rounded-md px-3 py-1.5 font-mono text-xs transition-colors',
                        tab === t
                          ? 'bg-primary-surface font-medium text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      {t === 'active'
                        ? 'Active'
                        : `Archived${archivedCount ? ` (${archivedCount})` : ''}`}
                    </button>
                  ))}
                </div>

                {bulkResult && (
                  <div className="mt-4 rounded-md border border-border bg-muted p-3 font-body text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-foreground">
                        {bulkResult.succeededCount} project berhasil diproses
                        {bulkResult.failed.length > 0 && `, ${bulkResult.failed.length} gagal`}.
                      </p>
                      <button
                        type="button"
                        onClick={() => setBulkResult(null)}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        Tutup
                      </button>
                    </div>
                    {bulkResult.failed.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-destructive">
                        {bulkResult.failed.map((f, i) => (
                          <li key={i}>
                            {f.name}: {f.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {canSelect && projects.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 font-body text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        className="h-3.5 w-3.5"
                      />
                      Pilih semua
                    </label>
                    {selected.size > 0 && (
                      <BulkActionBar
                        tab={tab}
                        selectedIds={Array.from(selected)}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        canMove={canMove}
                        onDone={applyBulkResult}
                        onClear={() => setSelected(new Set())}
                      />
                    )}
                  </div>
                )}

                {isLoading ? null : projects.length === 0 ? (
                  <p className="mt-8 font-body text-sm text-muted-foreground">
                    {tab === 'active'
                      ? 'Belum ada project aktif di workspace ini.'
                      : 'Belum ada project yang diarsipkan.'}
                  </p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {projects.map((project) => (
                      <ProjectRow
                        key={project.id}
                        project={project}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        canMove={canMove}
                        canSelect={canSelect}
                        selected={selected.has(project.id)}
                        highlighted={project.id === highlightId}
                        onToggleSelected={() => toggleSelected(project.id)}
                        onChanged={() => mutate()}
                      />
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

function ProjectRow({
  project,
  canEdit,
  canDelete,
  canMove,
  canSelect,
  selected,
  highlighted = false,
  onToggleSelected,
  onChanged,
}: {
  project: ProjectDto;
  canEdit: boolean;
  canDelete: boolean;
  canMove: boolean;
  canSelect: boolean;
  selected: boolean;
  highlighted?: boolean;
  onToggleSelected: () => void;
  onChanged: () => void;
}) {
  const archived = !!project.archivedAt;
  const [toggling, setToggling] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const [showHighlight, setShowHighlight] = useState(highlighted);

  useEffect(() => {
    if (!highlighted) return;
    rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(() => setShowHighlight(false), 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToggleArchive() {
    setToggling(true);
    try {
      if (archived) {
        await unarchiveProject(project.id);
      } else {
        await archiveProject(project.id);
      }
      onChanged();
    } finally {
      setToggling(false);
    }
  }

  return (
    <li
      ref={rowRef}
      className={cn(
        'flex items-center justify-between gap-4 rounded-lg border border-border bg-muted p-4 transition-colors duration-500',
        showHighlight && 'border-primary ring-2 ring-primary',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {canSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            className="h-3.5 w-3.5 shrink-0"
            aria-label={`Pilih ${project.name}`}
          />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-body text-sm font-medium text-foreground">{project.name}</p>
            {archived && <Badge variant="muted">Archived</Badge>}
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {archived
              ? `Diarsipkan ${formatRelativeTime(project.archivedAt as string)}`
              : `Dibuat ${formatRelativeTime(project.createdAt)}`}
          </p>
        </div>
      </div>
      {(canEdit || canDelete || canMove) && (
        <div className="flex shrink-0 items-center gap-1">
          {canEdit && !archived && <RenameProjectDialog project={project} onRenamed={onChanged} />}
          {canEdit && (
            <Button size="sm" variant="outline" disabled={toggling} onClick={handleToggleArchive}>
              {toggling ? '...' : archived ? 'Restore' : 'Archive'}
            </Button>
          )}
          {canMove && <MoveProjectDialog project={project} onMoved={onChanged} />}
          {canDelete && <DeleteProjectDialog project={project} onDeleted={onChanged} />}
        </div>
      )}
    </li>
  );
}

function BulkActionBar({
  tab,
  selectedIds,
  canEdit,
  canDelete,
  canMove,
  onDone,
  onClear,
}: {
  tab: Tab;
  selectedIds: string[];
  canEdit: boolean;
  canDelete: boolean;
  canMove: boolean;
  onDone: (result: ProjectBulkActionResultDto) => void;
  onClear: () => void;
}) {
  const [archiving, setArchiving] = useState(false);

  async function handleToggleArchive() {
    setArchiving(true);
    try {
      const result =
        tab === 'active'
          ? await bulkArchiveProjects(selectedIds)
          : await bulkUnarchiveProjects(selectedIds);
      onDone(result);
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-primary-surface px-3 py-1.5">
      <span className="font-mono text-xs font-medium text-primary">
        {selectedIds.length} dipilih
      </span>
      {canEdit && (
        <Button size="sm" variant="outline" disabled={archiving} onClick={handleToggleArchive}>
          {archiving ? '...' : tab === 'active' ? 'Archive' : 'Restore'}
        </Button>
      )}
      {canMove && <BulkMoveDialog selectedIds={selectedIds} onMoved={onDone} />}
      {canDelete && <BulkDeleteDialog selectedIds={selectedIds} onDeleted={onDone} />}
      <button
        type="button"
        onClick={onClear}
        className="font-body text-xs text-muted-foreground underline hover:text-foreground"
      >
        Batalkan
      </button>
    </div>
  );
}

function BulkMoveDialog({
  selectedIds,
  onMoved,
}: {
  selectedIds: string[];
  onMoved: (result: ProjectBulkActionResultDto) => void;
}) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [open, setOpen] = useState(false);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('');
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useSWR(open ? 'workspaces' : null, listWorkspaces);
  const targets = (data?.workspaces ?? []).filter(
    (w) => w.id !== activeWorkspaceId && MOVE_ROLES.includes(w.role),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTargetWorkspaceId('');
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Move
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {selectedIds.length} Project</DialogTitle>
        </DialogHeader>
        <p className="font-body text-sm text-muted-foreground">
          Pindahkan {selectedIds.length} project terpilih ke workspace lain. Hanya project tanpa
          video yang bisa dipindahkan - sisanya akan dilaporkan gagal.
        </p>
        {targets.length === 0 ? (
          <p className="font-body text-xs text-muted-foreground">
            Tidak ada workspace tujuan yang tersedia (butuh peran Admin/Owner di workspace
            tersebut).
          </p>
        ) : (
          <select
            value={targetWorkspaceId}
            onChange={(e) => setTargetWorkspaceId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 font-body text-sm text-foreground"
          >
            <option value="" disabled>
              Pilih workspace tujuan
            </option>
            {targets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.isPersonal ? 'Personal' : w.name}
              </option>
            ))}
          </select>
        )}
        {error && <p className="font-body text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            disabled={moving || !targetWorkspaceId}
            onClick={async () => {
              setError(null);
              setMoving(true);
              try {
                const result = await bulkMoveProjects(selectedIds, targetWorkspaceId);
                setOpen(false);
                onMoved(result);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Gagal memindahkan project');
              } finally {
                setMoving(false);
              }
            }}
          >
            {moving ? 'Memindahkan...' : 'Move Project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkDeleteDialog({
  selectedIds,
  onDeleted,
}: {
  selectedIds: string[];
  onDeleted: (result: ProjectBulkActionResultDto) => void;
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
          <DialogTitle>Delete {selectedIds.length} Project</DialogTitle>
        </DialogHeader>
        <p className="font-body text-sm text-muted-foreground">
          Hapus {selectedIds.length} project terpilih? Folder di dalamnya ikut terhapus; video di
          dalamnya tidak terhapus, hanya dilepas kembali ke workspace. Tindakan ini tidak bisa
          dibatalkan.
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
                const result = await bulkDeleteProjects(selectedIds);
                setOpen(false);
                onDeleted(result);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Gagal menghapus project');
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? 'Menghapus...' : `Hapus ${selectedIds.length} Project`}
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

function MoveProjectDialog({
  project,
  onMoved,
}: {
  project: { id: string; workspaceId: string; name: string };
  onMoved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('');
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useSWR(open ? 'workspaces' : null, listWorkspaces);
  // Target needs ADMIN+ too (enforced server-side) - filtering the option
  // list here is UX only, same posture as EDIT_ROLES/DELETE_ROLES above.
  const targets = (data?.workspaces ?? []).filter(
    (w) => w.id !== project.workspaceId && MOVE_ROLES.includes(w.role),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTargetWorkspaceId('');
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Move
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move Project</DialogTitle>
        </DialogHeader>
        <p className="font-body text-sm text-muted-foreground">
          Pindahkan <span className="font-medium text-foreground">&quot;{project.name}&quot;</span>{' '}
          ke workspace lain. Hanya project tanpa video yang bisa dipindahkan.
        </p>
        {targets.length === 0 ? (
          <p className="font-body text-xs text-muted-foreground">
            Tidak ada workspace tujuan yang tersedia (butuh peran Admin/Owner di workspace
            tersebut).
          </p>
        ) : (
          <select
            value={targetWorkspaceId}
            onChange={(e) => setTargetWorkspaceId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 font-body text-sm text-foreground"
          >
            <option value="" disabled>
              Pilih workspace tujuan
            </option>
            {targets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.isPersonal ? 'Personal' : w.name}
              </option>
            ))}
          </select>
        )}
        {error && <p className="font-body text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            disabled={moving || !targetWorkspaceId}
            onClick={async () => {
              setError(null);
              setMoving(true);
              try {
                await moveProject(project.id, targetWorkspaceId);
                setOpen(false);
                onMoved();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Gagal memindahkan project');
              } finally {
                setMoving(false);
              }
            }}
          >
            {moving ? 'Memindahkan...' : 'Move Project'}
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
