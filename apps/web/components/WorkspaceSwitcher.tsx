'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { createWorkspace, listWorkspaces } from '@/lib/api';
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

// Sprint 5A (Collaboration Foundation) - mounted once in Nav.tsx, same
// "mount once, reach every page" precedent as NotificationBell. Selecting a
// workspace here only updates the local store (see workspaceStore.ts) -
// pages that read videos scope themselves via that store's
// activeWorkspaceId, defaulting server-side to the user's personal
// workspace whenever it's null, so a user who never opens this switcher
// sees zero behavior change.
export function WorkspaceSwitcher() {
  const { data } = useSWR('workspaces', listWorkspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const workspaces = data?.workspaces ?? [];

  // Seed the selection once workspaces load, if nothing is selected yet (or
  // the previously-selected id no longer exists, e.g. after being removed
  // from a workspace) - falls back to the personal workspace.
  useEffect(() => {
    if (workspaces.length === 0) return;
    const stillValid = workspaces.some((w) => w.id === activeWorkspaceId);
    if (activeWorkspaceId && stillValid) return;
    const personal = workspaces.find((w) => w.isPersonal) ?? workspaces[0];
    setActiveWorkspaceId(personal.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces.map((w) => w.id).join(','), activeWorkspaceId]);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const workspace = await createWorkspace(name.trim());
      setActiveWorkspaceId(workspace.id);
      setName('');
      setCreateOpen(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Only shown once a user actually has more than one workspace - no
          switcher chrome for the common case (personal workspace only),
          matching the "invisible unless used" posture the whole roadmap
          called for. */}
      {workspaces.length > 1 && (
        <select
          value={activeWorkspaceId ?? ''}
          onChange={(e) => setActiveWorkspaceId(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 font-body text-xs text-foreground"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.isPersonal ? 'Personal' : w.name}
            </option>
          ))}
        </select>
      )}
      {activeWorkspaceId && (
        // Workspace Lifecycle Management roadmap - the entry point to the
        // new /workspaces/[id] Settings page (General/Members/Audit
        // Log/Danger Zone), scoped to whichever workspace is currently
        // active in this switcher.
        <Link
          href={`/workspaces/${activeWorkspaceId}`}
          className="whitespace-nowrap rounded-md px-2 py-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          title="Workspace Settings"
        >
          Settings
        </Link>
      )}
      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next) setName('');
        }}
      >
        <DialogTrigger asChild>
          <button
            className="whitespace-nowrap rounded-md px-2 py-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            title="New workspace"
          >
            + Workspace
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Workspace</DialogTitle>
          </DialogHeader>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama workspace"
          />
          <DialogFooter>
            <Button disabled={creating || !name.trim()} onClick={handleCreate}>
              {creating ? 'Membuat...' : 'Buat Workspace'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
