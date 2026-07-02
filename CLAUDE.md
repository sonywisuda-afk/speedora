# CLAUDE.md

Referensi arsitektur & konvensi untuk **viral-clip-app** — platform AI video repurposing (mirip OpusClip) yang mengubah video panjang menjadi klip pendek siap-viral secara otomatis.

## Ringkasan Produk

Alur inti MVP:

```
Upload video -> Transcript (ASR) -> Auto-clip (deteksi momen menarik) -> Caption (burn-in) -> Download
```

## Tech Stack

| Layer | Teknologi |
|---|---|
| Frontend | Next.js + TypeScript |
| Backend API | NestJS |
| Database | PostgreSQL (via Prisma ORM di `packages/database`, dipakai `apps/api` & `apps/worker`) |
| Queue / Cache | Redis + BullMQ |
| Video processing | FFmpeg cluster (worker nodes terpisah) |
| ASR (speech-to-text) | Whisper (OpenAI audio transcription API) |

## Struktur Monorepo

```
apps/
  web/        # Next.js frontend — upload UI, editor klip, preview, dashboard
  api/        # NestJS backend — REST/GraphQL API, auth, job orchestration
  worker/     # Job consumer — ASR (Whisper), auto-clip detection, FFmpeg render, captioning
packages/
  shared/     # Tipe TypeScript, DTO, konstanta, util yang dipakai lintas apps
  database/   # Prisma schema/client Postgres, dipakai apps/api dan apps/worker
```

- `apps/web` dan `apps/api` hanya berkomunikasi lewat HTTP API — tidak ada import langsung antar keduanya.
- `apps/worker` tidak melayani HTTP; hanya mengonsumsi job dari BullMQ queue yang di-enqueue oleh `apps/api`.
- Tipe yang dibagi antara frontend, backend, dan worker (mis. bentuk payload job, status enum, DTO) didefinisikan sekali di `packages/shared` — jangan duplikasi tipe di masing-masing app.

## Alur Pemrosesan Video (MVP)

1. **Upload** — `apps/web` upload file ke `apps/api`, video disimpan (object storage), record dibuat di PostgreSQL dengan status `UPLOADED`.
2. **Transcript** — `apps/api` enqueue job `transcribe` ke BullMQ. `apps/worker` menjalankan Whisper, hasil transcript (dengan timestamp) disimpan ke PostgreSQL. Status -> `TRANSCRIBED`.
3. **Auto-clip** — job `detect-clips` (dienqueue oleh `apps/worker` sendiri begitu `transcribe` sukses, bukan oleh `apps/api`) mengirim transcript ke LLM (GPT) untuk memilih 1-3 momen paling menarik/viral-worthy sebagai kandidat klip (start/end timestamp + virality score 0-100). Menghasilkan daftar kandidat klip. Status -> `CLIPS_DETECTED`.
4. **Caption** — job `render-clip` memotong video dengan FFmpeg sesuai timestamp klip, lalu burn-in caption dari transcript ke video hasil potongan. Status -> `RENDERED`.
5. **Download** — `apps/web` polling/menerima notifikasi status, lalu menyediakan link download klip hasil render dari object storage.

Setiap tahap adalah job terpisah di BullMQ (bukan satu job monolitik) agar retry granular per-tahap dan agar FFmpeg cluster bisa discale independen dari proses ASR.

## Keputusan Arsitektur

- **BullMQ dipakai untuk semua kerja berat/async** (transcribe, detect-clips, render-clip). API layer tidak pernah menjalankan Whisper atau FFmpeg secara sinkron di request-response cycle.
- **Worker dipisah dari API** supaya FFmpeg cluster dan proses ASR yang CPU/GPU-intensive bisa di-scale terpisah dari layer API yang menangani traffic HTTP.
- **PostgreSQL sebagai source of truth** untuk status job dan metadata video/klip; Redis hanya untuk antrian (BullMQ) dan cache, bukan penyimpanan permanen.
- **Status video/klip berbentuk state machine linear** (`UPLOADED -> TRANSCRIBED -> CLIPS_DETECTED -> RENDERED`) yang disimpan di PostgreSQL agar frontend bisa polling progres secara konsisten.
- **Prisma di `packages/database` sebagai satu-satunya akses ke PostgreSQL**, dipakai baik oleh `apps/api` maupun `apps/worker` (model: `User`, `Video`, `TranscriptSegment`, `Clip` — lihat `packages/database/prisma/schema.prisma`). Transcript segment disimpan per-video (bukan diduplikasi per-klip); transcript sebuah klip didapat dengan query segment dalam rentang `startTime`-`endTime` klip tersebut.
- **Video disimpan di local disk untuk MVP** (`apps/api/src/storage`), dengan `Video.sourceUrl` berupa absolute path (bukan path relatif) supaya `apps/worker` — proses terpisah dengan cwd berbeda — bisa langsung baca file yang sama tanpa perlu tahu `UPLOAD_DIR` milik `apps/api`. Ganti implementasi `StorageService` untuk pindah ke object storage nanti.
- **Worker meng-update status video sendiri** setelah job selesai (mis. `transcribe` job set status `TRANSCRIBED` setelah berhasil, atau `FAILED` kalau error), bukan lewat callback ke `apps/api`.
- **Worker self-chains job berikutnya dalam pipeline**: `transcribe` job yang sukses langsung enqueue job `detect-clips` sendiri (lihat `apps/worker/src/queues.ts`), bukan lewat `apps/api`. Orkestrasi antar-tahap pipeline berada di `apps/worker`, bukan di layer API.

## Konvensi Coding

- Bahasa: TypeScript di seluruh monorepo (`apps/web`, `apps/api`, `apps/worker`, `packages/shared`).
- Semua kontrak data (job payload, DTO API, enum status) didefinisikan di `packages/shared` dan diimpor, bukan diduplikasi.
- Job BullMQ dinamai dengan verb-noun (`transcribe`, `detect-clips`, `render-clip`) dan payload/return type-nya didefinisikan di `packages/shared`.
- Perubahan skema PostgreSQL melalui migration (bukan sync otomatis) agar histori skema terlacak.

## Status

Dokumen ini adalah ringkasan arsitektur awal untuk fase MVP. Update bagian ini seiring keputusan baru diambil (mis. strategi storage, provider hosting FFmpeg cluster, algoritma deteksi klip yang dipakai).
