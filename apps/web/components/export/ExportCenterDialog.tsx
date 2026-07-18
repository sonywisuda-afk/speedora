'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { listExportJobs } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BrandKitTab } from './BrandKitTab';
import { QuickDownloadsTab } from './QuickDownloadsTab';
import { ReportsTab } from './ReportsTab';

// Sprint 03e (Export Center roadmap) - the whole frontend for the backend
// this roadmap shipped across 03a-03d. Self-contained trigger + Dialog +
// its own open state, same shape as InviteMemberDialog - the edit page just
// renders <ExportCenterDialog videoId={...} /> (via the same next/dynamic(
// ssr:false) code-splitting QuickActions.tsx already does for that dialog).
export function ExportCenterDialog({ videoId }: { videoId: string }) {
  const [open, setOpen] = useState(false);

  // Recent Exports / Persistent Export History - fetched once, at the
  // dialog level, exactly when the dialog opens (not deferred to whichever
  // tab happens to be active first). Still entirely inside this already
  // code-split dynamic import - never runs until a user has opened the
  // (lazily loaded) dialog, so this doesn't grow the edit page's initial
  // bundle/fetch footprint.
  const { data: jobList } = useSWR(open ? ['export-jobs', videoId] : null, () =>
    listExportJobs({ videoId }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Export</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export Center</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="quick">
          <TabsList>
            <TabsTrigger value="quick">Unduh Cepat</TabsTrigger>
            <TabsTrigger value="reports">Laporan</TabsTrigger>
            <TabsTrigger value="brand">Brand Kit</TabsTrigger>
          </TabsList>
          <TabsContent value="quick">
            <QuickDownloadsTab videoId={videoId} />
          </TabsContent>
          <TabsContent value="reports">
            <ReportsTab videoId={videoId} jobs={jobList?.jobs ?? []} />
          </TabsContent>
          <TabsContent value="brand">
            <BrandKitTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
