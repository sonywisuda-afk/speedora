'use client';

import type { ProjectDto } from '@speedora/shared';
import { Download, Edit, FolderOpen, FolderPlus, Play } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { Button } from '@/components/ui/button';
import { ProjectPickerDialog } from '@/components/dashboard/ProjectPickerDialog';
import { UploadVideoQuickAction } from '@/components/dashboard/UploadVideoQuickAction';
import { listProjects, videoReportCsvUrl, type VideoWithClipsDto } from '@/lib/api';
import { useWorkspaceStore } from '@/lib/workspaceStore';

// Dashboard Improvement Sprint Phase A - rewritten to close the IA gap
// where "Create Project" was a dead alias for "Upload Video" (both linked
// to /upload). Ships 7 of the sprint spec's 9 requested quick actions;
// "Import TikTok URL" and "Generate More Clips" are deliberately omitted
// rather than rendered as dead buttons - no TikTok import exists anywhere
// in this codebase (backend or ImportTabs.tsx), and Generate More Clips is
// an unbuilt Phase C feature. See the Phase A plan for the full rationale.
// "Invite Member" (previously here via WorkspaceMembersDialog) stays
// reachable from Workspace Settings (WorkspaceSwitcher.tsx) - decluttered
// off this row, not removed.
export function QuickActions({ videos }: { videos: VideoWithClipsDto[] }) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [youtubePickerOpen, setYoutubePickerOpen] = useState(false);

  // Same SWR key ProjectPickerDialog/UploadVideoQuickAction's picker uses -
  // shared cache, no duplicate fetch when a picker is opened right after.
  const { data, mutate } = useSWR(
    activeWorkspaceId ? ['workspace-projects', activeWorkspaceId] : null,
    () => listProjects(activeWorkspaceId as string, false),
  );
  const lastProject = useMemo(() => mostRecentProject(data?.projects ?? []), [data]);

  const latestVideoId = videos[0]?.id ?? null;
  const latestEditableVideoId = videos.find((v) => v.clips.length > 0)?.id ?? null;

  return (
    <div className="flex flex-wrap gap-2">
      {activeWorkspaceId && (
        <CreateProjectDialog
          workspaceId={activeWorkspaceId}
          onCreated={() => mutate()}
          triggerLabel="New Project"
        />
      )}

      <UploadVideoQuickAction workspaceId={activeWorkspaceId} />

      <Button
        variant="outline"
        disabled={!activeWorkspaceId}
        onClick={() => setYoutubePickerOpen(true)}
      >
        <Play className="mr-2 h-4 w-4" aria-hidden="true" />
        Import YouTube URL
      </Button>
      {activeWorkspaceId && (
        <ProjectPickerDialog
          workspaceId={activeWorkspaceId}
          mode="youtube"
          open={youtubePickerOpen}
          onOpenChange={setYoutubePickerOpen}
        />
      )}

      <Button variant="outline" asChild>
        <Link href="/projects">
          <FolderPlus className="mr-2 h-4 w-4" aria-hidden="true" />
          Recent Projects
        </Link>
      </Button>

      <Button variant="outline" disabled={!lastProject} asChild={!!lastProject}>
        {lastProject ? (
          <Link href={`/projects?highlight=${lastProject.id}`}>
            <FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" />
            Open Last Project
          </Link>
        ) : (
          <>
            <FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" />
            Open Last Project
          </>
        )}
      </Button>

      <Button variant="outline" disabled={!latestEditableVideoId} asChild={!!latestEditableVideoId}>
        {latestEditableVideoId ? (
          <Link href={`/videos/${latestEditableVideoId}/edit`}>
            <Edit className="mr-2 h-4 w-4" aria-hidden="true" />
            Continue Editing
          </Link>
        ) : (
          <>
            <Edit className="mr-2 h-4 w-4" aria-hidden="true" />
            Continue Editing
          </>
        )}
      </Button>

      <Button variant="outline" disabled={!latestVideoId} asChild={!!latestVideoId}>
        {latestVideoId ? (
          <a href={videoReportCsvUrl(latestVideoId)}>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Export Latest Report
          </a>
        ) : (
          <>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Export Latest Report
          </>
        )}
      </Button>
    </div>
  );
}

function mostRecentProject(projects: ProjectDto[]): ProjectDto | null {
  if (projects.length === 0) return null;
  return projects.reduce((latest, p) =>
    new Date(p.updatedAt).getTime() > new Date(latest.updatedAt).getTime() ? p : latest,
  );
}
