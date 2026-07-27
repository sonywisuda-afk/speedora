'use client';

import { useEffect, useState } from 'react';
import {
  BUILT_IN_PROCESSING_PRESETS,
  CaptionStyle,
  DEFAULT_PROCESSING_OPTIONS,
  FONT_FAMILIES,
  PLATFORM_METADATA,
  SocialPlatform,
  THUMBNAIL_SIGNALS,
  type BrandKitTemplateDto,
  type ProcessingOptions,
  type ProcessingPresetDto,
  type SocialAccount,
} from '@speedora/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createProcessingPreset,
  listBrandKitTemplates,
  listProcessingPresets,
  listSocialAccounts,
} from '@/lib/api';

const CLIP_COUNT_OPTIONS: (number | 'unlimited')[] = [1, 2, 3, 5, 10, 20, 'unlimited'];

const CAPTION_STYLE_LABELS: Record<CaptionStyle, string> = {
  [CaptionStyle.DEFAULT]: 'Default',
  [CaptionStyle.KARAOKE]: 'Karaoke',
  [CaptionStyle.BOLD_HIGHLIGHT]: 'Bold Highlight',
};

const EXPORT_QUALITY_LABELS: Record<
  NonNullable<ProcessingOptions['export']['qualityPreset']>,
  string
> = {
  maximum_quality: 'Maximum Quality',
  balanced: 'Balanced',
  small_size: 'Small Size',
};

// Section 7 (Highlight Detection) - a subset of @speedora/clip-scoring's own
// CLIP_INTENTS values (kept as plain strings here, same "don't import
// contracts into shared/web" convention documented on ProcessingOptions
// itself), each with a human label for the chip UI below.
const HIGHLIGHT_INTENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'educate', label: 'Edukasi' },
  { value: 'entertain', label: 'Hiburan' },
  { value: 'persuade', label: 'Persuasif' },
  { value: 'inspire', label: 'Inspirasi' },
  { value: 'story', label: 'Cerita' },
  { value: 'other', label: 'Lainnya' },
];

const MAX_ZOOM_IN_FRACTION_LIMIT = 0.6;

// Section 15 (Thumbnail Generation) - the SAME THUMBNAIL_SIGNALS vocabulary
// @speedora/thumbnail-selection already scores against, each with a human
// label for the chip UI below.
const THUMBNAIL_SIGNAL_LABELS: Record<(typeof THUMBNAIL_SIGNALS)[number], string> = {
  faceClarity: 'Kejelasan Wajah',
  emotion: 'Ekspresi',
  ocrImportance: 'Teks di Layar',
  gesture: 'Gestur',
  motion: 'Gerakan',
  composition: 'Komposisi',
};

// Sections from the original 24-section spec with no wired pipeline effect
// yet (see the Pre-Processing Settings roadmap plan) - shown honestly as
// not-yet-available rather than as working-looking controls.
const COMING_SOON_SECTIONS = [
  'Audio Processing (noise reduction, EQ, limiter, music separation)',
  'Video Enhancement (sharpen, HDR, stabilization, upscaling)',
  'AI Model selection (OCR / Face / Object detector, Fusion Engine version)',
  'Live GPU / cloud cost estimation',
  'Quality Validation pre-flight check list (Fase 0 design done, Phase 1 - file selection now happens before this screen; the actual Error/Warning/Info check list UI is Phase 3)',
];

const selectClassName =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 font-body text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

