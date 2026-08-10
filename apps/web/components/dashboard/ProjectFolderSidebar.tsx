'use client';

import type { FolderDto, ProjectDto } from '@speedora/shared';
import { useState } from 'react';
import useSWR from 'swr';
import { createFolder, deleteFolder, listFolders, listProjects, updateFolder } from '@/lib/api';
import { cn } from '@/lib/utils';

// Collaboration roadmap follow-up (2026-08-10) - the Folder CRUD API
// (Sprint 5A) had zero frontend consumers until now (see
// project_collaboration_roadmap.md). Scope resolved via AskUserQuestion:
// read-only tree navigation (click a Project/Folder to filter Dashboard's
// video list) plus basic inline create/rename/delete - NOT drag-and-drop
// video reassignment (moveVideo() already exists elsewhere for that, e.g.
// ProjectPickerDialog's upload-time flow; a drag target here is a separate,
// bigger follow-up if ever wanted).
export interface FolderSelection {
  projectId: string | null;
  folderId: string | null;
}

interface FolderNode extends FolderDto {
  children: FolderNode[];
}

// listFolders() returns a flat, unordered-by-hierarchy list (server-side,
// no tree assembly - see api.ts's own comment) - this is the client-side
// assembly step, using parentId same as any other adjacency-list tree.
// A folder whose parentId points at an id not in this project's own list
// (shouldn't happen given Folder.parentId is FK'd within the same project,
// but defensive) is treated as a root rather than silently dropped.
function buildFolderTree(folders: FolderDto[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>();
  for (const folder of folders) nodes.set(folder.id, { ...folder, children: [] });
  const roots: FolderNode[] = [];
  for (const folder of folders) {
    const node = nodes.get(folder.id);
    if (!node) continue;
    const parent = folder.parentId ? nodes.get(folder.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

const rowClassName = (active: boolean) =>
  cn(
    'flex w-full items-center gap-1 rounded-md px-2 py-1 text-left font-body text-sm',
    active ? 'bg-primary-surface text-primary' : 'text-foreground hover:bg-accent',
  );

function FolderRow({
  node,
  depth,
  projectId,
  selection,
  onSelect,
  onChanged,
}: {
  node: FolderNode;
  depth: number;
  projectId: string;
  selection: FolderSelection;
  onSelect: (selection: FolderSelection) => void;
  onChanged: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(node.name);
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = selection.folderId === node.id;

  async function submitRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === node.name) {
      setRenaming(false);
      setName(node.name);
      return;
    }
    setBusy(true);
    try {
      await updateFolder(node.id, { name: trimmed });
      setRenaming(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function submitCreateChild() {
    const trimmed = childName.trim();
    if (!trimmed) {
      setAddingChild(false);
      return;
    }
    setBusy(true);
    try {
      await createFolder(projectId, { name: trimmed, parentId: node.id });
      setChildName('');
      setAddingChild(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete() {
    setBusy(true);
    try {
      await deleteFolder(node.id);
      if (selection.folderId === node.id) onSelect({ projectId, folderId: null });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="group flex items-center" style={{ paddingLeft: depth * 14 }}>
        {renaming ? (
          <input
            autoFocus
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') {
                setRenaming(false);
                setName(node.name);
              }
            }}
            className="h-7 flex-1 rounded border border-input bg-background px-1.5 font-body text-sm text-foreground"
          />
        ) : (
          <button
            onClick={() => onSelect({ projectId, folderId: node.id })}
            className={rowClassName(active)}
            title={node.name}
          >
            <span className="truncate">📁 {node.name}</span>
          </button>
        )}
        {!renaming && (
          <div className="hidden shrink-0 gap-0.5 group-hover:flex">
            <button
              onClick={() => setAddingChild(true)}
              title="Sub-folder baru"
              className="rounded px-1 font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              +
            </button>
            <button
              onClick={() => setRenaming(true)}
              title="Ganti nama"
              className="rounded px-1 font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              ✎
            </button>
            {confirmingDelete ? (
              <button
                onClick={submitDelete}
                disabled={busy}
                title="Konfirmasi hapus"
                className="rounded px-1 font-mono text-xs text-destructive"
              >
                Yakin?
              </button>
            ) : (
              <button
                onClick={() => setConfirmingDelete(true)}
                title="Hapus folder"
                className="rounded px-1 font-mono text-xs text-muted-foreground hover:text-destructive"
              >
                🗑
              </button>
            )}
          </div>
        )}
      </div>

      {addingChild && (
        <div className="flex items-center gap-1" style={{ paddingLeft: (depth + 1) * 14 }}>
          <input
            autoFocus
            value={childName}
            disabled={busy}
            placeholder="Nama sub-folder"
            onChange={(e) => setChildName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreateChild();
              if (e.key === 'Escape') setAddingChild(false);
            }}
            onBlur={() => {
              if (!childName.trim()) setAddingChild(false);
            }}
            className="h-7 flex-1 rounded border border-input bg-background px-1.5 font-body text-sm text-foreground"
          />
        </div>
      )}

      {node.children.map((child) => (
        <FolderRow
          key={child.id}
          node={child}
          depth={depth + 1}
          projectId={projectId}
          selection={selection}
          onSelect={onSelect}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function ProjectNode({
  project,
  expanded,
  onToggleExpand,
  selection,
  onSelect,
}: {
  project: ProjectDto;
  expanded: boolean;
  onToggleExpand: () => void;
  selection: FolderSelection;
  onSelect: (selection: FolderSelection) => void;
}) {
  const [addingRoot, setAddingRoot] = useState(false);
  const [rootName, setRootName] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, mutate } = useSWR(expanded ? ['sidebar-folders', project.id] : null, () =>
    listFolders(project.id),
  );
  const tree = buildFolderTree(data?.folders ?? []);
  const active = selection.projectId === project.id && !selection.folderId;

  async function submitCreateRoot() {
    const trimmed = rootName.trim();
    if (!trimmed) {
      setAddingRoot(false);
      return;
    }
    setBusy(true);
    try {
      await createFolder(project.id, { name: trimmed });
      setRootName('');
      setAddingRoot(false);
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="group flex items-center">
        <button
          onClick={onToggleExpand}
          className="w-4 shrink-0 font-mono text-xs text-muted-foreground"
          title={expanded ? 'Tutup' : 'Buka'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button
          onClick={() => onSelect({ projectId: project.id, folderId: null })}
          className={rowClassName(active)}
          title={project.name}
        >
          <span className="truncate">{project.name}</span>
        </button>
        <button
          onClick={() => {
            if (!expanded) onToggleExpand();
            setAddingRoot(true);
          }}
          title="Folder baru"
          className="hidden shrink-0 rounded px-1 font-mono text-xs text-muted-foreground hover:text-foreground group-hover:block"
        >
          +
        </button>
      </div>

      {expanded && (
        <div>
          {tree.map((node) => (
            <FolderRow
              key={node.id}
              node={node}
              depth={1}
              projectId={project.id}
              selection={selection}
              onSelect={onSelect}
              onChanged={() => mutate()}
            />
          ))}
          {addingRoot && (
            <div className="flex items-center gap-1" style={{ paddingLeft: 14 }}>
              <input
                autoFocus
                value={rootName}
                disabled={busy}
                placeholder="Nama folder"
                onChange={(e) => setRootName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreateRoot();
                  if (e.key === 'Escape') setAddingRoot(false);
                }}
                onBlur={() => {
                  if (!rootName.trim()) setAddingRoot(false);
                }}
                className="h-7 flex-1 rounded border border-input bg-background px-1.5 font-body text-sm text-foreground"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ProjectFolderSidebar({
  workspaceId,
  selection,
  onSelect,
}: {
  workspaceId: string | null;
  selection: FolderSelection;
  onSelect: (selection: FolderSelection) => void;
}) {
  const { data } = useSWR(workspaceId ? ['sidebar-projects', workspaceId] : null, () =>
    listProjects(workspaceId as string, false),
  );
  const projects = data?.projects ?? [];
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);

  if (!workspaceId) return null;

  return (
    <nav className="w-56 shrink-0 space-y-0.5" aria-label="Navigasi Project dan Folder">
      <button
        onClick={() => onSelect({ projectId: null, folderId: null })}
        className={rowClassName(!selection.projectId && !selection.folderId)}
      >
        Semua Video
      </button>
      {projects.map((project) => (
        <ProjectNode
          key={project.id}
          project={project}
          expanded={expandedProjectId === project.id}
          onToggleExpand={() =>
            setExpandedProjectId(expandedProjectId === project.id ? null : project.id)
          }
          selection={selection}
          onSelect={onSelect}
        />
      ))}
      {projects.length === 0 && (
        <p className="px-2 py-1 font-body text-xs text-muted-foreground">Belum ada project.</p>
      )}
    </nav>
  );
}
