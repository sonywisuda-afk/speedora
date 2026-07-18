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

const ROLE_LABELS: Record<ShareRole, string> = {
  [ShareRole.VIEWER]: 'Viewer',
  [ShareRole.REVIEWER]: 'Reviewer',
};

// Sprint 5B (Shared Clips) - a per-video "Share" action, separate from
// WorkspaceMembersDialog: a share link grants read-only (or REVIEWER)
// access to exactly this one video to anyone holding the URL, with no
// Speedora account or workspace membership required on their end.
export function ShareDialog({ videoId }: { videoId: string }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<ShareRole>(ShareRole.VIEWER);
  const [expiresInDays, setExpiresInDays] = useState('');
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
      const link = await createShareLink(videoId, { role, expiresInDays: days });
      setJustCreatedUrl(link.url);
      setCopied(false);
      setExpiresInDays('');
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
        <button className="font-body text-sm text-foreground underline underline-offset-2 hover:text-signal-pink">
          Share
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Video</DialogTitle>
        </DialogHeader>

        {justCreatedUrl && (
          <div className="rounded-md border border-signal-cyan/40 bg-signal-cyan/5 p-3">
            <p className="font-body text-xs text-muted-foreground">
              Link ini hanya ditampilkan sekali - simpan sekarang.
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                readOnly
                value={justCreatedUrl}
                className="h-8 flex-1 rounded-md border border-input bg-slate-panel px-2 font-mono text-xs text-foreground"
                onFocus={(e) => e.target.select()}
              />
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied ? 'Tersalin' : 'Salin'}
              </Button>
            </div>
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
              className="h-9 w-full rounded-md border border-input bg-slate-panel px-2 font-body text-sm text-foreground"
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
              className="h-9 w-full rounded-md border border-input bg-slate-panel px-2 font-body text-sm text-foreground"
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
