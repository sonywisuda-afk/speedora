'use client';

import { type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ForgotPasswordForm({
  email,
  submitting,
  message,
  error,
  onEmailChange,
  onSubmit,
  onBack,
}: {
  email: string;
  submitting: boolean;
  message: string | null;
  error: string | null;
  onEmailChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle>Lupa Kata Sandi</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="font-body text-sm text-muted-foreground">
            Masukkan email akun kamu. Kalau email terdaftar, link reset kata sandi akan dikirim.
          </p>

          <div className="space-y-2">
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              required
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="kamu@contoh.com"
            />
          </div>

          {message ? <p className="text-sm text-signal-cyan">{message}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Mengirim...' : 'Kirim Link Reset'}
          </Button>

          <button
            type="button"
            onClick={onBack}
            className="block w-full text-center font-body text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Kembali ke Masuk
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