// Quality Validation roadmap (Fase 0 design, Phase 1) - shown after upload,
// once probing reaches PENDING_SETTINGS (previously shown before upload,
// when no file existed yet to probe) - see apps/web/app/upload/page.tsx.
// Every control here maps to a real,
// wired pipeline parameter (see @speedora/shared's ProcessingOptions);
// sections with no backend yet are listed honestly in COMING_SOON_SECTIONS
// instead of being built as non-functional toggles.
export function ProcessingSettings({
  onReady,
  onBack,
  submitting,
}: {
  onReady: (options: ProcessingOptions) => void;
  onBack: () => void;
  // Quality Validation roadmap (Fase 0 design, Phase 1) - onReady is now
  // async (it calls POST /videos/:id/start-processing) rather than a
  // synchronous local state update, so this guards against a double
  // submission while that request is in flight. Optional/defaults to false
  // - this component has no other caller besides apps/web/app/upload/page.tsx.
  submitting?: boolean;
}) {
  const [options, setOptions] = useState<ProcessingOptions>(DEFAULT_PROCESSING_OPTIONS);
  const [tagsInput, setTagsInput] = useState('');
  const [presets, setPresets] = useState<ProcessingPresetDto[]>([]);
  const [activePresetKey, setActivePresetKey] = useState<string | null>('balanced');
  const [savingPreset, setSavingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [presetError, setPresetError] = useState<string | null>(null);
  const [brandKitTemplates, setBrandKitTemplates] = useState<BrandKitTemplateDto[]>([]);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);

  useEffect(() => {
    listProcessingPresets()
      .then(({ presets }) => setPresets(presets))
      .catch(() => {
        // Best-effort - a failed fetch just means no saved presets show up,
        // the 5 built-in ones are still usable.
      });
    // Pre-Processing Settings roadmap (Phase 3) - only the requester's own
    // templates are ever listed here, so a templateId submitted from this
    // screen is always real and owned by the time detect-clips.worker.ts
    // resolves it (see that resolution's own comment on the one remaining
    // race - a template deleted between this fetch and the job running).
    listBrandKitTemplates()
      .then(({ templates }) => setBrandKitTemplates(templates))
      .catch(() => {
        // Best-effort - a failed fetch just means the template picker shows
        // no options; applyBrandKit's own checkbox still works.
      });
    // Same "only the requester's own, so always owned by job-run time"
    // reasoning as brandKitTemplates above.
    listSocialAccounts()
      .then(setSocialAccounts)
      .catch(() => {
        // Best-effort - a failed fetch just means no accounts show up to pick.
      });
  }, []);

  function applyPreset(key: string, config: ProcessingOptions) {
    setOptions(config);
    setTagsInput(config.project.tags.join(', '));
    setActivePresetKey(key);
  }

  function update(patch: Partial<ProcessingOptions>) {
    setOptions((prev) => ({ ...prev, ...patch }));
    setActivePresetKey(null);
  }

  function toggleHighlightIntent(intent: string) {
    const current = options.highlightFocus.intents;
    const next = current.includes(intent)
      ? current.filter((value) => value !== intent)
      : [...current, intent];
    update({ highlightFocus: { ...options.highlightFocus, intents: next } });
  }

  function toggleSeoPlatform(platform: SocialPlatform) {
    const current = options.seo.platforms;
    const next = current.includes(platform)
      ? current.filter((value) => value !== platform)
      : [...current, platform];
    update({ seo: { ...options.seo, platforms: next } });
  }

  function toggleSocialAccount(accountId: string) {
    const current = options.publishing.socialAccountIds;
    const next = current.includes(accountId)
      ? current.filter((value) => value !== accountId)
      : [...current, accountId];
    update({ publishing: { ...options.publishing, socialAccountIds: next } });
  }

  function toggleThumbnailSignal(signal: (typeof THUMBNAIL_SIGNALS)[number]) {
    const current = options.thumbnail.preferredSignals;
    const next = current.includes(signal)
      ? current.filter((value) => value !== signal)
      : [...current, signal];
    update({ thumbnail: { preferredSignals: next } });
  }

  async function handleSavePreset() {
    if (!newPresetName.trim()) return;
    setSavingPreset(true);
    setPresetError(null);
    try {
      const created = await createProcessingPreset({ name: newPresetName.trim(), config: options });
      setPresets((prev) => [...prev, created]);
      setNewPresetName('');
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : 'Gagal menyimpan preset.');
    } finally {
      setSavingPreset(false);
    }
  }

  function handleStart() {
    onReady({ ...options, project: { ...options.project, tags: parseTags(tagsInput) } });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg uppercase tracking-wide text-foreground">
          Pengaturan Pemrosesan
        </h2>
        <p className="mt-1 font-body text-sm text-muted-foreground">
          Sesuaikan cara video ini diproses, atau langsung mulai dengan pengaturan default.
        </p>
      </div>

      <SectionCard
        title="Informasi Proyek"
        description="Metadata tampilan saja - tidak memengaruhi hasil pemrosesan."
      >
        <div className="space-y-2">
          <Label htmlFor="project-name">Nama Proyek</Label>
          <Input
            id="project-name"
            value={options.project.name ?? ''}
            onChange={(e) =>
              update({ project: { ...options.project, name: e.target.value || null } })
            }
            placeholder="Contoh: Podcast Eps. 42"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-tags">Tag (pisahkan dengan koma)</Label>
          <Input
            id="project-tags"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Preset Pemrosesan"
        description="Pilih titik awal, lalu sesuaikan di bawah."
      >
        <div className="flex flex-wrap gap-2">
          {BUILT_IN_PROCESSING_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              size="sm"
              variant={activePresetKey === preset.key ? 'default' : 'outline'}
              onClick={() => applyPreset(preset.key, preset.config)}
              title={preset.description}
            >
              {preset.name}
            </Button>
          ))}
          {presets.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant={activePresetKey === preset.id ? 'default' : 'outline'}
              onClick={() => applyPreset(preset.id, preset.config)}
            >
              {preset.name}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Input
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            placeholder="Nama preset baru"
            className="max-w-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!newPresetName.trim() || savingPreset}
            onClick={() => void handleSavePreset()}
          >
            Simpan sebagai Preset
          </Button>
        </div>
        {presetError ? <p className="text-sm text-destructive">{presetError}</p> : null}
      </SectionCard>

      <SectionCard
        title="Pembuatan Klip"
        description="Jumlah klip dan batas durasi yang diminta dari AI."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="clip-count">Jumlah Klip</Label>
            <select
              id="clip-count"
              className={selectClassName}
              value={String(options.clipGeneration.clipCount ?? '')}
              onChange={(e) =>
                update({
                  clipGeneration: {
                    ...options.clipGeneration,
                    clipCount:
                      e.target.value === ''
                        ? null
                        : e.target.value === 'unlimited'
                          ? 'unlimited'
                          : Number(e.target.value),
                  },
                })
              }
            >
              <option value="">Default (AI menentukan)</option>
              {CLIP_COUNT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value === 'unlimited' ? 'Unlimited' : value}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="min-duration">Durasi Minimum (detik)</Label>
            <Input
              id="min-duration"
              type="number"
              min={1}
              value={options.clipGeneration.minClipDurationSeconds ?? ''}
              onChange={(e) =>
                update({
                  clipGeneration: {
                    ...options.clipGeneration,
                    minClipDurationSeconds: e.target.value ? Number(e.target.value) : null,
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-duration">Durasi Maksimum (detik)</Label>
            <Input
              id="max-duration"
              type="number"
              min={1}
              value={options.clipGeneration.maxClipDurationSeconds ?? ''}
              onChange={(e) =>
                update({
                  clipGeneration: {
                    ...options.clipGeneration,
                    maxClipDurationSeconds: e.target.value ? Number(e.target.value) : null,
                  },
                })
              }
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Highlight Detection"
        description="Prioritaskan jenis konten tertentu dan saring klip skor rendah - tidak menjamin hasil, hanya menggeser urutan seleksi AI yang sudah ada."
      >
        <div className="space-y-2">
          <Label>Jenis Konten Diprioritaskan</Label>
          <div className="flex flex-wrap gap-2">
            {HIGHLIGHT_INTENT_OPTIONS.map((intent) => {
              const active = options.highlightFocus.intents.includes(intent.value);
              return (
                <Button
                  key={intent.value}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  onClick={() => toggleHighlightIntent(intent.value)}
                >
                  {intent.label}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="space-y-2 sm:max-w-xs">
          <Label htmlFor="confidence-threshold">Ambang Skor Minimum (0-100)</Label>
          <Input
            id="confidence-threshold"
            type="number"
            min={0}
            max={100}
            value={options.highlightFocus.confidenceThreshold ?? ''}
            onChange={(e) =>
              update({
                highlightFocus: {
                  ...options.highlightFocus,
                  confidenceThreshold: e.target.value ? Number(e.target.value) : null,
                },
              })
            }
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Subtitle"
        description="Gaya default untuk setiap klip - bisa diubah lagi per-klip di editor."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="caption-style">Gaya</Label>
            <select
              id="caption-style"
              className={selectClassName}
              value={options.subtitle.captionStyle}
              onChange={(e) =>
                update({
                  subtitle: { ...options.subtitle, captionStyle: e.target.value as CaptionStyle },
                })
              }
            >
              {Object.values(CaptionStyle).map((style) => (
                <option key={style} value={style}>
                  {CAPTION_STYLE_LABELS[style]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="caption-font">Font</Label>
            <select
              id="caption-font"
              className={selectClassName}
              value={options.subtitle.fontFamily ?? ''}
              onChange={(e) =>
                update({
                  subtitle: {
                    ...options.subtitle,
                    fontFamily: (e.target.value ||
                      null) as ProcessingOptions['subtitle']['fontFamily'],
                  },
                })
              }
            >
              <option value="">Default Brand Kit</option>
              {FONT_FAMILIES.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2 pb-2">
            <input
              id="speaker-color-captions"
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={options.subtitle.speakerColorCaptions}
              onChange={(e) =>
                update({
                  subtitle: { ...options.subtitle, speakerColorCaptions: e.target.checked },
                })
              }
            />
            <Label htmlFor="speaker-color-captions">Warna per pembicara</Label>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Brand Assets"
        description="Terapkan branding ke klip video ini - tidak mengubah Brand Kit aktif Anda, hanya berlaku untuk video ini."
      >
        <div className="flex items-center gap-2">
          <input
            id="apply-brand-kit"
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={options.brandKit.applyBrandKit}
            onChange={(e) =>
              update({ brandKit: { ...options.brandKit, applyBrandKit: e.target.checked } })
            }
          />
          <Label htmlFor="apply-brand-kit">Terapkan Brand Kit ke klip video ini</Label>
        </div>
        {options.brandKit.applyBrandKit ? (
          <div className="space-y-2 sm:max-w-xs">
            <Label htmlFor="brand-kit-template">Template (opsional)</Label>
            <select
              id="brand-kit-template"
              className={selectClassName}
              value={options.brandKit.templateId ?? ''}
              onChange={(e) =>
                update({
                  brandKit: { ...options.brandKit, templateId: e.target.value || null },
                })
              }
            >
              <option value="">Brand Kit aktif saya (default)</option>
              {brandKitTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="SEO"
        description="Buat judul/deskripsi/hashtag khusus platform secara otomatis untuk setiap klip setelah selesai dirender - memakai LLM call nyata per platform per klip, jadi defaultnya mati."
      >
        <div className="flex items-center gap-2">
          <input
            id="auto-generate-platform-copy"
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={options.seo.autoGeneratePlatformCopy}
            onChange={(e) =>
              update({ seo: { ...options.seo, autoGeneratePlatformCopy: e.target.checked } })
            }
          />
          <Label htmlFor="auto-generate-platform-copy">
            Buat SEO copy otomatis setelah render selesai
          </Label>
        </div>
        {options.seo.autoGeneratePlatformCopy ? (
          <div className="space-y-2">
            <Label>Platform</Label>
            <div className="flex flex-wrap gap-2">
              {Object.values(SocialPlatform).map((platform) => {
                const active = options.seo.platforms.includes(platform);
                return (
                  <Button
                    key={platform}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    onClick={() => toggleSeoPlatform(platform)}
                  >
                    {PLATFORM_METADATA[platform].label}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Publishing"
        description="Publikasikan setiap klip otomatis ke akun yang sudah terhubung setelah render selesai - memakai alur publish/jadwal/retry yang sudah ada, jadi defaultnya mati."
      >
        <div className="flex items-center gap-2">
          <input
            id="auto-publish"
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={options.publishing.autoPublish}
            onChange={(e) =>
              update({ publishing: { ...options.publishing, autoPublish: e.target.checked } })
            }
          />
          <Label htmlFor="auto-publish">Publikasikan otomatis setelah render selesai</Label>
        </div>
        {options.publishing.autoPublish ? (
          <>
            <div className="space-y-2">
              <Label>Akun Terhubung</Label>
              {socialAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada akun terhubung - sambungkan akun dulu di halaman Accounts.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {socialAccounts.map((account) => {
                    const active = options.publishing.socialAccountIds.includes(account.id);
                    return (
                      <Button
                        key={account.id}
                        type="button"
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        onClick={() => toggleSocialAccount(account.id)}
                      >
                        {PLATFORM_METADATA[account.platform].label} - {account.displayName}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="space-y-2 sm:max-w-xs">
              <Label htmlFor="publish-scheduled-at">Jadwalkan (opsional)</Label>
              <Input
                id="publish-scheduled-at"
                type="datetime-local"
                value={
                  options.publishing.scheduledAt ? options.publishing.scheduledAt.slice(0, 16) : ''
                }
                onChange={(e) =>
                  update({
                    publishing: {
                      ...options.publishing,
                      scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                    },
                  })
                }
              />
              <p className="text-sm text-muted-foreground">
                Kosongkan untuk publikasi langsung setelah render selesai.
              </p>
            </div>
          </>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Thumbnail"
        description="Prioritaskan sinyal tertentu saat memilih frame thumbnail terbaik dalam klip - menyesuaikan bobot pemilihan yang sudah ada, bukan pemilih baru. Tidak mengubah klip mana yang jadi cover video (itu tetap otomatis berdasarkan skor)."
      >
        <div className="space-y-2">
          <Label>Prioritaskan Sinyal</Label>
          <div className="flex flex-wrap gap-2">
            {THUMBNAIL_SIGNALS.map((signal) => {
              const active = options.thumbnail.preferredSignals.includes(signal);
              return (
                <Button
                  key={signal}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  onClick={() => toggleThumbnailSignal(signal)}
                >
                  {THUMBNAIL_SIGNAL_LABELS[signal]}
                </Button>
              );
            })}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Smart Crop"
        description="Seberapa agresif kamera menzoom ke kata-kata penting - hanya menyesuaikan intensitas, bukan strategi crop (hanya ada satu algoritma di pipeline ini)."
      >
        <div className="space-y-2 sm:max-w-xs">
          <Label htmlFor="zoom-in-fraction">Intensitas Zoom (0-{MAX_ZOOM_IN_FRACTION_LIMIT})</Label>
          <Input
            id="zoom-in-fraction"
            type="number"
            min={0}
            max={MAX_ZOOM_IN_FRACTION_LIMIT}
            step={0.05}
            value={options.smartCrop.zoomInFraction ?? ''}
            onChange={(e) =>
              update({
                smartCrop: {
                  zoomInFraction: e.target.value ? Number(e.target.value) : null,
                },
              })
            }
            placeholder="Default (0.3)"
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Scene Analysis"
        description="Matikan deteksi yang tidak diperlukan untuk mempercepat pemrosesan - setiap deteksi yang dimatikan benar-benar dilewati, bukan dijalankan lalu diabaikan."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['detectSceneCuts', 'Deteksi Perpindahan Scene'],
              ['detectMotionEnergy', 'Analisis Energi Gerakan'],
              ['detectCameraMotion', 'Deteksi Gerakan Kamera'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <input
                id={key}
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={options.sceneAnalysis[key]}
                onChange={(e) =>
                  update({
                    sceneAnalysis: { ...options.sceneAnalysis, [key]: e.target.checked },
                  })
                }
              />
              <Label htmlFor={key}>{label}</Label>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Pengaturan Ekspor" description="Kualitas encode untuk hasil render.">
        <div className="space-y-2 sm:max-w-xs">
          <Label htmlFor="export-quality">Preset Kualitas</Label>
          <select
            id="export-quality"
            className={selectClassName}
            value={options.export.qualityPreset ?? ''}
            onChange={(e) =>
              update({
                export: {
                  qualityPreset:
                    (e.target.value as ProcessingOptions['export']['qualityPreset']) || null,
                },
              })
            }
          >
            <option value="">Default</option>
            {Object.entries(EXPORT_QUALITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </SectionCard>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Segera Hadir</CardTitle>
            <Badge variant="muted">Belum tersedia</Badge>
          </div>
          <CardDescription>
            Bagian ini ada di rencana produk tapi belum punya efek nyata di pipeline - sengaja tidak
            ditampilkan sebagai kontrol yang berfungsi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 font-body text-sm text-muted-foreground">
            {COMING_SOON_SECTIONS.map((section) => (
              <li key={section}>{section}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
          Kembali
        </Button>
        <Button type="button" onClick={handleStart} disabled={submitting}>
          {submitting ? 'Memulai...' : 'Mulai Pemrosesan AI'}
        </Button>
      </div>
    </div>
  );
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}
