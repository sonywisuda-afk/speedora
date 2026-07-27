'use client';

import {
  CaptionStyle,
  DEFAULT_INTRO_IMAGE_DURATION_SECONDS,
  FONT_FAMILIES,
  MAX_INTRO_DURATION_SECONDS,
  WATERMARK_POSITIONS,
  type WatermarkPosition,
} from '@speedora/shared';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Nav } from '@/components/Nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  applyBrandKitTemplate,
  brandKitIntroUrl,
  brandKitLogoUrl,
  brandKitOutroUrl,
  brandKitWatermarkUrl,
  createBrandKitTemplate,
  deleteBrandKitTemplate,
  deleteSubtitlePreset,
  getBrandKit,
  listBrandKitTemplates,
  listSubtitlePresets,
  listWorkspaces,
  removeBrandIntro,
  removeBrandOutro,
  removeBrandWatermark,
  renameBrandKitTemplate,
  updateBrandKit,
  uploadBrandIntro,
  uploadBrandLogo,
  uploadBrandOutro,
  uploadBrandWatermark,
} from '@/lib/api';
import { useAuth } from '@/lib/useAuth';
import { useWorkspaceStore } from '@/lib/workspaceStore';

// Same short labels TimelineEditor.tsx uses for the CaptionStyle toggle.
const CAPTION_STYLE_LABELS: Record<CaptionStyle, string> = {
  DEFAULT: 'Default',
  KARAOKE: 'Karaoke',
  BOLD_HIGHLIGHT: 'Bold Highlight',
};

// Watermark roadmap (P3c).
const WATERMARK_POSITION_LABELS: Record<WatermarkPosition, string> = {
  TOP_LEFT: 'Kiri Atas',
  TOP_RIGHT: 'Kanan Atas',
  BOTTOM_LEFT: 'Kiri Bawah',
  BOTTOM_RIGHT: 'Kanan Bawah',
  CENTER: 'Tengah',
};

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
// Watermark roadmap (P3c) - opacity/scale/margin are edited as whole
// percentages in this UI, converted to/from the 0-1 fractions the API and
// ffmpeg.ts actually use.
const DEFAULT_WATERMARK_OPACITY_PCT = 80;
const DEFAULT_WATERMARK_SCALE_PCT = 15;
const DEFAULT_WATERMARK_MARGIN_PCT = 3;

