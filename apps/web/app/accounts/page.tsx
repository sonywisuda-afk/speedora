'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ElevationDialog } from '../../components/ElevationDialog';
import { Nav } from '../../components/Nav';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PasswordInput } from '../../components/ui/password-input';
import {
  changePassword,
  confirmMfaEnrollment,
  deleteAccount,
  disableMfa,
  ElevationRequiredError,
  elevateSession,
  enrollMfa,
  getMfaStatus,
  listSessions,
  listTrustedDevices,
  logoutOthers,
  regenerateRecoveryCodes,
  revokeSession,
  revokeTrustedDevice,
  type MfaEnrollmentDto,
  type MfaStatusDto,
  type SessionDto,
  type TrustedDeviceDto,
} from '../../lib/api';
import { useAuth } from '../../lib/useAuth';

// Typed into the danger-zone field to unlock account deletion - a guard
// against an accidental single click wiping everything.
const DELETE_CONFIRM_WORD = 'HAPUS';

export default function AccountsPage() {
  const { user, setUser, checkingAuth, logout } = useAuth();
  const router = useRouter();

  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [changePasswordMessage, setChangePasswordMessage] = useState<string | null>(null);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);

  // Tahap 2 Step 2 Sprint 2b (Session Elevation) - elevationAction holds the
  // retried closure while the dialog is open (null = closed). One shared
  // dialog serves every RecentMfaGuard-protected action below (disable MFA,
  // regenerate recovery codes, change password, delete account) - see
  // runWithElevation.
  const [elevationAction, setElevationAction] = useState<(() => Promise<void>) | null>(null);
  const [elevationSubmitting, setElevationSubmitting] = useState(false);
  const [elevationError, setElevationError] = useState<string | null>(null);

  async function runWithElevation(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      if (err instanceof ElevationRequiredError) {
        setElevationAction(() => action);
        setElevationError(null);
        return;
      }
      throw err;
    }
  }

  async function handleElevationSubmit(credential: { code: string } | { password: string }) {
    if (!elevationAction) return;
    setElevationSubmitting(true);
    setElevationError(null);
    try {
      await elevateSession(credential);
      const action = elevationAction;
      setElevationAction(null);
      await action();
    } catch (err) {
      setElevationError(err instanceof Error ? err.message : 'Verifikasi gagal.');
    } finally {
      setElevationSubmitting(false);
    }
  }

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

  // Tahap 2 Step 2 Sprint 1 (MFA Foundation) - mfaStatus null means "not
  // fetched yet", same convention as sessions above. `enrollment` holds the
  // secret/QR while the two-step enroll -> confirm flow is in progress
  // (MfaController never enables MFA until confirm succeeds, so an
  // abandoned enrollment here just means the user never clicked
  // Konfirmasi). `recoveryCodes` is shown exactly once, right after a
  // successful confirm or regenerate, then dismissed for good - it is
  // never re-fetchable, matching the backend never returning it again.
  const [mfaStatus, setMfaStatus] = useState<MfaStatusDto | null>(null);
  const [mfaStatusError, setMfaStatusError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<MfaEnrollmentDto | null>(null);
  const [startingEnroll, setStartingEnroll] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmingMfa, setConfirmingMfa] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablingMfa, setDisablingMfa] = useState(false);
  const [disableActionError, setDisableActionError] = useState<string | null>(null);
  const [regeneratingCodes, setRegeneratingCodes] = useState(false);
  const [regenerateActionError, setRegenerateActionError] = useState<string | null>(null);

  // Tahap 2 Step 2 Sprint 2a (MFA Enforcement) - a trusted device is a
  // different concept from an active Session (a persistent MFA-skip grant
  // vs. a live login) - kept as its own sibling list rather than merged
  // into "Perangkat Aktif" above.
  const [trustedDevices, setTrustedDevices] = useState<TrustedDeviceDto[] | null>(null);
  const [trustedDevicesError, setTrustedDevicesError] = useState<string | null>(null);
  const [revokingTrustedDeviceId, setRevokingTrustedDeviceId] = useState<string | null>(null);

  async function fetchTrustedDevices() {
    try {
      setTrustedDevices(await listTrustedDevices());
      setTrustedDevicesError(null);
    } catch (err) {
      setTrustedDevicesError(
        err instanceof Error ? err.message : 'Gagal memuat perangkat terpercaya.',
      );
    }
  }

  async function handleRevokeTrustedDevice(id: string) {
    setRevokingTrustedDeviceId(id);
    try {
      await revokeTrustedDevice(id);
      await fetchTrustedDevices();
    } catch (err) {
      setTrustedDevicesError(
        err instanceof Error ? err.message : 'Gagal menghapus perangkat terpercaya.',
      );
    } finally {
      setRevokingTrustedDeviceId(null);
    }
  }

  async function fetchMfaStatus() {
    try {
      setMfaStatus(await getMfaStatus());
      setMfaStatusError(null);
    } catch (err) {
      setMfaStatusError(err instanceof Error ? err.message : 'Gagal memuat status 2FA.');
    }
  }

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
    fetchMfaStatus();
    fetchTrustedDevices();
    // Only ever meant to run once the user is known, same reasoning as
    // useAuth's own mount-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleStartEnroll() {
    setStartingEnroll(true);
    setMfaStatusError(null);
    try {
      setEnrollment(await enrollMfa());
      setConfirmCode('');
      setConfirmError(null);
    } catch (err) {
      setMfaStatusError(err instanceof Error ? err.message : 'Gagal memulai aktivasi 2FA.');
    } finally {
      setStartingEnroll(false);
    }
  }

  async function handleConfirmEnroll(e: FormEvent) {
    e.preventDefault();
    setConfirmError(null);
    setConfirmingMfa(true);
    try {
      const result = await confirmMfaEnrollment(confirmCode);
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      setConfirmCode('');
      await fetchMfaStatus();
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Kode verifikasi tidak valid.');
    } finally {
      setConfirmingMfa(false);
    }
  }

  // Tahap 2 Step 2 Sprint 2b (Session Elevation) - no longer collects a code
  // of its own; runWithElevation opens the shared ElevationDialog on the
  // server's elevationRequired response and retries this same closure once
  // elevated.
  async function handleDisableMfa() {
    setDisableActionError(null);
    setDisablingMfa(true);
    try {
      await runWithElevation(async () => {
        await disableMfa();
        await fetchMfaStatus();
      });
    } catch (err) {
      setDisableActionError(err instanceof Error ? err.message : 'Gagal menonaktifkan 2FA.');
    } finally {
      setDisablingMfa(false);
    }
  }

  async function handleRegenerateRecoveryCodes() {
    setRegenerateActionError(null);
    setRegeneratingCodes(true);
    try {
      await runWithElevation(async () => {
        const result = await regenerateRecoveryCodes();
        setRecoveryCodes(result.recoveryCodes);
        await fetchMfaStatus();
      });
    } catch (err) {
      setRegenerateActionError(
        err instanceof Error ? err.message : 'Gagal membuat ulang kode pemulihan.',
      );
    } finally {
      setRegeneratingCodes(false);
    }
  }

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
      await runWithElevation(async () => {
        await deleteAccount();
        // Session is already cleared server-side; drop the client user and
        // send them back to the entry page.
        setUser(null);
        router.push('/upload');
      });
    } catch (err) {
      setDeleteAccountError(err instanceof Error ? err.message : 'Gagal menghapus akun');
    } finally {
      setDeletingAccount(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setChangePasswordError(null);
    setChangePasswordMessage(null);
    setChangingPassword(true);
    try {
      await runWithElevation(async () => {
        await changePassword(newPassword);
        setChangePasswordMessage('Kata sandi berhasil diganti.');
        setNewPassword('');
      });
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
              <CardHeader>
                <CardTitle>Autentikasi Dua Faktor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {mfaStatusError && <p className="text-sm text-destructive">{mfaStatusError}</p>}

                {recoveryCodes && (
                  <div className="space-y-3 rounded-md border border-warning/50 bg-warning-surface p-4">
                    <p className="font-body text-sm font-medium text-foreground">
                      Simpan kode pemulihan ini sekarang - kode ini tidak akan ditampilkan lagi.
                    </p>
                    <div className="grid grid-cols-2 gap-2 font-mono text-sm text-foreground">
                      {recoveryCodes.map((code) => (
                        <span key={code} className="rounded bg-background px-2 py-1">
                          {code}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => navigator.clipboard.writeText(recoveryCodes.join('\n'))}
                      >
                        Salin Semua
                      </Button>
                      <Button type="button" size="sm" onClick={() => setRecoveryCodes(null)}>
                        Sudah Saya Simpan
                      </Button>
                    </div>
                  </div>
                )}

                {mfaStatus === null ? (
                  <p className="font-body text-sm text-muted-foreground">Memuat...</p>
                ) : enrollment ? (
                  <form onSubmit={handleConfirmEnroll} className="space-y-4">
                    <p className="font-body text-sm text-muted-foreground">
                      Pindai kode QR ini dengan aplikasi authenticator (Google Authenticator, Authy,
                      dll), atau masukkan kunci secara manual, lalu masukkan kode 6 digit yang
                      muncul.
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element -- server-generated data URL, not a static asset Next's image pipeline can optimize */}
                    <img
                      src={enrollment.qrCodeDataUrl}
                      alt="Kode QR 2FA"
                      className="h-40 w-40 rounded-md border border-border"
                    />
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      {enrollment.secret}
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="mfa-confirm-code">Kode Verifikasi</Label>
                      <Input
                        id="mfa-confirm-code"
                        required
                        autoComplete="one-time-code"
                        value={confirmCode}
                        onChange={(e) => setConfirmCode(e.target.value)}
                        placeholder="123456"
                      />
                    </div>
                    {confirmError && <p className="text-sm text-destructive">{confirmError}</p>}
                    <div className="flex gap-2">
                      <Button type="submit" disabled={confirmingMfa}>
                        {confirmingMfa ? 'Memverifikasi...' : 'Konfirmasi'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEnrollment(null);
                          setConfirmError(null);
                        }}
                      >
                        Batal
                      </Button>
                    </div>
                  </form>
                ) : mfaStatus.enabled ? (
                  <div className="space-y-4">
                    <p className="font-body text-sm text-muted-foreground">
                      2FA aktif sejak{' '}
                      {mfaStatus.enabledAt ? new Date(mfaStatus.enabledAt).toLocaleString() : '-'}.{' '}
                      {mfaStatus.recoveryCodesRemaining} kode pemulihan tersisa.
                    </p>

                    {regenerateActionError && (
                      <p className="text-sm text-destructive">{regenerateActionError}</p>
                    )}
                    {disableActionError && (
                      <p className="text-sm text-destructive">{disableActionError}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={regeneratingCodes}
                        onClick={handleRegenerateRecoveryCodes}
                      >
                        {regeneratingCodes ? 'Memproses...' : 'Buat Ulang Kode Pemulihan'}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={disablingMfa}
                        onClick={handleDisableMfa}
                      >
                        {disablingMfa ? 'Memproses...' : 'Nonaktifkan'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="font-body text-sm text-muted-foreground">
                      Tambahkan lapisan keamanan ekstra dengan kode sekali pakai dari aplikasi
                      authenticator setiap kali masuk.
                    </p>
                    <Button type="button" disabled={startingEnroll} onClick={handleStartEnroll}>
                      {startingEnroll ? 'Memproses...' : 'Aktifkan 2FA'}
                    </Button>
                  </div>
                )}
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

            <Card className="mt-10">
              <CardHeader>
                <CardTitle>Perangkat Terpercaya</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="font-body text-sm text-muted-foreground">
                  Perangkat yang melewati verifikasi 2FA saat masuk (berlaku hingga 60 hari).
                </p>
                {trustedDevicesError && (
                  <p className="text-sm text-destructive">{trustedDevicesError}</p>
                )}
                {trustedDevices === null ? (
                  <p className="font-body text-sm text-muted-foreground">Memuat...</p>
                ) : trustedDevices.length === 0 ? (
                  <p className="font-body text-sm text-muted-foreground">
                    Tidak ada perangkat terpercaya.
                  </p>
                ) : (
                  trustedDevices.map((device) => (
                    <div
                      key={device.id}
                      className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
                    >
                      <div className="min-w-0 font-body text-sm">
                        <p className="font-medium text-foreground">
                          {device.deviceName ?? 'Perangkat tidak dikenal'}
                        </p>
                        <p className="text-muted-foreground">
                          {[device.browser, device.os].filter(Boolean).join(' · ') ||
                            'Browser tidak dikenal'}
                          {device.ipAddress ? ` · ${device.ipAddress}` : ''}
                        </p>
                        <p className="text-muted-foreground">
                          Terakhir digunakan: {new Date(device.lastUsedAt).toLocaleString()}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={revokingTrustedDeviceId === device.id}
                        onClick={() => handleRevokeTrustedDevice(device.id)}
                      >
                        {revokingTrustedDeviceId === device.id ? 'Memproses...' : 'Hapus'}
                      </Button>
                    </div>
                  ))
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

            <ElevationDialog
              open={elevationAction !== null}
              mfaEnabled={mfaStatus?.enabled ?? false}
              submitting={elevationSubmitting}
              error={elevationError}
              onSubmit={handleElevationSubmit}
              onCancel={() => {
                setElevationAction(null);
                setElevationError(null);
              }}
            />
          </>
        )}
      </div>
    </main>
  );
}
