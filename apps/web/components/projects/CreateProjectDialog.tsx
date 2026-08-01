'use client';

import { useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createProject } from '@/lib/api';

// Dashboard Improvement Sprint Phase A - extracted out of
// app/projects/page.tsx (previously a private, unexported component there)
// so the Dashboard's "New Project" quick action and ProjectPickerDialog's
// inline empty-state creation can reuse the exact same name-only create
// flow instead of a second copy. Project only has a `name` field today (no
// description/tags) - see the Phase A plan for why that's intentional, not
// an oversight.
export function CreateProjectDialog({
  workspaceId,
  onCreated,
  triggerLabel = '+ Project',
  triggerVariant = 'default',
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideTrigger = false,
}: {
  workspaceId: string;
  onCreated: (project: { id: string; name: string }) => void;
  triggerLabel?: string;
  triggerVariant?: ButtonProps['variant'];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = controlledOnOpenChange ?? setUncontrolledOpen;
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
      const project = await createProject(workspaceId, name.trim());
      setOpen(false);
      reset();
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat project');
    } finally {
      setCreating(false);
    }
  }

  const nameField = (
    <>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nama project"
        aria-label="Nama project"
        maxLength={80}
      />
      {error && <p className="font-body text-xs text-destructive">{error}</p>}
    </>
  );

  // hideTrigger lets a caller (ProjectPickerDialog's empty state) render
  // this form inline in its own dialog body instead of nesting a
  // dialog-within-a-dialog.
  if (hideTrigger) {
    return (
      <div className="space-y-3">
        {nameField}
        <Button disabled={creating || !name.trim()} onClick={handleCreate} className="w-full">
          {creating ? 'Membuat...' : 'Buat Project'}
        </Button>
      </div>
    );
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
        <Button size="sm" variant={triggerVariant}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>
        {nameField}
        <DialogFooter>
          <Button disabled={creating || !name.trim()} onClick={handleCreate}>
            {creating ? 'Membuat...' : 'Buat Project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
