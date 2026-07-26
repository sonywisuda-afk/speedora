'use client';

import { useState } from 'react';
import { createCampaign } from '@/lib/api';
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

// Phase 6 (Scheduling) - Campaign creation only takes name/description/tag/
// dates (see CampaignDto's comment for the deliberately excluded budget/KPI/
// ROI fields). Status/clipCount/platformCount/progress are all derived
// server-side once jobs are queued against it, so there's nothing else to
// ask for here.
export function CreateCampaignDialog({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tag, setTag] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setDescription('');
    setTag('');
    setStartDate('');
    setEndDate('');
    setError(null);
  }

  async function handleCreate() {
    setError(null);
    setCreating(true);
    try {
      await createCampaign(workspaceId, {
        name,
        description: description || undefined,
        tag: tag || undefined,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
      });
      setOpen(false);
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat campaign');
    } finally {
      setCreating(false);
    }
  }

  const canSubmit = name.trim() && startDate && endDate;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">+ Campaign</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Launch Week"
            />
          </div>
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Description (optional)
            </label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Tag (optional)
            </label>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="q3-launch" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Start Date
              </label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="flex-1 space-y-1.5">
              <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                End Date
              </label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          {error && <p className="font-body text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button disabled={creating || !canSubmit} onClick={handleCreate}>
            {creating ? 'Membuat...' : 'Buat Campaign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
