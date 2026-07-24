'use client';

import { CaptionStyle, FONT_FAMILIES } from '@speedora/shared';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Nav } from '@/components/Nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  brandKitLogoUrl,
  deleteSubtitlePreset,
  getBrandKit,
  listSubtitlePresets,
  updateBrandKit,
  uploadBrandLogo,
} from '@/lib/api';
import { useAuth } from '@/lib/useAuth';

// Same short labels TimelineEditor.tsx uses for the CaptionStyle toggle.
const CAPTION_STYLE_LABELS: Record<CaptionStyle, string> = {
  DEFAULT: 'Default',
  KARAOKE: 'Karaoke',
  BOLD_HIGHLIGHT: 'Bold Highlight',
};

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Brand Kit roadmap (P3a) - flat top-level route reading useAuth() only, not
// useWorkspaceStore - same shell convention as /campaigns/social/analytics,
// but Brand Kit today is a User-scoped resource (not Workspace-scoped),
// so there's no active-workspace gate. Workspace-level Brand Kit (P3g) is
// planned as an additive sibling, not a replacement, so this page will gain
// workspace-awareness later without changing what it edits today.
// export/BrandKitTab.tsx (the Export Center's own tab) becomes a read-only
// summary + link to this page once this ships, rather than duplicating the
// editing UI in two places.
export default function BrandKitPage() {
  const { user, checkingAuth, logout } = useAuth();
  const { data: brandKit, error, isLoading, mutate } = useSWR(
    user ? 'brand-kit' : null,
    getBrandKit,
  );
  // Subtitle Presets roadmap (P3b) - saved from the Timeline Editor ("Simpan
  // sebagai preset"); this page is the manage/delete view, no duplicated
  // create form here.
  const {
    data: presetsData,
    error: presetsError,
    mutate: mutatePresets,
  } = useSWR(user ? 'subtitle-presets' : null, listSubtitlePresets);
  const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null);

  const [primaryColor, setPrimaryColor] = useState('');
  const [secondaryColor, setSecondaryColor] = useState('');
  const [fontFamily, setFontFamily] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const primary = primaryColor || brandKit?.primaryColor || '';
  const secondary = secondaryColor || brandKit?.secondaryColor || '';
  const font = fontFamily || brandKit?.fontFamily || '';

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaveError(null);
    setUploading(true);
    try {
      const updated = await uploadBrandLogo(file);
      await mutate(updated, false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal mengunggah logo');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleSave() {
    setSaveError(null);
    setSaved(false);
    if (primary && !HEX_COLOR_PATTERN.test(primary)) {
      setSaveError('Warna utama harus format hex, contoh: #1D4ED8');
      return;
    }
    if (secondary && !HEX_COLOR_PATTERN.test(secondary)) {
      setSaveError('Warna sekunder harus format hex, contoh: #1D4ED8');
      return;
    }
    setSaving(true);
    try {
      const updated = await updateBrandKit({
        primaryColor: primary || undefined,
        secondaryColor: secondary || undefined,
        fontFamily: font || undefined,
      });
      await mutate(updated, false);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal menyimpan Brand Kit');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePreset(id: string) {
    setDeletingPresetId(id);
    try {
      await deleteSubtitlePreset(id);
      await mutatePresets();
    } finally {
      setDeletingPresetId(null);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-2xl">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide text-foreground">
            Brand Kit
          </h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            Logo, warna, dan font ini diterapkan otomatis ke setiap clip baru (bisa dimatikan
            per-clip di editor), dan dipakai di Laporan Brand pada Export Center.
          </p>
        </div>

        {checkingAuth ? null : !user ? (
          <p className="mt-8 font-body text-sm text-muted-foreground">
            <Link href="/upload" className="underline">
              Masuk
            </Link>{' '}
            untuk mengatur Brand Kit.
          </p>
        ) : (
          <>
            <Nav user={user} onLogout={logout} />

            {error && (
              <p className="mt-4 font-body text-sm text-destructive">
                Gagal memuat Brand Kit
              </p>
            )}

            {!isLoading && brandKit && (
              <div className="mt-8 space-y-8">
                <section className="space-y-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Logo Brand
                  </Label>
                  <div className="flex items-center gap-4">
                    {brandKit.logoUrl ? (
                      <img
                        src={brandKitLogoUrl()}
                        crossOrigin="use-credentials"
                        alt="Logo brand"
                        className="h-20 w-20 rounded-md border border-border bg-slate-panel object-contain"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-border font-mono text-[10px] text-muted-foreground">
                        Kosong
                      </div>
                    )}
                    <label>
                      <Button size="sm" variant="outline" asChild disabled={uploading}>
                        <span>{uploading ? 'Mengunggah...' : 'Unggah Logo'}</span>
                      </Button>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoChange}
                        disabled={uploading}
                        className="hidden"
                      />
                    </label>
                  </div>
                </section>

                <section className="space-y-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Warna Brand
                  </Label>
                  <div className="flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={HEX_COLOR_PATTERN.test(primary) ? primary : '#000000'}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        className="h-9 w-9 rounded border border-border bg-transparent"
                        aria-label="Warna utama"
                      />
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] text-muted-foreground">Utama</span>
                        <Input
                          value={primary}
                          onChange={(e) => setPrimaryColor(e.target.value)}
                          placeholder="#1D4ED8"
                          className="w-28"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={HEX_COLOR_PATTERN.test(secondary) ? secondary : '#000000'}
                        onChange={(e) => setSecondaryColor(e.target.value)}
                        className="h-9 w-9 rounded border border-border bg-transparent"
                        aria-label="Warna sekunder"
                      />
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          Sekunder
                        </span>
                        <Input
                          value={secondary}
                          onChange={(e) => setSecondaryColor(e.target.value)}
                          placeholder="#1D4ED8"
                          className="w-28"
                        />
                      </div>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Font Caption
                  </Label>
                  <p className="font-body text-xs text-muted-foreground">
                    Dipakai untuk membakar caption ke setiap clip baru dari akun ini
                    (kecuali dimatikan per-clip).
                  </p>
                  <select
                    value={font}
                    onChange={(e) => setFontFamily(e.target.value)}
                    className="h-9 rounded-md border border-input bg-slate-panel px-3 font-body text-sm text-foreground"
                  >
                    <option value="">Default (Inter)</option>
                    {FONT_FAMILIES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </section>

                <section className="space-y-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Preset Subtitle
                  </Label>
                  <p className="font-body text-xs text-muted-foreground">
                    Preset yang sudah Anda simpan dari Timeline Editor (&quot;Simpan sebagai preset&quot;).
                  </p>
                  {presetsError && (
                    <p className="font-body text-xs text-destructive">Gagal memuat preset</p>
                  )}
                  {presetsData && presetsData.presets.length === 0 && (
                    <p className="font-body text-xs text-muted-foreground">
                      Belum ada preset tersimpan.
                    </p>
                  )}
                  {presetsData && presetsData.presets.length > 0 && (
                    <ul className="space-y-2">
                      {presetsData.presets.map((preset) => (
                        <li
                          key={preset.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border bg-slate-panel px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-body text-sm text-foreground">
                              {preset.name}
                            </p>
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {CAPTION_STYLE_LABELS[preset.captionStyle]} ·{' '}
                              {preset.fontFamily ?? 'Default (Inter)'} · Warna speaker:{' '}
                              {preset.speakerColorCaptions ? 'Ya' : 'Tidak'}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={deletingPresetId === preset.id}
                            onClick={() => handleDeletePreset(preset.id)}
                            className="shrink-0 text-destructive hover:text-destructive"
                          >
                            {deletingPresetId === preset.id ? 'Menghapus...' : 'Hapus'}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <div className="flex items-center gap-3">
                  <Button disabled={saving} onClick={handleSave}>
                    {saving ? 'Menyimpan...' : 'Simpan Brand Kit'}
                  </Button>
                  {saved && !saveError && (
                    <span className="font-body text-xs text-muted-foreground">Tersimpan.</span>
                  )}
                </div>

                {saveError && (
                  <p className="font-body text-xs text-destructive">{saveError}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
