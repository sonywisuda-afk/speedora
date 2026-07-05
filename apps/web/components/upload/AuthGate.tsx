'use client';

import { type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';

export function AuthGate({
  mode,
  email,
  password,
  submitting,
  error,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onToggleMode,
  onForgotPassword,
}: {
  mode: 'login' | 'register';
  email: string;
  password: string;
  submitting: boolean;
  error: string | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onToggleMode: () => void;
  onForgotPassword: () => void;
}) {
  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle>{mode === 'login' ? 'Masuk' : 'Buat Akun'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder="kamu@contoh.com"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Kata Sandi</Label>
              {mode === 'login' ? (
                <button
                  type="button"
                  onClick={onForgotPassword}
                  className="font-body text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Lupa Kata Sandi?
                </button>
              ) : null}
            </div>
            <PasswordInput
              id="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="Minimal 8 karakter"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Memproses...' : mode === 'login' ? 'Masuk' : 'Daftar'}
          </Button>

          <button
            type="button"
            onClick={onToggleMode}
            className="block w-full text-center font-body text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {mode === 'login' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
