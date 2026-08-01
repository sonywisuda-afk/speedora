'use client';

import { useState, type FormEvent } from 'react';

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
import { PasswordInput } from '@/components/ui/password-input';

// Tahap 2 Step 2 Sprint 2b (Session Elevation) - a single reusable prompt
// for every RecentMfaGuard-protected action (disable MFA, regenerate
// recovery codes, change password, delete account, and since Tahap 3
// Sprint 1/3, register/delete a passkey). Which credential to ask for
// depends on the account: a TOTP/recovery code if MFA is enabled, the
// current password otherwise - mfaEnabled is passed in from the Accounts
// page's already-fetched MfaStatusDto, not re-fetched here. hasPasskeys
// (Sprint 3) offers a THIRD option alongside that - a passkey assertion is
// a strictly stronger proof of identity than either, so it's always offered
// when available, never gated behind mfaEnabled/password state.
export interface ElevationDialogProps {
  open: boolean;
  mfaEnabled: boolean;
  hasPasskeys: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (credential: { code: string } | { password: string }) => void;
  // Fires the whole WebAuthn ceremony (options -> browser prompt -> verify)
  // - owned by the caller (accounts/page.tsx), not this dialog, same
  // "dialog stays a dumb credential collector" shape onSubmit already has.
  onUsePasskey: () => void;
  onCancel: () => void;
}

export function ElevationDialog({
  open,
  mfaEnabled,
  hasPasskeys,
  submitting,
  error,
  onSubmit,
  onUsePasskey,
  onCancel,
}: ElevationDialogProps) {
  const [value, setValue] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(mfaEnabled ? { code: value } : { password: value });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setValue('');
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verifikasi Ulang Diperlukan</DialogTitle>
          <DialogDescription>
            {mfaEnabled
              ? 'Masukkan kode 2FA atau kode pemulihan untuk melanjutkan.'
              : 'Masukkan kata sandi kamu saat ini untuk melanjutkan.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="elevation-value">{mfaEnabled ? 'Kode Verifikasi' : 'Kata Sandi'}</Label>
            {mfaEnabled ? (
              <Input
                id="elevation-value"
                required
                autoFocus
                autoComplete="one-time-code"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="123456"
              />
            ) : (
              <PasswordInput
                id="elevation-value"
                required
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
              Batal
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Memverifikasi...' : 'Verifikasi'}
            </Button>
          </DialogFooter>
        </form>
        {hasPasskeys ? (
          <>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="font-body text-xs text-muted-foreground">atau</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={submitting}
              onClick={onUsePasskey}
            >
              Verifikasi dengan Passkey
            </Button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
