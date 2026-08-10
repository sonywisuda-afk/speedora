'use client';

import { ShareRole } from '@speedora/shared';
import { useState } from 'react';
import useSWR from 'swr';
import { createShareLink, listShareLinks, revokeShareLink } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { formatDuration } from '@/lib/dashboard';

const ROLE_LABELS: Record<ShareRole, string> = {
  [ShareRole.VIEWER]: 'Viewer',
  [ShareRole.REVIEWER]: 'Reviewer',
};

// Collaboration roadmap follow-up (clip-level Share scoping, 2026-08-10) -
// deliberately narrow, same reasoning ApprovalPanel.tsx's own
// ApprovalClipOption comment gives: this dialog only needs enough to label
// options in a <select>, not the whole Clip shape every caller would
// otherwise need to thread through. A local, separate type rather than
// importing ApprovalClipOption across components/editor -> components/
// dashboard - the two features happen to need the same 4 fields, but
// aren't otherwise coupled.
export interface ShareClipOption {
  id: string;
  hookText: string | null;
  startTime: number;
  endTime: number;
}

function clipOptionLabel(clip: ShareClipOption, index: number): string {
  const duration = formatDuration(clip.endTime - clip.startTime);
  return clip.hookText ? `${clip.hookText} (${duration})` : `Clip ${index + 1} (${duration})`;
}

// Sprint 5B (Shared Clips) - a per-video "Share" action, separate from
// WorkspaceMembersDialog: a share link grants read-only (or REVIEWER)
// access to exactly this one video (or, since the clip-level scoping
// follow-up, exactly one clip within it) to anyone holding the URL, with
// no Speedora account or workspace membership required on their end.
// `clips` (optional, defaults to []) lets a caller that already has the
// video's clip list opt into a clip picker - omitting it keeps every
// pre-existing "video-level links only" behavior identical.
export function ShareDialog({
  videoId,
  clips = [],
}: {
  videoId: string;
  clips?: ShareClipOption[];
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<ShareRole>(ShareRole.VIEWER);
  const [expiresInDays, setExpiresInDays] = useState('');
  // '' means "whole video" (clipId: undefined) - same empty-string-sentinel
  // convention ApprovalPanel.tsx's own selectedClipId already established.
  const [selectedClipId, setSelectedClipId] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreatedUrl, setJustCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, mutate } = useSWR(open ? ['share-links', videoId] : null, () =>
    listShareLinks(videoId),
  );

  async function handleCreate() {
    setError(null);
    setCreating(true);
    try {
      const days = expiresInDays ? Number(expiresInDays) : undefined;
      const link = await createShareLink(videoId, {
        role,
        expiresInDays: days,
        clipId: selectedClipId || undefined,
      });
      setJustCreatedUrl(link.url);
      setCopied(false);
      setExpiresInDays('');
      setSelectedClipId('');
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat link');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    await revokeShareLink(id);
    await mutate();
  }

  async function handleCopy() {
    if (!justCreatedUrl) return;
    await navigator.clipboard.writeText(justCreatedUrl);
    setCopied(true);
  }

  const activeLinks = (data?.links ?? []).filter((l) => !l.revoked);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setJustCreatedUrl(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <button className="font-body text-sm text-foreground underline underline-offset-2 hover:text-primary">
          Share
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Video</DialogTitle>
        </DialogHeader>

        {justCreatedUrl && (
          <div className="rounded-md border border-info/40 bg-info/5 p-3">
            <p className="font-body text-xs text-muted-foreground">
              Link ini hanya ditampilkan sekali - simpan sekarang.
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                readOnly
                value={justCreatedUrl}
                className="h-8 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground"
                onFocus={(e) => e.target.select()}
              />
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied ? 'Tersalin' : 'Salin'}
              </Button>
            </div>
          </div>
        )}

        {clips.length > 0 && (
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Cakupan
            </label>
            <select
              value={selectedClipId}
              onChange={(e) => setSelectedClipId(e.target.value)}
              aria-label="Cakupan link"
              className="h-9 w-full rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
            >
              <option value="">Seluruh Video</option>
              {clips.map((clip, index) => (
                <option key={clip.id} value={clip.id}>
                  {clipOptionLabel(clip, index)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ShareRole)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
            >
              {Object.values(ShareRole).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="w-28 space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Expiry (hari)
            </label>
            <input
              type="number"
              min={1}
              max={365}
              placeholder="Never"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
            />
          </div>
          <Button size="sm" disabled={creating} onClick={handleCreate}>
            {creating ? 'Membuat...' : 'Buat Link'}
          </Button>
        </div>
        {error && <p className="font-body text-xs text-destructive">{error}</p>}

        {activeLinks.length > 0 && (
          <div className="mt-2 space-y-1.5 border-t border-border pt-3">
            <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Link Aktif
            </p>
            {activeLinks.map((link) => (
              <div key={link.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="font-body text-foreground">
                  {ROLE_LABELS[link.role]}
                  {link.clipId && (
                    <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-primary">
                      1 klip
                    </span>
                  )}
                  {link.expiresAt && (
                    <span className="text-muted-foreground">
                      {' '}
                      · berakhir {new Date(link.expiresAt).toLocaleDateString()}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => handleRevoke(link.id)}
                  className="font-body text-xs text-destructive hover:underline"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
