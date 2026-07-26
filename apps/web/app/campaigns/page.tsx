'use client';

import { CampaignStatus } from '@speedora/shared';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Nav } from '@/components/Nav';
import { CreateCampaignDialog } from '@/components/scheduling/CreateCampaignDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cancelCampaign, listCampaigns } from '@/lib/api';
import { CAMPAIGN_STATUS_LABELS, campaignStatusBadgeVariant } from '@/lib/scheduling';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';
import { useWorkspaceStore } from '@/lib/workspaceStore';

const STATUS_FILTERS: Array<CampaignStatus | 'ALL'> = [
  'ALL',
  CampaignStatus.DRAFT,
  CampaignStatus.SCHEDULED,
  CampaignStatus.RUNNING,
  CampaignStatus.COMPLETED,
  CampaignStatus.CANCELLED,
];

// Phase 6 (Scheduling), Frontend part A. Flat /campaigns route reading the
// active workspace from useWorkspaceStore (WorkspaceSwitcher, mounted in
// Nav) - same convention as /social and /analytics, not the
// /workspaces/[id]/... URL-embedded pattern audit-log uses, since this sits
// in the same top-level nav tier as those pages.
export default function CampaignsPage() {
  const { user, checkingAuth, logout } = useAuth();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'ALL'>('ALL');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR(
    user && activeWorkspaceId ? ['campaigns', activeWorkspaceId] : null,
    () => listCampaigns(activeWorkspaceId as string),
  );

  const campaigns = (data?.campaigns ?? []).filter(
    (c) => statusFilter === 'ALL' || c.status === statusFilter,
  );

  async function handleCancel(id: string) {
    setCancellingId(id);
    try {
      await cancelCampaign(id);
      await mutate();
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
              Campaigns
            </h1>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              Group publish jobs across clips and platforms for a coordinated launch.
            </p>
          </div>
          {user && activeWorkspaceId && (
            <CreateCampaignDialog workspaceId={activeWorkspaceId} onCreated={() => mutate()} />
          )}
        </div>

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

            {!activeWorkspaceId && (
              <p className="mt-8 font-body text-sm text-muted-foreground">
                Pilih workspace terlebih dahulu (lihat pemilih workspace di navigasi).
              </p>
            )}
            {error && (
              <p className="mt-4 font-body text-sm text-destructive">
                {error instanceof Error ? error.message : 'Gagal memuat campaign'}
              </p>
            )}

            {activeWorkspaceId && (
              <>
                <div className="mt-6 flex flex-wrap gap-1">
                  {STATUS_FILTERS.map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setStatusFilter(status)}
                      aria-current={statusFilter === status ? 'true' : undefined}
                      className={cn(
                        'rounded-md px-3 py-1.5 font-mono text-xs transition-colors',
                        statusFilter === status
                          ? 'bg-primary-surface font-medium text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      {status === 'ALL' ? 'All' : CAMPAIGN_STATUS_LABELS[status]}
                    </button>
                  ))}
                </div>

                {isLoading ? null : campaigns.length === 0 ? (
                  <p className="mt-8 font-body text-sm text-muted-foreground">
                    Belum ada campaign.
                  </p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {campaigns.map((campaign) => (
                      <li
                        key={campaign.id}
                        className="rounded-lg border border-border bg-muted p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/campaigns/${campaign.id}`}
                                className="font-body text-sm font-medium text-foreground hover:underline"
                              >
                                {campaign.name}
                              </Link>
                              <Badge variant={campaignStatusBadgeVariant(campaign.status)}>
                                {CAMPAIGN_STATUS_LABELS[campaign.status]}
                              </Badge>
                              {campaign.tag && <Badge variant="outline">{campaign.tag}</Badge>}
                            </div>
                            {campaign.description && (
                              <p className="mt-1 truncate font-body text-xs text-muted-foreground">
                                {campaign.description}
                              </p>
                            )}
                            <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                              {new Date(campaign.startDate).toLocaleDateString()} –{' '}
                              {new Date(campaign.endDate).toLocaleDateString()} ·{' '}
                              {campaign.clipCount} clip · {campaign.platformCount} platform ·{' '}
                              {campaign.progress.published}/{campaign.progress.total} published
                              {campaign.progress.failed > 0 &&
                                ` · ${campaign.progress.failed} failed`}
                            </p>
                          </div>
                          {campaign.status !== CampaignStatus.CANCELLED &&
                            campaign.status !== CampaignStatus.COMPLETED && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={cancellingId === campaign.id}
                                onClick={() => handleCancel(campaign.id)}
                                className="shrink-0 text-destructive hover:text-destructive"
                              >
                                {cancellingId === campaign.id ? 'Membatalkan...' : 'Cancel'}
                              </Button>
                            )}
                        </div>
                      </li>
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
