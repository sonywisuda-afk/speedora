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
// recovery codes, change password, delete account). Which credential to
// ask for depends on the account: a TOTP/recovery code if MFA is enabled,
// the current password otherwise - mfaEnabled is passed in from the
// Accounts page's already-fetched MfaStatusDto, not re-fetched here.
export interface ElevationDialogProps {
  open: boolean;
  mfaEnabled: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (credential: { code: string } | { password: string }) => void;
  onCancel: () => void;
}

export function ElevationDialog({
  open,
  mfaEnabled,
  submitting,
  error,
  onSubmit,
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
            <Label htmlFor="elevation-value">
              {mfaEnabled ? 'Kode Verifikasi' : 'Kata Sandi'}
            </Label>
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
      </DialogContent>
    </Dialog>
  );
}
