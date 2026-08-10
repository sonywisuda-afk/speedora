'use client';

import { WorkspaceRole, type ApprovalDto } from '@speedora/shared';
import { useState } from 'react';
import useSWR from 'swr';
import { decideApproval, listApprovals, requestApproval, resubmitApproval } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useWorkspaceMembers } from '@/components/workspace/MemberPicker';
import { formatDuration, formatRelativeTime } from '@/lib/dashboard';

// Gap follow-up (2026-08-10) - the clip picker RequestApprovalDto.clipId's own comment always
// said was server-ready but never built (see this file's own comment below, and
// docs/collaboration.md if one exists by the time this is read). Deliberately narrow: id/hookText/
// startTime/endTime only, not a full Clip - this panel only needs enough to label options in a
// <select>, not the whole clip shape every caller of this component would otherwise need to
// thread through.
export interface ApprovalClipOption {
  id: string;
  hookText: string | null;
  startTime: number;
  endTime: number;
}

function clipOptionLabel(clip: ApprovalClipOption, index: number): string {
  const duration = formatDuration(clip.endTime - clip.startTime);
  return clip.hookText ? `${clip.hookText} (${duration})` : `Clip ${index + 1} (${duration})`;
}

const STATUS_STYLE: Record<ApprovalDto['status'], string> = {
  PENDING: 'bg-warning/10 text-warning',
  APPROVED: 'bg-success/10 text-success',
  REJECTED: 'bg-destructive/10 text-destructive',
  NEEDS_REVISION: 'bg-info/10 text-info',
};

const STATUS_LABEL: Record<ApprovalDto['status'], string> = {
  PENDING: 'Menunggu Review',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  NEEDS_REVISION: 'Perlu Revisi',
};

// Sprint 5D (Approval) - a self-contained panel (same shape as
// CommentsPanel) embedded in the Timeline Editor. RequestApprovalDto.clipId
// was always fully supported server-side (validated - must belong to this
// video); `clips` (optional, defaults to []) lets a caller that already has
// the video's clip list (both current call sites do) opt into a clip
// picker - omitting it keeps every pre-existing "video-level requests only"
// behavior identical. Reviewer assignment is still left to the server
// default (notifies the video owner) - no reviewer picker UI yet, same
// reasoning CommentsPanel's mention picker was previously deferred for -
// both are now done, see MemberPicker.tsx. `workspaceId` (optional,
// omitting it keeps every pre-existing "server picks the video owner"
// behavior identical) renders a reviewer <select> filtered to REVIEWER+
// members via useWorkspaceMembers' own minRole param - the same threshold
// ApprovalsService.request itself enforces, so this picker never offers a
// choice the server would reject.
export function ApprovalPanel({
  videoId,
  clips = [],
  workspaceId = null,
}: {
  videoId: string;
  clips?: ApprovalClipOption[];
  workspaceId?: string | null;
}) {
  const { data, mutate } = useSWR(['approvals', videoId], () => listApprovals(videoId));
  const { members: reviewers } = useWorkspaceMembers(workspaceId, WorkspaceRole.REVIEWER);
  const [note, setNote] = useState('');
  // '' means "whole video" (clipId: undefined, the pre-existing behavior) - not a sentinel value
  // that could collide with a real clip id, since real clip ids are always non-empty cuids.
  const [selectedClipId, setSelectedClipId] = useState('');
  // '' means "let the server pick" (reviewerId: undefined, the pre-existing default - notifies
  // the video owner), same empty-string-sentinel convention as selectedClipId above.
  const [selectedReviewerId, setSelectedReviewerId] = useState('');
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
      await requestApproval(videoId, {
        note: note.trim() || undefined,
        clipId: selectedClipId || undefined,
        reviewerId: selectedReviewerId || undefined,
      });
      setNote('');
      setSelectedClipId('');
      setSelectedReviewerId('');
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
        <div className="mt-2 flex flex-wrap gap-2">
          {clips.length > 0 && (
            <select
              value={selectedClipId}
              onChange={(e) => setSelectedClipId(e.target.value)}
              aria-label="Lingkup review"
              className="h-9 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
            >
              <option value="">Seluruh Video</option>
              {clips.map((clip, index) => (
                <option key={clip.id} value={clip.id}>
                  {clipOptionLabel(clip, index)}
                </option>
              ))}
            </select>
          )}
          {reviewers.length > 0 && (
            <select
              value={selectedReviewerId}
              onChange={(e) => setSelectedReviewerId(e.target.value)}
              aria-label="Reviewer"
              className="h-9 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
            >
              <option value="">Reviewer default (pemilik video)</option>
              {reviewers.map((reviewer) => (
                <option key={reviewer.userId} value={reviewer.userId}>
                  {reviewer.email}
                </option>
              ))}
            </select>
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan untuk reviewer (opsional)"
            className="h-9 flex-1 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
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
            <div key={approval.id} className="rounded-md border border-border bg-muted p-3">
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
