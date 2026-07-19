'use client';

import { CampaignStatus } from '@speedora/shared';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { CampaignAnalyticsTab } from '@/components/analytics/CampaignAnalyticsTab';
import { Nav } from '@/components/Nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cancelCampaign, getCampaign } from '@/lib/api';
import { platformIcon, platformLabel } from '@/lib/platform-metadata';
import {
  CAMPAIGN_STATUS_LABELS,
  campaignStatusBadgeVariant,
  PUBLISH_STATUS_LABELS,
} from '@/lib/scheduling';
import { useAuth } from '@/lib/useAuth';

// Phase 6 (Scheduling), Frontend part A - detail view for one Campaign:
// name/description/tag/dates, derived status, progress, and its full
// publish job list (CampaignDetailDto.publishRecords).
export default function CampaignDetailPage({ params }: { params: { id: string } }) {
  const { user, checkingAuth, logout } = useAuth();
  const [cancelling, setCancelling] = useState(false);

  const { data: campaign, error, mutate } = useSWR(
    user ? ['campaign-detail', params.id] : null,
    () => getCampaign(params.id),
  );

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelCampaign(params.id);
      await mutate();
    } finally {
      setCancelling(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/campaigns"
          className="font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          ← Campaigns
        </Link>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk melihat campaign.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {error && (
              <p className="mt-4 font-body text-sm text-destructive">
                {error instanceof Error ? error.message : 'Gagal memuat campaign'}
              </p>
            )}

            {campaign && (
              <>
                <div className="mt-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
                        {campaign.name}
                      </h1>
                      <Badge variant={campaignStatusBadgeVariant(campaign.status)}>
                        {CAMPAIGN_STATUS_LABELS[campaign.status]}
                      </Badge>
                      {campaign.tag && <Badge variant="outline">{campaign.tag}</Badge>}
                    </div>
                    {campaign.description && (
                      <p className="mt-1.5 font-body text-sm text-muted-foreground">
                        {campaign.description}
                      </p>
                    )}
                    <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                      {new Date(campaign.startDate).toLocaleDateString()} –{' '}
                      {new Date(campaign.endDate).toLocaleDateString()}
                    </p>
                  </div>
                  {campaign.status !== CampaignStatus.CANCELLED &&
                    campaign.status !== CampaignStatus.COMPLETED && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={cancelling}
                        onClick={handleCancel}
                        className="shrink-0 text-destructive hover:text-destructive"
                      >
                        {cancelling ? 'Membatalkan...' : 'Cancel Campaign'}
                      </Button>
                    )}
                </div>

                {/* TODO(UI backlog, Stabilization Pass Area 4 Visual QA): fixed grid-cols-3
                    with no mobile breakpoint, unlike this app's other stat grids (see
                    apps/web/components/processing/ProcessingStatus.tsx's matching TODO). */}
                <div className="mt-6 grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-border bg-slate-panel p-4 text-center">
                    <p className="font-display text-xl text-foreground">{campaign.clipCount}</p>
                    <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                      Clips
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-slate-panel p-4 text-center">
                    <p className="font-display text-xl text-foreground">
                      {campaign.platformCount}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                      Platforms
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-slate-panel p-4 text-center">
                    <p className="font-display text-xl text-foreground">
                      {campaign.progress.published}/{campaign.progress.total}
                    </p>
                    <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                      Published{campaign.progress.failed > 0 && ` (${campaign.progress.failed} failed)`}
                    </p>
                  </div>
                </div>

                <Tabs defaultValue="jobs" className="mt-8">
                  <TabsList>
                    <TabsTrigger value="jobs">Publish Jobs</TabsTrigger>
                    <TabsTrigger value="analytics">Analytics</TabsTrigger>
                  </TabsList>

                  <TabsContent value="jobs">
                    {campaign.publishRecords.length === 0 ? (
                      <p className="font-body text-sm text-muted-foreground">
                        Belum ada publish job pada campaign ini.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {campaign.publishRecords.map((record) => {
                          const Icon = platformIcon(record.platform);
                          return (
                            <li
                              key={record.id}
                              className="flex items-center justify-between gap-3 rounded-md border border-border bg-slate-panel p-3"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <Icon
                                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                <span className="font-body text-sm text-foreground">
                                  {platformLabel(record.platform)}
                                </span>
                                <span className="truncate font-mono text-xs text-muted-foreground">
                                  clip {record.clipId}
                                </span>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                {record.status === 'FAILED' && record.errorMessage && (
                                  <span
                                    className="max-w-[16rem] truncate font-mono text-xs text-destructive"
                                    title={record.errorMessage}
                                  >
                                    {record.errorMessage}
                                  </span>
                                )}
                                <span className="font-mono text-xs text-muted-foreground">
                                  {record.publishedAt
                                    ? new Date(record.publishedAt).toLocaleString()
                                    : record.scheduledAt
                                      ? new Date(record.scheduledAt).toLocaleString()
                                      : ''}
                                </span>
                                <Badge variant="outline">{PUBLISH_STATUS_LABELS[record.status]}</Badge>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </TabsContent>

                  <TabsContent value="analytics">
                    <CampaignAnalyticsTab campaignId={params.id} workspaceId={campaign.workspaceId} />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
