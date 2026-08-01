'use client';

import type { ProjectDto } from '@speedora/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { listProjects } from '@/lib/api';

export type ProjectPickerMode = 'file' | 'youtube';

// Dashboard Improvement Sprint Phase A - gates the Dashboard's "Upload
// Video"/"Import YouTube URL" quick actions behind picking (or creating) a
// project first, so a video always lands attached to one instead of the
// Dashboard's old "Create Project" button silently doing the same thing as
// "Upload Video" (see the Phase A plan). Confirming navigates to
// /upload?projectId=<id>[&import=youtube]; /upload calls moveVideo() after
// the upload/import succeeds - this dialog never talks to the video
// endpoints directly.
export function ProjectPickerDialog({
  workspaceId,
  mode,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  mode: ProjectPickerMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);

  // Same SWR key QuickActions itself uses for its own project list (see
  // QuickActions.tsx) - deliberately shared so opening this dialog doesn't
  // trigger a second, duplicate fetch.
  const { data, isLoading } = useSWR(
    open ? ['workspace-projects', workspaceId] : null,
    () => listProjects(workspaceId, false),
  );
  const projects = data?.projects ?? [];

  function proceed(projectId: string) {
    onOpenChange(false);
    const importParam = mode === 'youtube' ? '&import=youtube' : '';
    router.push(`/upload?projectId=${projectId}${importParam}`);
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setSelectedId('');
      setCreating(false);
    }
  }

  const title = mode === 'youtube' ? 'Import YouTube URL' : 'Upload Video';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="font-body text-sm text-muted-foreground">Memuat project...</p>
        ) : projects.length === 0 || creating ? (
          <div className="space-y-3">
            {projects.length === 0 && !creating && (
              <p className="font-body text-sm text-muted-foreground">
                You don&apos;t have any project yet.
              </p>
            )}
            <CreateProjectDialog
              workspaceId={workspaceId}
              hideTrigger
              onCreated={(project) => proceed(project.id)}
            />
            {/* Only reachable (not the forced empty-state path) when there
                was already a project list to go back to - closing the whole
                dialog just to cancel out of "+ New Project" would be a dead
                end otherwise. */}
            {projects.length > 0 && creating && (
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="font-body text-xs text-muted-foreground underline hover:text-foreground"
              >
                Batal, pilih project yang sudah ada
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="font-body text-sm text-muted-foreground">
              Pilih project untuk video ini.
            </p>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              aria-label="Pilih project"
              className="h-10 w-full rounded-md border border-input bg-background px-3 font-body text-sm text-foreground"
            >
              <option value="" disabled>
                Pilih project
              </option>
              {projects.map((project: ProjectDto) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                + New Project
              </Button>
              <Button disabled={!selectedId} onClick={() => proceed(selectedId)}>
                Continue to Upload
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