// Brand Kit roadmap (P3a) - flat top-level route, same shell convention as
// /campaigns/social/analytics. Workspace-level Brand Kit roadmap (P3g) -
// now reads useWorkspaceStore too: editing while the active workspace is
// the requester's personal one (or before workspaces have loaded) edits
// the same User fields as always; editing while a real team workspace is
// active edits that Workspace's own fields instead (requires EDITOR+
// there, enforced server-side - see BrandKitController.resolveTarget).
// export/BrandKitTab.tsx (the Export Center's own tab) stays a read-only
// summary + link to this page, always reading the PERSONAL kit (Brand
// Report is a User-scoped export, unaffected by which workspace is active
// here).
export default function BrandKitPage() {
  const { user, checkingAuth, logout } = useAuth();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { data: workspacesData } = useSWR(user ? 'workspaces' : null, listWorkspaces);
  const activeWorkspace = workspacesData?.workspaces.find((w) => w.id === activeWorkspaceId);
  // undefined means "edit my personal kit" (the pre-P3g default) - only a
  // real non-personal active workspace switches the editing target, same
  // "server defaults to personal workspace when omitted" posture every
  // other workspace-aware page already has.
  const workspaceParam =
    activeWorkspace && !activeWorkspace.isPersonal ? activeWorkspace.id : undefined;

  const {
    data: brandKit,
    error,
    isLoading,
    mutate,
  } = useSWR(user ? ['brand-kit', workspaceParam] : null, () => getBrandKit(workspaceParam));
  // Subtitle Presets roadmap (P3b) - saved from the Timeline Editor ("Simpan
  // sebagai preset"); this page is the manage/delete view, no duplicated
  // create form here.
  const {
    data: presetsData,
    error: presetsError,
    mutate: mutatePresets,
  } = useSWR(user ? 'subtitle-presets' : null, listSubtitlePresets);
  const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null);

  // Template Presets roadmap (P3f) - "save current Brand Kit as template" +
  // a switcher list. Independent SWR key/mutate, same "manage from Brand
  // Kit" split as Subtitle Presets above.
  const {
    data: templatesData,
    error: templatesError,
    mutate: mutateTemplates,
  } = useSWR(user ? 'brand-kit-templates' : null, listBrandKitTemplates);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);
  const [renamingTemplateId, setRenamingTemplateId] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [templateActionError, setTemplateActionError] = useState<string | null>(null);

  const [primaryColor, setPrimaryColor] = useState('');
  const [secondaryColor, setSecondaryColor] = useState('');
  const [fontFamily, setFontFamily] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Watermark roadmap (P3c) - null (not yet touched by the user) means
  // "read from brandKit"; once the user edits a field, that local value
  // wins until the next save/reload, same "local override until saved"
  // pattern primaryColor/secondaryColor/fontFamily above already use.
  const [uploadingWatermark, setUploadingWatermark] = useState(false);
  const [removingWatermark, setRemovingWatermark] = useState(false);
  const [watermarkOpacityPct, setWatermarkOpacityPct] = useState<number | null>(null);
  const [watermarkScalePct, setWatermarkScalePct] = useState<number | null>(null);
  const [watermarkMarginPct, setWatermarkMarginPct] = useState<number | null>(null);
  const [watermarkPosition, setWatermarkPosition] = useState<WatermarkPosition | null>(null);

  // Intro roadmap (P3d) - same "null means read from brandKit" pattern as
  // the watermark fields above. introImageDurationSeconds only matters when
  // the current intro is an image - a video's own duration isn't
  // user-editable (it plays at its own length, capped server-side).
  const [uploadingIntro, setUploadingIntro] = useState(false);
  const [removingIntro, setRemovingIntro] = useState(false);
  const [introImageDurationSeconds, setIntroImageDurationSeconds] = useState<number | null>(null);

  // Outro roadmap (P3e) - same shape as the intro state above.
  const [uploadingOutro, setUploadingOutro] = useState(false);
  const [removingOutro, setRemovingOutro] = useState(false);
  const [outroImageDurationSeconds, setOutroImageDurationSeconds] = useState<number | null>(null);

  const primary = primaryColor || brandKit?.primaryColor || '';
  const secondary = secondaryColor || brandKit?.secondaryColor || '';
  const font = fontFamily || brandKit?.fontFamily || '';
  const opacityPct =
    watermarkOpacityPct ??
    (brandKit?.watermarkOpacity != null
      ? Math.round(brandKit.watermarkOpacity * 100)
      : DEFAULT_WATERMARK_OPACITY_PCT);
  const scalePct =
    watermarkScalePct ??
    (brandKit?.watermarkScale != null
      ? Math.round(brandKit.watermarkScale * 100)
      : DEFAULT_WATERMARK_SCALE_PCT);
  const marginPct =
    watermarkMarginPct ??
    (brandKit?.watermarkMargin != null
      ? Math.round(brandKit.watermarkMargin * 100)
      : DEFAULT_WATERMARK_MARGIN_PCT);
  const position = watermarkPosition ?? brandKit?.watermarkPosition ?? 'BOTTOM_RIGHT';
  const imageDurationSeconds =
    introImageDurationSeconds ??
    brandKit?.introImageDurationSeconds ??
    DEFAULT_INTRO_IMAGE_DURATION_SECONDS;
  const outroImgDurationSeconds =
    outroImageDurationSeconds ??
    brandKit?.outroImageDurationSeconds ??
    DEFAULT_INTRO_IMAGE_DURATION_SECONDS;

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaveError(null);
    setUploading(true);
    try {
      const updated = await uploadBrandLogo(file, workspaceParam);
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
      const updated = await updateBrandKit(
        {
          primaryColor: primary || undefined,
          secondaryColor: secondary || undefined,
          fontFamily: font || undefined,
          watermarkOpacity: opacityPct / 100,
          watermarkScale: scalePct / 100,
          watermarkMargin: marginPct / 100,
          watermarkPosition: position,
          introImageDurationSeconds: imageDurationSeconds,
          outroImageDurationSeconds: outroImgDurationSeconds,
        },
        workspaceParam,
      );
      await mutate(updated, false);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal menyimpan Brand Kit');
    } finally {
      setSaving(false);
    }
  }

  async function handleWatermarkChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaveError(null);
    setUploadingWatermark(true);
    try {
      const updated = await uploadBrandWatermark(file, workspaceParam);
      await mutate(updated, false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal mengunggah watermark');
    } finally {
      setUploadingWatermark(false);
      e.target.value = '';
    }
  }

  async function handleRemoveWatermark() {
    setSaveError(null);
    setRemovingWatermark(true);
    try {
      await removeBrandWatermark(workspaceParam);
      await mutate({ ...brandKit!, watermarkUrl: null }, false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal menghapus watermark');
    } finally {
      setRemovingWatermark(false);
    }
  }

  async function handleIntroChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaveError(null);
    setUploadingIntro(true);
    try {
      const updated = await uploadBrandIntro(file, workspaceParam);
      await mutate(updated, false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal mengunggah intro');
    } finally {
      setUploadingIntro(false);
      e.target.value = '';
    }
  }

  async function handleRemoveIntro() {
    setSaveError(null);
    setRemovingIntro(true);
    try {
      await removeBrandIntro(workspaceParam);
      await mutate({ ...brandKit!, introUrl: null, introType: null }, false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal menghapus intro');
    } finally {
      setRemovingIntro(false);
    }
  }

  async function handleOutroChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaveError(null);
    setUploadingOutro(true);
    try {
      const updated = await uploadBrandOutro(file, workspaceParam);
      await mutate(updated, false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal mengunggah outro');
    } finally {
      setUploadingOutro(false);
      e.target.value = '';
    }
  }

  async function handleRemoveOutro() {
    setSaveError(null);
    setRemovingOutro(true);
    try {
      await removeBrandOutro(workspaceParam);
      await mutate({ ...brandKit!, outroUrl: null, outroType: null }, false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gagal menghapus outro');
    } finally {
      setRemovingOutro(false);
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

  async function handleCreateTemplate() {
    const name = newTemplateName.trim();
    if (!name) return;
    setTemplateActionError(null);
    setCreatingTemplate(true);
    try {
      await createBrandKitTemplate(name, workspaceParam);
      await mutateTemplates();
      setNewTemplateName('');
    } catch (err) {
      setTemplateActionError(err instanceof Error ? err.message : 'Gagal menyimpan template');
    } finally {
      setCreatingTemplate(false);
    }
  }

  async function handleApplyTemplate(id: string) {
    setTemplateActionError(null);
    setApplyingTemplateId(id);
    try {
      const updated = await applyBrandKitTemplate(id, workspaceParam);
      await mutate(updated, false);
      // Local field overrides (color/font/watermark inputs) were edited
      // relative to the OLD brandKit - clear them so the just-applied
      // template's values show immediately instead of stale local state.
      setPrimaryColor('');
      setSecondaryColor('');
      setFontFamily('');
      setWatermarkOpacityPct(null);
      setWatermarkScalePct(null);
      setWatermarkMarginPct(null);
      setWatermarkPosition(null);
      setIntroImageDurationSeconds(null);
      setOutroImageDurationSeconds(null);
    } catch (err) {
      setTemplateActionError(err instanceof Error ? err.message : 'Gagal menerapkan template');
    } finally {
      setApplyingTemplateId(null);
    }
  }

  async function handleRenameTemplate(id: string, currentName: string) {
    const name = window.prompt('Nama baru untuk template ini:', currentName)?.trim();
    if (!name || name === currentName) return;
    setTemplateActionError(null);
    setRenamingTemplateId(id);
    try {
      await renameBrandKitTemplate(id, name);
      await mutateTemplates();
    } catch (err) {
      setTemplateActionError(err instanceof Error ? err.message : 'Gagal mengganti nama template');
    } finally {
      setRenamingTemplateId(null);
    }
  }

  async function handleDeleteTemplate(id: string) {
    setTemplateActionError(null);
    setDeletingTemplateId(id);
    try {
      await deleteBrandKitTemplate(id);
      await mutateTemplates();
    } catch (err) {
      setTemplateActionError(err instanceof Error ? err.message : 'Gagal menghapus template');
    } finally {
      setDeletingTemplateId(null);
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
          {workspaceParam && (
            <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              Mengedit Brand Kit workspace:{' '}
              <span className="text-foreground">{activeWorkspace?.name}</span>
            </p>
          )}
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
              <p className="mt-4 font-body text-sm text-destructive">Gagal memuat Brand Kit</p>
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
                        src={brandKitLogoUrl(workspaceParam)}
                        crossOrigin="use-credentials"
                        alt="Logo brand"
                        className="h-20 w-20 rounded-md border border-border bg-muted object-contain"
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
                    Dipakai untuk membakar caption ke setiap clip baru dari akun ini (kecuali
                    dimatikan per-clip).
                  </p>
                  <select
                    value={font}
                    onChange={(e) => setFontFamily(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 font-body text-sm text-foreground"
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
                    Watermark
                  </Label>
                  <p className="font-body text-xs text-muted-foreground">
                    Diterapkan ke setiap clip baru (bisa dimatikan per-clip di editor).
                  </p>
                  <div className="flex items-center gap-4">
                    {brandKit.watermarkUrl ? (
                      <img
                        src={brandKitWatermarkUrl(workspaceParam)}
                        crossOrigin="use-credentials"
                        alt="Watermark brand"
                        className="h-20 w-20 rounded-md border border-border bg-muted object-contain"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-border font-mono text-[10px] text-muted-foreground">
                        Kosong
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <label>
                        <Button size="sm" variant="outline" asChild disabled={uploadingWatermark}>
                          <span>{uploadingWatermark ? 'Mengunggah...' : 'Unggah Watermark'}</span>
                        </Button>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/svg+xml"
                          onChange={handleWatermarkChange}
                          disabled={uploadingWatermark}
                          className="hidden"
                        />
                      </label>
                      {brandKit.watermarkUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={removingWatermark}
                          onClick={handleRemoveWatermark}
                          className="text-destructive hover:text-destructive"
                        >
                          {removingWatermark ? 'Menghapus...' : 'Hapus Watermark'}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-[10px] text-muted-foreground">Posisi</span>
                      <select
                        value={position}
                        onChange={(e) => setWatermarkPosition(e.target.value as WatermarkPosition)}
                        className="h-9 rounded-md border border-input bg-background px-3 font-body text-sm text-foreground"
                      >
                        {WATERMARK_POSITIONS.map((pos) => (
                          <option key={pos} value={pos}>
                            {WATERMARK_POSITION_LABELS[pos]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        Opacity (%)
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={opacityPct}
                        onChange={(e) => setWatermarkOpacityPct(Number(e.target.value))}
                        className="w-20"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        Ukuran (% lebar video)
                      </span>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={scalePct}
                        onChange={(e) => setWatermarkScalePct(Number(e.target.value))}
                        className="w-20"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        Margin (% lebar video)
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={50}
                        value={marginPct}
                        onChange={(e) => setWatermarkMarginPct(Number(e.target.value))}
                        className="w-20"
                      />
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Intro
                  </Label>
                  <p className="font-body text-xs text-muted-foreground">
                    Video atau gambar yang diputar sebelum setiap clip baru (bisa dimatikan per-clip
                    di editor). Video diputar dengan durasi aslinya (maks.{' '}
                    {MAX_INTRO_DURATION_SECONDS} detik); gambar ditahan selama durasi di bawah.
                  </p>
                  <div className="flex items-center gap-4">
                    {brandKit.introUrl ? (
                      brandKit.introType === 'video' ? (
                        <video
                          src={brandKitIntroUrl(workspaceParam)}
                          crossOrigin="use-credentials"
                          muted
                          className="h-20 w-20 rounded-md border border-border bg-muted object-contain"
                        />
                      ) : (
                        <img
                          src={brandKitIntroUrl(workspaceParam)}
                          crossOrigin="use-credentials"
                          alt="Intro brand"
                          className="h-20 w-20 rounded-md border border-border bg-muted object-contain"
                        />
                      )
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-border font-mono text-[10px] text-muted-foreground">
                        Kosong
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <label>
                        <Button size="sm" variant="outline" asChild disabled={uploadingIntro}>
                          <span>{uploadingIntro ? 'Mengunggah...' : 'Unggah Intro'}</span>
                        </Button>
                        <input
                          type="file"
                          accept="video/mp4,video/quicktime,image/png,image/jpeg,image/webp"
                          onChange={handleIntroChange}
                          disabled={uploadingIntro}
                          className="hidden"
                        />
                      </label>
                      {brandKit.introUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={removingIntro}
                          onClick={handleRemoveIntro}
                          className="text-destructive hover:text-destructive"
                        >
                          {removingIntro ? 'Menghapus...' : 'Hapus Intro'}
                        </Button>
                      )}
                    </div>
                  </div>

                  {brandKit.introType === 'image' && (
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        Durasi gambar (detik)
                      </span>
                      <Input
                        type="number"
                        min={0.5}
                        max={MAX_INTRO_DURATION_SECONDS}
                        step={0.5}
                        value={imageDurationSeconds}
                        onChange={(e) => setIntroImageDurationSeconds(Number(e.target.value))}
                        className="w-20"
                      />
                    </div>
                  )}
                </section>

                <section className="space-y-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Outro
                  </Label>
                  <p className="font-body text-xs text-muted-foreground">
                    Video atau gambar yang diputar setelah setiap clip baru (bisa dimatikan per-clip
                    di editor). Video diputar dengan durasi aslinya (maks.{' '}
                    {MAX_INTRO_DURATION_SECONDS} detik); gambar ditahan selama durasi di bawah.
                  </p>
                  <div className="flex items-center gap-4">
                    {brandKit.outroUrl ? (
                      brandKit.outroType === 'video' ? (
                        <video
                          src={brandKitOutroUrl(workspaceParam)}
                          crossOrigin="use-credentials"
                          muted
                          className="h-20 w-20 rounded-md border border-border bg-muted object-contain"
                        />
                      ) : (
                        <img
                          src={brandKitOutroUrl(workspaceParam)}
                          crossOrigin="use-credentials"
                          alt="Outro brand"
                          className="h-20 w-20 rounded-md border border-border bg-muted object-contain"
                        />
                      )
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-border font-mono text-[10px] text-muted-foreground">
                        Kosong
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <label>
                        <Button size="sm" variant="outline" asChild disabled={uploadingOutro}>
                          <span>{uploadingOutro ? 'Mengunggah...' : 'Unggah Outro'}</span>
                        </Button>
                        <input
                          type="file"
                          accept="video/mp4,video/quicktime,image/png,image/jpeg,image/webp"
                          onChange={handleOutroChange}
                          disabled={uploadingOutro}
                          className="hidden"
                        />
                      </label>
                      {brandKit.outroUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={removingOutro}
                          onClick={handleRemoveOutro}
                          className="text-destructive hover:text-destructive"
                        >
                          {removingOutro ? 'Menghapus...' : 'Hapus Outro'}
                        </Button>
                      )}
                    </div>
                  </div>

                  {brandKit.outroType === 'image' && (
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        Durasi gambar (detik)
                      </span>
                      <Input
                        type="number"
                        min={0.5}
                        max={MAX_INTRO_DURATION_SECONDS}
                        step={0.5}
                        value={outroImgDurationSeconds}
                        onChange={(e) => setOutroImageDurationSeconds(Number(e.target.value))}
                        className="w-20"
                      />
                    </div>
                  )}
                </section>

                <section className="space-y-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Preset Subtitle
                  </Label>
                  <p className="font-body text-xs text-muted-foreground">
                    Preset yang sudah Anda simpan dari Timeline Editor (&quot;Simpan sebagai
                    preset&quot;).
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
                          className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-3 py-2"
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

                <section className="space-y-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Template Brand Kit
                  </Label>
                  <p className="font-body text-xs text-muted-foreground">
                    Simpan kombinasi logo, warna, font, watermark, intro, dan outro saat ini sebagai
                    template bernama, lalu beralih di antara beberapa template kapan pun.
                  </p>

                  <div className="flex items-center gap-2">
                    <Input
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      placeholder="Nama template, contoh: Kampanye Musim Panas"
                      className="max-w-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={creatingTemplate || !newTemplateName.trim()}
                      onClick={handleCreateTemplate}
                    >
                      {creatingTemplate ? 'Menyimpan...' : 'Simpan sebagai template'}
                    </Button>
                  </div>

                  {templatesError && (
                    <p className="font-body text-xs text-destructive">Gagal memuat template</p>
                  )}
                  {templatesData && templatesData.templates.length === 0 && (
                    <p className="font-body text-xs text-muted-foreground">
                      Belum ada template tersimpan.
                    </p>
                  )}
                  {templatesData && templatesData.templates.length > 0 && (
                    <ul className="space-y-2">
                      {templatesData.templates.map((template) => (
                        <li
                          key={template.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-body text-sm text-foreground">
                              {template.name}
                            </p>
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {template.fontFamily ?? 'Default (Inter)'}
                              {template.primaryColor ? ` · ${template.primaryColor}` : ''}
                              {template.hasWatermark
                                ? ` · Watermark: ${WATERMARK_POSITION_LABELS[template.watermarkPosition ?? 'BOTTOM_RIGHT']}`
                                : ''}
                              {template.hasIntro ? ` · Intro: ${template.introType}` : ''}
                              {template.hasOutro ? ` · Outro: ${template.outroType}` : ''}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={applyingTemplateId === template.id}
                              onClick={() => handleApplyTemplate(template.id)}
                            >
                              {applyingTemplateId === template.id ? 'Menerapkan...' : 'Terapkan'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={renamingTemplateId === template.id}
                              onClick={() => handleRenameTemplate(template.id, template.name)}
                            >
                              {renamingTemplateId === template.id ? 'Mengubah...' : 'Ganti Nama'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={deletingTemplateId === template.id}
                              onClick={() => handleDeleteTemplate(template.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              {deletingTemplateId === template.id ? 'Menghapus...' : 'Hapus'}
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {templateActionError && (
                    <p className="font-body text-xs text-destructive">{templateActionError}</p>
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

                {saveError && <p className="font-body text-xs text-destructive">{saveError}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
