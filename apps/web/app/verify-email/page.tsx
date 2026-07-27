'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { verifyEmail } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';

// Read directly off window.location rather than next/navigation's
// useSearchParams() - same reasoning as reset-password's readToken(): avoids
// the Suspense-boundary requirement for reading one query param exactly
// once, right after the user follows the emailed verify link.
function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('token');
}

type Status = 'checking' | 'verifying' | 'done' | 'error';

export default function VerifyEmailPage() {
  const { setUser } = useAuth();
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = readToken();
    if (!token) {
      setStatus('error');
      setError('Link verifikasi tidak valid.');
      return;
    }

    setStatus('verifying');
    verifyEmail(token)
      .then((user) => {
        setUser(user);
        setStatus('done');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Terjadi kesalahan. Coba lagi.');
        setStatus('error');
      });
    // Only ever meant to run once per mount, same reasoning as
    // reset-password's readToken() effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-background px-6 py-12">
      <Card className="mx-auto max-w-sm">
        <CardHeader>
          <CardTitle>Verifikasi Email</CardTitle>
        </CardHeader>
        <CardContent>
          {status === 'checking' || status === 'verifying' ? (
            <p className="font-body text-sm text-muted-foreground">Memverifikasi email kamu...</p>
          ) : status === 'done' ? (
            <div className="space-y-4">
              <p className="font-body text-sm text-success">Email berhasil diverifikasi.</p>
              <Button asChild className="w-full">
                <Link href="/upload">Lanjut ke Upload</Link>
              </Button>
            </div>
          ) : (
            <p className="font-body text-sm text-destructive">
              {error} Minta link baru lewat halaman{' '}
              <Link href="/upload" className="underline">
                Masuk
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
