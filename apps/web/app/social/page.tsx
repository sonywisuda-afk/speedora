'use client';

import type { SocialAccount } from '@speedora/shared';
import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Nav } from '../../components/Nav';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  connectInstagramUrl,
  connectTikTokUrl,
  connectYouTubeUrl,
  disconnectSocialAccount,
  listSocialAccounts,
} from '../../lib/api';
import { useAuth } from '../../lib/useAuth';

const PLATFORM_LABELS: Record<string, string> = {
  YOUTUBE: 'YouTube',
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
};

// Read directly off window.location rather than next/navigation's
// useSearchParams() - that hook requires wrapping the page in a Suspense
// boundary to avoid a build-time warning, which is unnecessary ceremony
// for reading two query params exactly once, right after the OAuth
// redirect back from GET /social/youtube/callback (and the tiktok/
// instagram equivalents).
function readRedirectParams(): { connected: string | null; error: string | null } {
  if (typeof window === 'undefined') return { connected: null, error: null };
  const params = new URLSearchParams(window.location.search);
  return { connected: params.get('connected'), error: params.get('error') };
}

export default function SocialMediaPage() {
  const { user, checkingAuth, logout } = useAuth();
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [redirectNotice, setRedirectNotice] = useState<{
    connected: string | null;
    error: string | null;
  }>({ connected: null, error: null });

  useEffect(() => {
    setRedirectNotice(readRedirectParams());
  }, []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    listSocialAccounts()
      .then((fetched) => {
        if (!cancelled) setAccounts(fetched);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Gagal memuat akun');
      });

    return () => {
      cancelled = true;
    };
    // Re-fetch once after a fresh OAuth connect redirect lands.
  }, [user, redirectNotice.connected]);

  async function handleDisconnect(id: string) {
    setDisconnectingId(id);
    try {
      await disconnectSocialAccount(id);
      setAccounts((prev) => prev?.filter((a) => a.id !== id) ?? prev);
    } finally {
      setDisconnectingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-xl">
        <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
          Speedora
        </h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          Hubungkan akun sosial media untuk publish klip langsung dari dashboard.
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk mengelola akun yang terhubung.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {redirectNotice.connected && (
              <p className="mt-4 font-body text-sm text-signal-cyan">
                {PLATFORM_LABELS[redirectNotice.connected.toUpperCase()] ??
                  redirectNotice.connected}{' '}
                berhasil terhubung.
              </p>
            )}
            {redirectNotice.error && (
              <p className="mt-4 font-body text-sm text-destructive">
                Gagal terhubung: {redirectNotice.error.replace(/_/g, ' ')}
              </p>
            )}
            {loadError && <p className="mt-4 font-body text-sm text-destructive">{loadError}</p>}

            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="outline" asChild>
                <a href={connectYouTubeUrl()}>Hubungkan YouTube</a>
              </Button>
              <Button variant="outline" asChild>
                <a href={connectTikTokUrl()}>Hubungkan TikTok</a>
              </Button>
              <Button variant="outline" asChild>
                <a href={connectInstagramUrl()}>Hubungkan Instagram</a>
              </Button>
            </div>

            {accounts === null ? null : accounts.length === 0 ? (
              <p className="mt-8 font-body text-sm text-muted-foreground">
                Belum ada akun yang terhubung.
              </p>
            ) : (
              <ul className="mt-6 space-y-3">
                {accounts.map((account) => (
                  <li
                    key={account.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-slate-panel p-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-body text-sm font-medium text-foreground">
                          {PLATFORM_LABELS[account.platform] ?? account.platform} —{' '}
                          {account.displayName}
                        </p>
                        <Badge variant="secondary">Terhubung</Badge>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        Terhubung sejak {new Date(account.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disconnectingId === account.id}
                      onClick={() => handleDisconnect(account.id)}
                      className="gap-1.5 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {disconnectingId === account.id ? 'Memutuskan...' : 'Putuskan'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </main>
  );
}
