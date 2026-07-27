'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { submitMfaChallenge } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';

// Tahap 2 Step 2 Sprint 2a (MFA Enforcement) - serves BOTH entry points that
// can defer a login behind an MFA challenge: password login's
// handleAuthSubmit (a client-side router.push after catching
// MfaRequiredError) and OAuthController's callback (a real top-level
// redirect, since that flow has no fetch() the frontend can read a JSON
// body from - see oauth.controller.ts's own comment). Read directly off
// window.location, same "avoid the Suspense-boundary requirement for one
// query param" reasoning as verify-email/reset-password's readToken().
function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('token');
}

export default function MfaChallengePage() {
  const { setUser } = useAuth();
  const router = useRouter();

  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [rememberDevice, setRememberDevice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = readToken();
    if (!token) {
      setError('Tautan verifikasi tidak valid. Silakan masuk kembali.');
      return;
    }
    setMfaToken(token);
    // Mount-only, same reasoning as verify-email's own effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setSubmitting(true);
    try {
      const user = await submitMfaChallenge(mfaToken, code, rememberDevice);
      setUser(user);
      router.push('/upload');
    } catch (err) {
      // Deliberately generic - never reveals whether the token itself
      // expired vs. the code was wrong, same "don't leak which part
      // failed" posture as AuthService.validateUser's own error message.
      setError(err instanceof Error ? err.message : 'Kode verifikasi tidak valid.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12">
      <Card className="mx-auto max-w-sm">
        <CardHeader>
          <CardTitle>Verifikasi Dua Faktor</CardTitle>
        </CardHeader>
        <CardContent>
          {!mfaToken ? (
            <p className="font-body text-sm text-destructive">
              {error ?? 'Memuat...'}{' '}
              <Link href="/upload" className="underline">
                Kembali ke halaman masuk
              </Link>
              .
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="font-body text-sm text-muted-foreground">
                Masukkan kode dari aplikasi authenticator kamu, atau salah satu kode pemulihan.
              </p>
              <div className="space-y-2">
                <Label htmlFor="mfa-code">Kode Verifikasi</Label>
                <Input
                  id="mfa-code"
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="remember-device"
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                />
                <Label htmlFor="remember-device" className="font-normal">
                  Percayai perangkat ini selama 60 hari
                </Label>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Memverifikasi...' : 'Verifikasi'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
