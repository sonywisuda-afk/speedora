'use client';

import type { TrackedLinkDto } from '@speedora/shared';
import { useState } from 'react';
import { createTrackedLink } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface TrackedLinkCreatorProps {
  workspaceId: string;
  target: { publishRecordId: string } | { campaignId: string };
  onCreated: (link: TrackedLinkDto) => void;
}

// Sprint 6K (Conversion) - the one piece of UI this sprint needs: a
// destinationUrl input + submit, attributed to exactly one publish record
// or campaign (never both - same mutual-exclusion TrackedLinksService
// enforces). Deliberately no list/delete UI here - ClipTrafficTable/
// CampaignAnalyticsTab each show the resulting conversionCount once the
// parent re-fetches, which is enough to make the feature usable without
// building a dedicated tracked-links management page this sprint didn't
// ask for.
export function TrackedLinkCreator({ workspaceId, target, onCreated }: TrackedLinkCreatorProps) {
  const [open, setOpen] = useState(false);
  const [destinationUrl, setDestinationUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const link = await createTrackedLink(workspaceId, { destinationUrl, ...target });
      onCreated(link);
      setOpen(false);
      setDestinationUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat tracking link');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Buat Tracking Link
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <Input
        type="url"
        required
        placeholder="https://tujuan-kamu.com"
        value={destinationUrl}
        onChange={(e) => setDestinationUrl(e.target.value)}
        className="h-8 w-56 text-xs"
      />
      <Button type="submit" size="sm" disabled={submitting}>
        {submitting ? 'Membuat...' : 'Simpan'}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Batal
      </Button>
      {error && <span className="font-body text-xs text-destructive">{error}</span>}
    </form>
  );
}
