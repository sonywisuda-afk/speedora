'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { acceptInvite, previewInvite, type InvitePreviewDto } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';

// Sprint 5A (Collaboration Foundation). GET /invites/:token (previewInvite)
// is deliberately unauthenticated server-side, so this page can show
// "you've been invited to X as Editor" before the visitor is logged in -
// only the accept action itself (POST /invites/:token/accept) requires a
// session, same split as the reset-password flow's read-vs-mutate routes.
export default function AcceptInvitePage({ params }: { params: { token: string } }) {
  const { user, checkingAuth } = useAuth();
  const [preview, setPreview] = useState<InvitePreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    previewInvite(params.token)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : 'Undangan tidak ditemukan'));
  }, [params.token]);

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      await acceptInvite(params.token);
      setAccepted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menerima undangan');
    } finally {
      setAccepting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12">
      <Card className="mx-auto max-w-sm">
        <CardHeader>
          <CardTitle>Undangan Workspace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && !preview ? (
            <p className="font-body text-sm text-destructive">{error}</p>
          ) : !preview ? (
            <p className="font-body text-sm text-muted-foreground">Memuat undangan...</p>
          ) : accepted ? (
            <div className="space-y-4">
              <p className="font-body text-sm text-success">
                Kamu sekarang anggota &quot;{preview.workspaceName}&quot;.
              </p>
              <Button asChild className="w-full">
                <Link href="/dashboard">Buka Dashboard</Link>
              </Button>
            </div>
          ) : preview.status !== 'PENDING' ? (
            <p className="font-body text-sm text-destructive">Undangan ini sudah tidak berlaku.</p>
          ) : (
            <div className="space-y-4">
              <p className="font-body text-sm text-foreground">
                Kamu diundang untuk bergabung dengan <strong>{preview.workspaceName}</strong>{' '}
                sebagai <strong>{preview.role}</strong>.
              </p>
              {checkingAuth ? null : !user ? (
                <>
                  <p className="font-body text-xs text-muted-foreground">
                    Masuk terlebih dahulu dengan email {preview.email}, lalu buka link undangan ini
                    lagi untuk menerimanya.
                  </p>
                  <Button asChild className="w-full">
                    <Link href="/upload">Masuk</Link>
                  </Button>
                </>
              ) : (
                <Button disabled={accepting} onClick={handleAccept} className="w-full">
                  {accepting ? 'Memproses...' : 'Terima Undangan'}
                </Button>
              )}
              {error && <p className="font-body text-xs text-destructive">{error}</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
