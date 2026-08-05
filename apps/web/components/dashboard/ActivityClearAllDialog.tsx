'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Activity Timeline v2 - same disabled-until-match typed-confirmation
// pattern as app/accounts/page.tsx's DELETE_CONFIRM_WORD gate, but with the
// literal English word "DELETE" (not this app's usual Indonesian "HAPUS")
// per the user's explicit override for this flow specifically. No
// server-side elevation gate (unlike DELETE /accounts/me) - this is
// client-side friction only, matching NotificationsV2Service.remove()'s own
// precedent for a real bulk hard-delete (see the plan's explicit call on
// this).
const CONFIRM_WORD = 'DELETE';

export function ActivityClearAllDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
      setConfirmText('');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfirmText('');
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hapus Semua Aktivitas?</DialogTitle>
          <DialogDescription>
            Tindakan ini tidak bisa dibatalkan. Seluruh riwayat aktivitas pribadi Anda akan
            dihapus permanen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="activity-clear-all-confirm">
            Ketik <span className="font-mono text-destructive">{CONFIRM_WORD}</span> untuk
            konfirmasi
          </Label>
          <Input
            id="activity-clear-all-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_WORD}
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            variant="destructive"
            disabled={confirmText !== CONFIRM_WORD || busy}
            onClick={handleConfirm}
          >
            {busy ? 'Menghapus...' : 'Ya, Hapus Semua'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
