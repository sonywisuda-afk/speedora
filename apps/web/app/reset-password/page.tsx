'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { resetPassword } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';

// Read directly off window.location rather than next/navigation's
// useSearchParams() - same reasoning as accounts page's readRedirectParams():
// avoids the Suspense-boundary requirement for reading one query param
// exactly once, right after the user follows the emailed reset link.
function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('token');
}

export default function ResetPasswordPage() {
  const { setUser } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setToken(readToken());
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      const user = await resetPassword(token, newPassword);
      setUser(user);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12">
      <Card className="mx-auto max-w-sm">
        <CardHeader>
          <CardTitle>Ganti Kata Sandi</CardTitle>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4">
              <p className="font-body text-sm text-signal-cyan">
                Kata sandi berhasil diganti. Kamu sudah masuk.
              </p>
              <Button asChild className="w-full">
                <Link href="/upload">Lanjut ke Upload</Link>
              </Button>
            </div>
          ) : token === null ? (
            <p className="font-body text-sm text-destructive">
              Link reset tidak valid. Minta link baru lewat halaman{' '}
              <Link href="/upload" className="underline">
                Masuk
              </Link>
              .
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Kata Sandi Baru</Label>
                <PasswordInput
                  id="new-password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimal 8 karakter"
                />
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? 'Menyimpan...' : 'Simpan Kata Sandi Baru'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
