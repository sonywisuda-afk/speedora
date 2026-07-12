'use client';

import { PendingInviteRole } from '@speedora/shared';
import { useState } from 'react';
import { inviteMemberAction } from '@/app/dashboard/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const ROLE_LABELS: Record<PendingInviteRole, string> = {
  [PendingInviteRole.OWNER]: 'Owner',
  [PendingInviteRole.EDITOR]: 'Editor',
  [PendingInviteRole.VIEWER]: 'Viewer',
};

// Sprint 1-2 (Dashboard Redesign) - Invite Member quick action. Deliberately
// minimal per explicit product direction: sends a real email (see
// MailService.sendTeamInviteEmail) and logs a PendingInvite row for the
// Activity Timeline, but there is no shared video/clip access, no workspace
// switching, and no role enforcement anywhere - `role` is captured for
// display only. "Invitation sent!" always shows on success since the send
// path itself always succeeds from the user's perspective (SMTP-optional,
// same posture as password-reset).
export function InviteMemberDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PendingInviteRole>(PendingInviteRole.EDITOR);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail('');
    setRole(PendingInviteRole.EDITOR);
    setSent(false);
    setError(null);
  }

  async function handleSend() {
    setError(null);
    setSending(true);
    try {
      await inviteMemberAction(email, role);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim undangan');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Invite Member</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
        </DialogHeader>

        {sent ? (
          <p className="font-body text-sm text-emerald-400">Invitation sent!</p>
        ) : (
          <>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  Email
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teman@contoh.com"
                />
              </div>
              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  Role
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as PendingInviteRole)}
                  className="h-10 w-full rounded-md border border-input bg-slate-panel px-3 font-body text-sm text-foreground"
                >
                  {Object.values(PendingInviteRole).map((value) => (
                    <option key={value} value={value}>
                      {ROLE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              {error && <p className="font-body text-xs text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button disabled={sending || !email} onClick={handleSend}>
                {sending ? 'Mengirim...' : 'Send Invite'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
