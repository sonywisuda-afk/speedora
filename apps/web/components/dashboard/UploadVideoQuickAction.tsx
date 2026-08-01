'use client';

import { UploadCloud } from 'lucide-react';
import { useState } from 'react';
import { ProjectPickerDialog } from '@/components/dashboard/ProjectPickerDialog';
import { Button, type ButtonProps } from '@/components/ui/button';

// Dashboard Improvement Sprint Phase A - the single place the "gate Upload
// Video behind a project picker" behavior lives, so QuickActions and
// DashboardClient's "Belum Ada Video" empty-state CTA (previously a plain
// `<Link href="/upload">`) share one implementation instead of the gating
// logic existing twice. See the Phase A plan's decision #3 (only these two
// Dashboard entry points are gated - every other pre-existing /upload link
// elsewhere in the app is untouched).
export function UploadVideoQuickAction({
  workspaceId,
  label = 'Upload Video',
  size = 'default',
  className,
  showIcon = true,
}: {
  workspaceId: string | null;
  label?: string;
  size?: ButtonProps['size'];
  className?: string;
  showIcon?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size={size} className={className} disabled={!workspaceId} onClick={() => setOpen(true)}>
        {showIcon && <UploadCloud className="mr-2 h-4 w-4" aria-hidden="true" />}
        {label}
      </Button>
      {workspaceId && (
        <ProjectPickerDialog workspaceId={workspaceId} mode="file" open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}
