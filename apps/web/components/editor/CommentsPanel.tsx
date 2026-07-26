'use client';

import type { CommentDto } from '@speedora/shared';
import { Paperclip } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import {
  addCommentAttachment,
  addCommentReaction,
  commentAttachmentUrl,
  createComment,
  deleteComment,
  listComments,
  removeCommentReaction,
  resolveComment,
  unresolveComment,
  updateComment,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/dashboard';
import { formatTimestamp } from '@/lib/thumbnail-selection';
import { useTimelineStore } from '@/lib/timelineStore';
import { useAuth } from '@/lib/useAuth';

const QUICK_REACTIONS = ['👍', '❤️', '🎉', '😂'];

// Sprint 5C (Comments) - a self-contained panel (not a Dialog) embedded in
// the Timeline Editor, below TimelineEditor itself. Threading is
// deliberately two-level (a root comment + its flat replies, matching
// CommentsService's own "reject reply-to-a-reply" rule) rather than
// arbitrary nesting - keeps this component's tree shallow and matches
// Figma/Notion's own "resolve the whole thread" comment model.
//
// Mention (@user) capability is fully built and tested server-side
// (CommentsService.create's mentionedUserIds validation, the MENTION
// notification) but this pass's UI has no mention picker yet - out of
// scope for this component, a small follow-up once a workspace-member
// picker exists elsewhere in the app to reuse.
export function CommentsPanel({ videoId }: { videoId: string }) {
  const { user } = useAuth();
  const { data, mutate } = useSWR(['comments', videoId], () => listComments(videoId));
  const playhead = useTimelineStore((s) => s.playhead);
  const setPlayhead = useTimelineStore((s) => s.setPlayhead);

  const [newBody, setNewBody] = useState('');
  const [anchorToTime, setAnchorToTime] = useState(true);
  const [posting, setPosting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const comments = data?.comments ?? [];
  const roots = comments.filter((c) => !c.parentId);
  const repliesByParent = new Map<string, CommentDto[]>();
  for (const c of comments) {
    if (!c.parentId) continue;
    repliesByParent.set(c.parentId, [...(repliesByParent.get(c.parentId) ?? []), c]);
  }

  async function withErrorHandling(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
    }
  }

  async function handlePost() {
    if (!newBody.trim()) return;
    setPosting(true);
    await withErrorHandling(async () => {
      await createComment(videoId, {
        body: newBody.trim(),
        timestampSeconds: anchorToTime ? playhead : undefined,
      });
      setNewBody('');
    });
    setPosting(false);
  }

  async function handleReply(parentId: string) {
    if (!replyBody.trim()) return;
    await withErrorHandling(async () => {
      await createComment(videoId, { body: replyBody.trim(), parentId });
      setReplyBody('');
      setReplyingTo(null);
    });
  }

  async function handleSaveEdit(id: string) {
    if (!editBody.trim()) return;
    await withErrorHandling(async () => {
      await updateComment(id, editBody.trim());
      setEditingId(null);
    });
  }

  async function handleToggleReaction(comment: CommentDto, emoji: string) {
    const mine = comment.reactions.find((r) => r.emoji === emoji)?.reactedByMe;
    await withErrorHandling(() =>
      mine ? removeCommentReaction(comment.id, emoji) : addCommentReaction(comment.id, emoji),
    );
  }

  async function handleAttach(commentId: string, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    await withErrorHandling(() => addCommentAttachment(commentId, file));
  }

  function renderComment(comment: CommentDto, isReply: boolean) {
    const isEditing = editingId === comment.id;
    return (
      <div key={comment.id} className={isReply ? 'ml-8 border-l border-border pl-3' : ''}>
        <div className="rounded-md border border-border bg-muted p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-body text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{comment.authorEmail}</span>
              <span>{formatRelativeTime(comment.createdAt)}</span>
              {comment.editedAt && <span>(diedit)</span>}
              {comment.timestampSeconds !== null && (
                <button
                  onClick={() => setPlayhead(comment.timestampSeconds as number)}
                  className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-primary hover:underline"
                >
                  {formatTimestamp(comment.timestampSeconds)}
                </button>
              )}
              {comment.resolved && (
                <span className="rounded bg-success/10 px-1.5 py-0.5 text-success">Resolved</span>
              )}
            </div>
            <div className="flex items-center gap-2 font-body text-xs">
              {!isReply &&
                (comment.resolved ? (
                  <button
                    onClick={() => withErrorHandling(() => unresolveComment(comment.id))}
                    className="text-muted-foreground hover:underline"
                  >
                    Buka Lagi
                  </button>
                ) : (
                  <button
                    onClick={() => withErrorHandling(() => resolveComment(comment.id))}
                    className="text-primary hover:underline"
                  >
                    Resolve
                  </button>
                ))}
              {comment.authorId === user?.id && (
                <>
                  <button
                    onClick={() => {
                      setEditingId(comment.id);
                      setEditBody(comment.body);
                    }}
                    className="text-muted-foreground hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => withErrorHandling(() => deleteComment(comment.id))}
                    className="text-destructive hover:underline"
                  >
                    Hapus
                  </button>
                </>
              )}
            </div>
          </div>

          {isEditing ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="h-16 w-full rounded-md border border-input bg-background p-2 font-body text-sm text-foreground"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleSaveEdit(comment.id)}>
                  Simpan
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                  Batal
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-2 whitespace-pre-wrap font-body text-sm text-foreground">
              {comment.body}
            </p>
          )}

          {comment.attachments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {comment.attachments.map((a) => (
                <li key={a.id}>
                  <a
                    href={commentAttachmentUrl(a.url)}
                    className="inline-flex items-center gap-1 font-body text-xs text-primary underline"
                  >
                    <Paperclip className="h-3 w-3" aria-hidden="true" />
                    {a.fileName}
                  </a>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1">
            {QUICK_REACTIONS.map((emoji) => {
              const found = comment.reactions.find((r) => r.emoji === emoji);
              return (
                <button
                  key={emoji}
                  onClick={() => handleToggleReaction(comment, emoji)}
                  className={`rounded-full border px-1.5 py-0.5 font-body text-xs ${
                    found?.reactedByMe
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {emoji} {found?.count ?? ''}
                </button>
              );
            })}
            <label className="cursor-pointer rounded-full border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-accent">
              <Paperclip className="h-3 w-3" aria-hidden="true" />
              <input
                type="file"
                className="hidden"
                onChange={(e) => handleAttach(comment.id, e.target.files)}
              />
            </label>
            {!isReply && (
              <button
                onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                className="font-body text-xs text-muted-foreground hover:underline"
              >
                Balas
              </button>
            )}
          </div>

          {!isReply && replyingTo === comment.id && (
            <div className="mt-2 flex gap-2">
              <input
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Tulis balasan..."
                className="h-8 flex-1 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
              />
              <Button size="sm" onClick={() => handleReply(comment.id)}>
                Kirim
              </Button>
            </div>
          )}
        </div>

        {!isReply &&
          (repliesByParent.get(comment.id) ?? []).map((reply) => (
            <div key={reply.id} className="mt-2">
              {renderComment(reply, true)}
            </div>
          ))}
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h2 className="font-display text-sm uppercase tracking-wide text-muted-foreground">
        Comments
      </h2>

      <div className="mt-2 flex gap-2">
        <input
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder="Tulis komentar..."
          className="h-9 flex-1 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
        />
        <label className="flex items-center gap-1.5 font-body text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={anchorToTime}
            onChange={(e) => setAnchorToTime(e.target.checked)}
          />
          di {formatTimestamp(playhead)}
        </label>
        <Button size="sm" disabled={posting || !newBody.trim()} onClick={handlePost}>
          {posting ? 'Mengirim...' : 'Kirim'}
        </Button>
      </div>
      {error && <p className="mt-1 font-body text-xs text-destructive">{error}</p>}

      <div className="mt-4 space-y-3">
        {roots.length === 0 ? (
          <p className="font-body text-sm text-muted-foreground">Belum ada komentar.</p>
        ) : (
          roots.map((c) => renderComment(c, false))
        )}
      </div>
    </div>
  );
}
