'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Nav } from '../../components/Nav';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PasswordInput } from '../../components/ui/password-input';
import {
  changePassword,
  deleteAccount,
  listSessions,
  logoutOthers,
  revokeSession,
  type SessionDto,
} from '../../lib/api';
import { useAuth } from '../../lib/useAuth';

// Typed into the danger-zone field to unlock account deletion - a guard
// against an accidental single click wiping everything.
const DELETE_CONFIRM_WORD = 'HAPUS';

export default function AccountsPage() {
  const { user, setUser, checkingAuth, logout } = useAuth();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [changePasswordMessage, setChangePasswordMessage] = useState<string | null>(null);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);

  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  // Authentication Foundation Sprint 3 (Session Dashboard) - null while
  // loading, same "null means not fetched yet" convention as elsewhere in
  // this app.
  const [sessions, setSessions] = useState<SessionDto[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [loggingOutOthers, setLoggingOutOthers] = useState(false);

  async function fetchSessions() {
    try {
      setSessions(await listSessions());
      setSessionsError(null);
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Gagal memuat daftar perangkat.');
    }
  }

  useEffect(() => {
    if (!user) return;
    fetchSessions();
    // Only ever meant to run once the user is known, same reasoning as
    // useAuth's own mount-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleSignOutSession(session: SessionDto) {
    if (session.current) {
      await logout();
      router.push('/upload');
      return;
    }
    setRevokingId(session.id);
    try {
      await revokeSession(session.id);
      await fetchSessions();
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Gagal keluar dari perangkat.');
    } finally {
      setRevokingId(null);
    }
  }

  async function handleLogoutOthers() {
    setLoggingOutOthers(true);
    try {
      await logoutOthers();
      await fetchSessions();
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Gagal keluar dari perangkat lain.');
    } finally {
      setLoggingOutOthers(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleteAccountError(null);
    setDeletingAccount(true);
    try {
      await deleteAccount();
      // Session is already cleared server-side; drop the client user and
      // send them back to the entry page.
      setUser(null);
      router.push('/upload');
    } catch (err) {
      setDeleteAccountError(err instanceof Error ? err.message : 'Gagal menghapus akun');
      setDeletingAccount(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setChangePasswordError(null);
    setChangePasswordMessage(null);
    setChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setChangePasswordMessage('Kata sandi berhasil diganti.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setChangePasswordError(err instanceof Error ? err.message : 'Terjadi kesalahan. Coba lagi.');
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-xl">
        <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">Speedora</h1>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          Kelola kata sandi dan akun kamu.
        </p>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk mengelola akun kamu.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Ganti Kata Sandi</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="current-password">Kata Sandi Saat Ini</Label>
                    <PasswordInput
                      id="current-password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>

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

                  {changePasswordMessage && (
                    <p className="text-sm text-success">{changePasswordMessage}</p>
                  )}
                  {changePasswordError && (
                    <p className="text-sm text-destructive">{changePasswordError}</p>
                  )}

                  <Button type="submit" disabled={changingPassword}>
                    {changingPassword ? 'Menyimpan...' : 'Simpan Kata Sandi Baru'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="mt-10">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Perangkat Aktif</CardTitle>
                {sessions && sessions.length > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loggingOutOthers}
                    onClick={handleLogoutOthers}
                  >
                    {loggingOutOthers ? 'Memproses...' : 'Keluar dari Perangkat Lain'}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {sessionsError && <p className="text-sm text-destructive">{sessionsError}</p>}
                {sessions === null ? (
                  <p className="font-body text-sm text-muted-foreground">Memuat...</p>
                ) : (
                  sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
                    >
                      <div className="min-w-0 font-body text-sm">
                        <p className="flex items-center gap-2 font-medium text-foreground">
                          {session.deviceName ?? 'Perangkat tidak dikenal'}
                          {session.current && (
                            <span className="rounded-full bg-primary-surface px-2 py-0.5 text-xs font-medium text-primary">
                              Perangkat ini
                            </span>
                          )}
                        </p>
                        <p className="text-muted-foreground">
                          {[session.browser, session.os].filter(Boolean).join(' · ') ||
                            'Browser tidak dikenal'}
                          {session.ipAddress ? ` · ${session.ipAddress}` : ''}
                        </p>
                        <p className="text-muted-foreground">
                          Aktif terakhir: {new Date(session.lastSeenAt).toLocaleString()}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={revokingId === session.id}
                        onClick={() => handleSignOutSession(session)}
                      >
                        {revokingId === session.id ? 'Memproses...' : 'Keluar'}
                      </Button>
                    </div>
                  ))
                )}
                {sessions && sessions.length === 0 && (
                  <p className="font-body text-sm text-muted-foreground">
                    Tidak ada perangkat aktif.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Danger zone - permanent account deletion, gated behind a typed
                confirmation so it can't happen on a stray click. */}
            <Card className="mt-10 border-destructive/50">
              <CardHeader>
                <CardTitle className="text-destructive">Hapus Akun</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="font-body text-sm text-muted-foreground">
                  Menghapus akun akan menghapus{' '}
                  <strong className="text-foreground">permanen</strong> seluruh video, klip, akun
                  sosial yang terhubung, dan datamu. Tindakan ini tidak bisa dibatalkan.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="delete-confirm">
                    Ketik <span className="font-mono text-destructive">{DELETE_CONFIRM_WORD}</span>{' '}
                    untuk konfirmasi
                  </Label>
                  <Input
                    id="delete-confirm"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder={DELETE_CONFIRM_WORD}
                    autoComplete="off"
                  />
                </div>
                {deleteAccountError && (
                  <p className="text-sm text-destructive">{deleteAccountError}</p>
                )}
                <Button
                  variant="destructive"
                  disabled={deleteConfirmText !== DELETE_CONFIRM_WORD || deletingAccount}
                  onClick={handleDeleteAccount}
                >
                  {deletingAccount ? 'Menghapus...' : 'Hapus Akun Saya Permanen'}
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
