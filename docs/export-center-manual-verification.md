# Export Center — Manual Verification Checklist

Complements automated testing (`apps/api`'s Jest suite already covers ownership 404s, header
correctness, and content generation for every route below — see `videos.controller.spec.ts`,
`videos.service.spec.ts`, `video-report.util.spec.ts`, `clip-metadata.util.spec.ts`,
`transcript-export.util.spec.ts`, `csv.util.spec.ts`). This checklist exists for what automated
tests structurally can't verify: whether a real browser download behaves correctly, and whether
the files actually open cleanly in the real-world tools people use (Excel, VLC). Run it once per
PR that touches Export Center routes, before merging.

## Scope

Sprint 03a-03e are all shipped as of 2026-07-17: sync CSV/JSON/TXT/SRT/VTT downloads (03b), async
PDF via `ExportJob`+BullMQ (03c), Excel/Highlight Report/Brand Report + Brand Kit (03d), and the
`ExportCenterDialog` frontend UI wiring all of it together (03e). Export format expansion (Phase
D, 2026-08-01) added two more sync formats (`report.md`/`report.html`, same route/DTO/UI pattern
as the existing 7) and one more async type (`PPTX`, same `ExportJob` pattern as `EXCEL`) — see
that section's own checklist items below, they don't get a separate doc. This doc has two
sections: the **API-level** checklist below (direct URLs, useful for verifying backend behavior
in isolation) and the **Frontend UI** checklist further down (the actual user-facing flow through
`/videos/:id/edit`'s Export button — the more relevant one to run end-to-end before merging).

## Setup

- [ ] `apps/api` dev server running (`pnpm --filter @speedora/api start:dev`)
- [ ] Logged in via the browser at `localhost:3000` (the session cookie is also sent to
      `localhost:3001`, so export URLs can be opened directly in the same browser tab/window)
- [ ] Have the id of a video you own with at least one rendered clip — check via
      `GET /videos` or the dashboard's Recent Projects grid; any `RENDERED`-status video works

## Per-format check

Base URL: `http://localhost:3001/videos/<VIDEO_ID>/export/`

| Route | Expected `Content-Type` | Expected filename |
|---|---|---|
| `report.json` | `application/json; charset=utf-8` | `video-<VIDEO_ID>-report.json` |
| `report.csv` | `text/csv; charset=utf-8` | `video-<VIDEO_ID>-report.csv` |
| `report.md` | `text/markdown; charset=utf-8` | `video-<VIDEO_ID>-report.md` |
| `report.html` | `text/html; charset=utf-8` | `video-<VIDEO_ID>-report.html` |
| `clip-metadata.json` | `application/json; charset=utf-8` | `video-<VIDEO_ID>-clip-metadata.json` |
| `clip-metadata.csv` | `text/csv; charset=utf-8` | `video-<VIDEO_ID>-clip-metadata.csv` |
| `transcript.txt` | `text/plain; charset=utf-8` | `video-<VIDEO_ID>-transcript.txt` |
| `captions.srt` | `application/x-subrip; charset=utf-8` | `video-<VIDEO_ID>-captions.srt` |
| `captions.vtt` | `text/vtt; charset=utf-8` | `video-<VIDEO_ID>-captions.vtt` |

- [ ] Export `report.json` — downloads, and opening it (editor or DevTools → Preview) shows valid
      JSON with all 11 sections present: `cover`, `videoSummary`, `timeline`, `highlight`,
      `topMoments`, `faceAnalysis`, `speechAnalysis`, `ocrSummary`, `keyword`, `cta`, `thumbnail`
- [ ] Export `report.csv`
- [ ] Export `report.md` — opens as valid Markdown (VS Code preview or GitHub upload); confirm a
      clip whose `hookText`/`highlightReason`/keywords contain `*`, `_`, `` ` ``, `[]`, `#`, or `<>`
      render as literal characters, never as unintended emphasis/links/headings or raw HTML
      (`video-report.util.ts`'s `escapeMarkdown()` is unit-tested for this, but a real render is
      the only way to see it visually)
- [ ] Export `report.html` — opens directly in a browser (double-click or drag into a tab), same
      dark-input/light-output styling every time, no broken layout
- [ ] Export `clip-metadata.json`
- [ ] Export `clip-metadata.csv`
- [ ] Export `transcript.txt`
- [ ] Export `captions.srt`
- [ ] Export `captions.vtt`
- [ ] Downloaded filename matches the table above (not a generic browser-assigned name)
- [ ] `Content-Type` matches the table above (DevTools → Network → the request → Response Headers)
- [ ] **UTF-8 is correct** — both CSV routes are BOM-prefixed (U+FEFF, invisible) specifically for Excel
      compatibility (Excel ignores the `Content-Type` charset for CSV and falls back to the
      system codepage without a BOM); JSON/TXT/SRT/VTT are UTF-8-native and don't need a BOM
- [ ] **CSV opens correctly in Excel** — double-click to open `report.csv`/`clip-metadata.csv`
      directly (not the import wizard), confirm no mangled characters (e.g. `Ã©` instead of the
      real character) in any text column
- [ ] **Subtitles open correctly in VLC** — drag `captions.srt` and `captions.vtt` onto VLC (or
      Media → Open File), confirm cue text and timing display correctly, no broken/empty lines
- [ ] Ownership still enforced — a different account (or logged out) cannot access these routes
      for a video it doesn't own
- [ ] **404 for a video that isn't the user's** — try
      `.../videos/some-nonexistent-id/export/report.json`, expect 404, not a 500 or a 200

## Frontend UI (Sprint 03e)

Setup tambahan (di luar setup di atas):

- [ ] `apps/worker` dev process jalan (`pnpm --filter @speedora/worker dev`) — tanpa ini, job
      `EXPORT_GENERATE` (PDF/Excel/Highlight Report/Brand Report) akan macet selamanya di status
      `PENDING`, tidak pernah pindah ke `PROCESSING`/`READY`. Cek log startup-nya menyebut
      `"queueCount":8` (7 job pipeline lama + `export-generate` baru) — kalau angkanya beda,
      berarti worker belum memuat kode 03c/03d yang terbaru.
- [ ] `apps/web` dev server jalan (`pnpm --filter @speedora/web dev`, default `localhost:3000`)
- [ ] Login lewat browser di `localhost:3000`, buka `/videos/<VIDEO_ID>/edit` untuk video yang
      sudah `RENDERED`

Checklist:

- [ ] **Dialog muncul** — tombol "Export" ada di kanan atas halaman edit (di atas
      `VideoAnalysisDashboard`), klik memunculkan Dialog "Export Center"
- [ ] **Semua tab tampil** — 3 tab (Unduh Cepat, Laporan, Brand Kit), masing-masing bisa diklik
      dan menampilkan isi yang berbeda
- [ ] **Semua tombol download** (tab Unduh Cepat) — 9 tombol, satu per format (lihat tabel API di
      atas untuk nama file/Content-Type yang diharapkan tiap tombol)
- [ ] **Generate PDF** (tab Laporan) — klik "Generate" di baris PDF, badge status muncul dan
      berubah dari "Menunggu"/"Memproses" → "Siap"
- [ ] **Generate Excel** — sama, di baris Excel
- [ ] **Generate PowerPoint** — sama, di baris "PowerPoint — Laporan Lengkap". Setelah "Siap",
      unduh dan **buka file `.pptx` yang sebenarnya di aplikasi presentasi nyata** (Microsoft
      PowerPoint, LibreOffice Impress, atau import ke Google Slides) — ini belum pernah diverifikasi
      otomatis, hanya divalidasi sebagai arsip ZIP/OOXML yang sah (`unzip -l`, struktur
      `ppt/slides/*.xml` sesuai, `pptxgenjs` mengonfirmasi meng-escape karakter `<`/`>`/`&`/`"`
      dengan benar di setiap `addText()`/`addTable()`) - lihat 4 slide-nya (Cover, Ringkasan +
      Timeline, Detail Klip, Analisis AI) benar-benar terbuka tanpa "file rusak"/repair-prompt di
      ketiga aplikasi, dan ukuran file wajar untuk deck teks-only tanpa gambar (fixture 4-slide
      referensi ada di kisaran 75-80 KB — jauh lebih besar dari itu untuk video dengan sedikit klip
      berarti ada aset yang tidak seharusnya ikut ter-embed)
- [ ] **Progress polling** — status berubah otomatis tanpa refresh manual (SWR polling tiap ~2
      detik, lihat `ExportTypeRow`'s `refreshInterval`) — coba buka DevTools → Network, harus
      terlihat request `GET /export/:id` berulang selama status masih `PENDING`/`PROCESSING`,
      berhenti begitu `READY`/`FAILED`
- [ ] **Download selesai** — klik "Unduh" pada baris yang sudah "Siap", file benar-benar
      terunduh (bukan cuma UI berubah)
- [ ] **Brand Kit upload** (tab Brand Kit) — pilih file gambar, preview logo muncul segera
      setelah upload selesai (tanpa perlu klik Save terpisah)
- [ ] **Warna tersimpan** — isi warna utama/sekunder (hex, boleh lewat color picker atau ketik
      langsung), klik "Simpan Warna", tidak ada pesan error validasi

- [ ] **Refresh browser** — reload halaman `/videos/:id/edit`, buka lagi Export Center → tab
      Brand Kit: logo dan warna yang tadi disimpan harus masih tampil (datanya dari server via
      `GET /brand-kit`, bukan state lokal, jadi ini seharusnya bertahan)
- [ ] **Download ulang** — **diperbaiki oleh "Recent Exports / Persistent Export History"**:
      `ExportCenterDialog` sekarang mengambil `GET /export?videoId=` setiap kali dialog dibuka dan
      men-seed tiap `ExportTypeRow` dari job terbaru per tipe (`initialJob`). Generate PDF/Excel
      sampai `READY`, lalu tutup dialog (atau refresh halaman `/videos/:id/edit`) dan buka lagi
      Export Center → tab Laporan: baris itu harus langsung menampilkan status `READY` + tombol
      "Unduh" (tanpa perlu generate ulang), plus tombol sekunder "Generate Ulang" di sebelahnya.
      Job `FAILED` harus menampilkan pesan gagal + tombol "Coba Lagi" (yang membuat job baru, bukan
      mengubah job lama). Job `PENDING`/`PROCESSING` harus melanjutkan polling otomatis sampai
      selesai; job `READY`/`FAILED` tidak boleh memicu polling baru sama sekali.
- [ ] **Mobile layout** — cek di viewport sempit (DevTools responsive mode atau HP asli): tab
      Unduh Cepat pakai `grid-cols-1` di bawah breakpoint `sm`, dan `DialogContent` punya
      `max-w-2xl` yang seharusnya menyusut ke lebar layar — belum divisualkan langsung sejauh
      ini, jadi ini benar-benar pengecekan pertama
- [ ] **Dark mode (kalau ada)** — **tidak ada untuk dicek**: dikonfirmasi tidak ada toggle
      light/dark di app ini sama sekali (tidak ada `next-themes`, tidak ada `dark:` variant di
      Tailwind config, tidak ada komponen `ThemeToggle`) — `apps/web` cuma punya satu tema gelap
      tetap (`--background: 220 29% 6%`, token "Bay Black"). Item ini otomatis lolos, bukan
      sesuatu yang perlu dicari-cari
- [ ] **Error handling** — dua jalur yang gampang dites:
      1. Tab Brand Kit: isi warna dengan teks bukan hex (mis. `"biru"`), klik "Simpan Warna" →
         harus muncul pesan "Warna utama harus format hex, contoh: #1D4ED8" tanpa memanggil API
         sama sekali (validasi client-side, cek Network tab kosong).
      2. Tab Brand Kit: upload file non-gambar (mis. `.txt`) sebagai logo → backend menolak
         (`ParseFilePipeBuilder` image-only filter), pesan error dari `err.message` harus muncul
         di bawah form, bukan crash/blank.

## Known-fixed issues (context for future checks)

- CSV responses are BOM-prefixed via `apps/api/src/common/csv.util.ts`'s `withUtf8Bom()` — applied
  to both new Export Center CSV routes and retrofitted onto the pre-existing
  `GET /dashboard/export.csv` route, since it had the identical bug. If a new CSV-producing route
  is added anywhere in `apps/api`, it needs `withUtf8Bom()` too, not just a CSV content type.
- All export routes declare `charset=utf-8` explicitly in `Content-Type` — added in the same pass
  as the BOM fix, since neither NestJS nor Express appends a charset automatically for a
  manually-set `Content-Type` header on a `res.send(string)` response.
- `buildVideoReportMarkdown` (Phase D) initially had no escaping at all for free-text fields
  (video title, `hookText`, `highlightReason`, `ctaText`, keywords/hashtags/topics) - a
  CommonMark-compliant renderer passes raw inline/block HTML straight through, so an unescaped
  `<script>` in one of those fields would reach a browser as real HTML the moment the `.md` file
  is rendered by a viewer, and unescaped `*`/`_`/`` ` ``/`[]`/`#` could inject fake emphasis/
  links/headings into the document structure. Fixed via `escapeMarkdown()` (backslash first, then
  `&`/`<`/`>`, then collapse embedded newlines to a space, then backslash-escape the CommonMark
  punctuation that's actually exploitable inline: `` ` * _ [ ] # ! ``). `buildVideoReportHtml` was
  never affected - it already had its own `escapeHtml()` from the start. If a future format
  addition renders free-text fields into a document format with its own escaping rules (Markdown,
  HTML, RTF, etc.), it needs the same treatment - this is not automatic just because the input
  data is already-trusted-shaped `VideoReportData`.
