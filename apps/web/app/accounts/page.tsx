'use client';

import type { SocialAccount } from '@viral-clip-app/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Nav } from '../../components/Nav';
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
// redirect back from GET /social/youtube/callback.
function readRedirectParams(): { connected: string | null; error: string | null } {
  if (typeof window === 'undefined') return { connected: null, error: null };
  const params = new URLSearchParams(window.location.search);
  return { connected: params.get('connected'), error: params.get('error') };
}

export default function AccountsPage() {
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
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : 'Failed to load accounts');
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
    <main className="min-h-screen bg-neutral-50 px-6 py-12 text-neutral-900">
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold">viral-clip-app</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Connect social accounts to publish clips to from the dashboard.
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 text-sm text-neutral-600">
            <Link href="/" className="underline">
              Log in
            </Link>{' '}
            to manage connected accounts.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {redirectNotice.connected && (
              <p className="mt-4 text-sm text-green-700">
                {PLATFORM_LABELS[redirectNotice.connected.toUpperCase()] ??
                  redirectNotice.connected}{' '}
                connected.
              </p>
            )}
            {redirectNotice.error && (
              <p className="mt-4 text-sm text-red-600">
                Couldn&apos;t connect: {redirectNotice.error.replace(/_/g, ' ')}
              </p>
            )}
            {loadError && <p className="mt-4 text-sm text-red-600">{loadError}</p>}

            <div className="mt-6 flex gap-3">
              <a
                href={connectYouTubeUrl()}
                className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
              >
                Connect YouTube
              </a>
              <a
                href={connectTikTokUrl()}
                className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
              >
                Connect TikTok
              </a>
              <a
                href={connectInstagramUrl()}
                className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
              >
                Connect Instagram
              </a>
            </div>

            {accounts === null ? null : accounts.length === 0 ? (
              <p className="mt-8 text-sm text-neutral-600">No accounts connected yet.</p>
            ) : (
              <ul className="mt-6 space-y-3">
                {accounts.map((account) => (
                  <li
                    key={account.id}
                    className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {PLATFORM_LABELS[account.platform] ?? account.platform} —{' '}
                        {account.displayName}
                      </p>
                      <p className="text-xs text-neutral-500">
                        Connected {new Date(account.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDisconnect(account.id)}
                      disabled={disconnectingId === account.id}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                      {disconnectingId === account.id ? 'Disconnecting...' : 'Disconnect'}
                    </button>
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
