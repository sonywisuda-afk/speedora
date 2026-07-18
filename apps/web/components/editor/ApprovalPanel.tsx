'use client';

import type { ApprovalDto } from '@speedora/shared';
import { useState } from 'react';
import useSWR from 'swr';
import { decideApproval, listApprovals, requestApproval, resubmitApproval } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/dashboard';

const STATUS_STYLE: Record<ApprovalDto['status'], string> = {
  PENDING: 'bg-amber-500/10 text-amber-400',
  APPROVED: 'bg-emerald-500/10 text-emerald-400',
  REJECTED: 'bg-destructive/10 text-destructive',
  NEEDS_REVISION: 'bg-signal-cyan/10 text-signal-cyan',
};

const STATUS_LABEL: Record<ApprovalDto['status'], string> = {
  PENDING: 'Menunggu Review',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  NEEDS_REVISION: 'Perlu Revisi',
};

// Sprint 5D (Approval) - a self-contained panel (same shape as
// CommentsPanel) embedded in the Timeline Editor. Video-level requests
// only for this pass (RequestApprovalDto.clipId exists and is fully
// supported server-side, but there's no clip picker here yet - out of
// scope for this component, same deliberate "video-first" scoping
// ShareDialog/CommentsPanel already established). Reviewer assignment is
// likewise left to the server default (notifies the video owner) - no
// reviewer picker UI yet, same reasoning CommentsPanel's mention picker
// was deferred for.
export function ApprovalPanel({ videoId }: { videoId: string }) {
  const { data, mutate } = useSWR(['approvals', videoId], () => listApprovals(videoId));
  const [note, setNote] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({});

  const approvals = data?.approvals ?? [];
  const hasActive = approvals.some((a) => a.status === 'PENDING' || a.status === 'NEEDS_REVISION');

  async function withErrorHandling(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
    }
  }

  async function handleRequest() {
    setRequesting(true);
    await withErrorHandling(async () => {
      await requestApproval(videoId, { note: note.trim() || undefined });
      setNote('');
    });
    setRequesting(false);
  }

  async function handleDecide(id: string, status: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION') {
    await withErrorHandling(() =>
      decideApproval(id, { status, note: decisionNote[id]?.trim() || undefined }),
    );
  }

  async function handleResubmit(id: string) {
    await withErrorHandling(() => resubmitApproval(id, decisionNote[id]?.trim() || undefined));
  }

  return (
    <div className="mt-6">
      <h2 className="font-display text-sm uppercase tracking-wide text-muted-foreground">
        Approval
      </h2>

      {!hasActive && (
        <div className="mt-2 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan untuk reviewer (opsional)"
            className="h-9 flex-1 rounded-md border border-input bg-slate-panel px-2 font-body text-sm text-foreground"
          />
          <Button size="sm" disabled={requesting} onClick={handleRequest}>
            {requesting ? 'Mengirim...' : 'Request Review'}
          </Button>
        </div>
      )}
      {error && <p className="mt-1 font-body text-xs text-destructive">{error}</p>}

      <div className="mt-3 space-y-2">
        {approvals.length === 0 ? (
          <p className="font-body text-sm text-muted-foreground">Belum ada permintaan review.</p>
        ) : (
          approvals.map((approval) => (
            <div key={approval.id} className="rounded-md border border-border bg-slate-panel p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-body text-xs text-muted-foreground">
                  <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[approval.status]}`}>
                    {STATUS_LABEL[approval.status]}
                  </span>
                  <span>{approval.clipId ? `Clip ${approval.clipId}` : 'Video'}</span>
                  <span>
                    diminta oleh {approval.requestedByEmail} ·{' '}
                    {formatRelativeTime(approval.createdAt)}
                  </span>
                  {approval.reviewerEmail && <span>reviewer: {approval.reviewerEmail}</span>}
                </div>
                <button
                  onClick={() =>
                    setExpandedHistory(expandedHistory === approval.id ? null : approval.id)
                  }
                  className="font-body text-xs text-muted-foreground hover:underline"
                >
                  Riwayat ({approval.events.length})
                </button>
              </div>

              {approval.note && (
                <p className="mt-2 font-body text-sm text-foreground">{approval.note}</p>
              )}

              {expandedHistory === approval.id && (
                <ul className="mt-2 space-y-1 border-t border-border pt-2">
                  {approval.events.map((event) => (
                    <li key={event.id} className="font-body text-xs text-muted-foreground">
                      <span className={`rounded px-1 ${STATUS_STYLE[event.status]}`}>
                        {STATUS_LABEL[event.status]}
                      </span>{' '}
                      oleh {event.actorEmail} · {formatRelativeTime(event.createdAt)}
                      {event.note && <span> — &quot;{event.note}&quot;</span>}
                    </li>
                  ))}
                </ul>
              )}

              {approval.status === 'PENDING' && (
                <div className="mt-3 space-y-2">
                  <input
                    value={decisionNote[approval.id] ?? ''}
                    onChange={(e) =>
                      setDecisionNote((prev) => ({ ...prev, [approval.id]: e.target.value }))
                    }
                    placeholder="Catatan keputusan (opsional)"
                    className="h-8 w-full rounded-md border border-input bg-background px-2 font-body text-xs text-foreground"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleDecide(approval.id, 'APPROVED')}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDecide(approval.id, 'NEEDS_REVISION')}
                    >
                      Needs Revision
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDecide(approval.id, 'REJECTED')}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              )}

              {(approval.status === 'NEEDS_REVISION' || approval.status === 'REJECTED') && (
                <div className="mt-3">
                  <Button size="sm" variant="outline" onClick={() => handleResubmit(approval.id)}>
                    Resubmit
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
