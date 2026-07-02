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
4. **Caption** — untuk tiap kandidat klip, `detect-clips` yang sukses langsung enqueue satu job `render-clip` (self-chain, sama seperti `transcribe` -> `detect-clips`). `render-clip` memotong video dengan FFmpeg sesuai timestamp klip, generate file SRT dari transcript (timestamp digeser relatif ke awal klip), lalu burn-in sebagai subtitle ke video hasil potongan. `Clip.outputUrl` di-set setelah render sukses; `Video.status` -> `RENDERED` baru setelah **semua** klip milik video tersebut selesai di-render (bukan begitu klip pertama selesai).
5. **Download** — `apps/web` polling `GET /videos/:id` tiap 2 detik sampai status `RENDERED` atau `FAILED`, lalu menampilkan daftar klip dengan link `GET /clips/:id/download` (apps/api streaming file dari `Clip.outputUrl`, path lokal yang ditulis `apps/worker`).

Setiap tahap adalah job terpisah di BullMQ (bukan satu job monolitik) agar retry granular per-tahap dan agar FFmpeg cluster bisa discale independen dari proses ASR.

## Keputusan Arsitektur

- **BullMQ dipakai untuk semua kerja berat/async** (transcribe, detect-clips, render-clip). API layer tidak pernah menjalankan Whisper atau FFmpeg secara sinkron di request-response cycle.
- **Worker dipisah dari API** supaya FFmpeg cluster dan proses ASR yang CPU/GPU-intensive bisa di-scale terpisah dari layer API yang menangani traffic HTTP.
- **PostgreSQL sebagai source of truth** untuk status job dan metadata video/klip; Redis hanya untuk antrian (BullMQ) dan cache, bukan penyimpanan permanen.
- **Status video/klip berbentuk state machine linear** (`UPLOADED -> TRANSCRIBED -> CLIPS_DETECTED -> RENDERED`) yang disimpan di PostgreSQL agar frontend bisa polling progres secara konsisten.
- **Prisma di `packages/database` sebagai satu-satunya akses ke PostgreSQL**, dipakai baik oleh `apps/api` maupun `apps/worker` (model: `User`, `Video`, `TranscriptSegment`, `Clip` — lihat `packages/database/prisma/schema.prisma`). Transcript segment disimpan per-video (bukan diduplikasi per-klip); transcript sebuah klip didapat dengan query segment dalam rentang `startTime`-`endTime` klip tersebut.
- **Video disimpan di local disk untuk MVP** (`apps/api/src/storage`), dengan `Video.sourceUrl` berupa absolute path (bukan path relatif) supaya `apps/worker` — proses terpisah dengan cwd berbeda — bisa langsung baca file yang sama tanpa perlu tahu `UPLOAD_DIR` milik `apps/api`. Ganti implementasi `StorageService` untuk pindah ke object storage nanti.
- **Worker meng-update status video sendiri** setelah job selesai (mis. `transcribe` job set status `TRANSCRIBED` setelah berhasil, atau `FAILED` kalau error), bukan lewat callback ke `apps/api`.
- **Worker self-chains job berikutnya dalam pipeline**: `transcribe` job yang sukses langsung enqueue job `detect-clips` sendiri, dan `detect-clips` yang sukses langsung enqueue satu job `render-clip` per kandidat klip (lihat `apps/worker/src/queues.ts`), bukan lewat `apps/api`. Orkestrasi antar-tahap pipeline berada di `apps/worker`, bukan di layer API.
- **FFmpeg dipanggil langsung via `child_process`** (bukan wrapper library seperti `fluent-ffmpeg`) dari `apps/worker/src/ffmpeg.ts`. Butuh binary FFmpeg tersedia (di `PATH`, atau via `FFMPEG_PATH`) di environment tempat `apps/worker` jalan.
- **Render output disimpan di local disk juga** (subfolder `renders/` di bawah `UPLOAD_DIR`, lihat `apps/worker/src/storage.ts`), konsisten dengan keputusan storage video asli — `apps/worker` satu-satunya penulis file ini, jadi tidak ada masalah cross-process path resolution seperti pada upload.
- **`GET /videos/:id` tidak mengembalikan `Clip.outputUrl` mentah** (absolute path filesystem server) ke client; di-map jadi `downloadUrl` (`/clips/:id/download` relatif) supaya detail implementasi storage tidak bocor ke API response.
- **CORS di `apps/api` di-enable eksplisit dengan `credentials: true`** (`WEB_ORIGIN`, default `http://localhost:3000`) supaya `apps/web` (origin beda, port 3000) bisa manggil `apps/api` (port 3001) dari browser sambil ikut kirim cookie sesi.
- **Auth: email + password + JWT di httpOnly cookie**, bukan token di `localStorage`/`Authorization` header. `AuthModule` (`apps/api/src/auth`) — `POST /auth/register` (bcrypt hash, langsung login), `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. `JwtStrategy` extract token dari cookie `token`, bukan `Bearer` header. `ownerId` untuk video **selalu** diambil dari user di sesi (`@CurrentUser()`), tidak pernah dari body request — endpoint lama `POST /users` (get-or-create by email tanpa password) sudah dihapus karena itu lubang keamanan (siapa saja bisa "jadi" user manapun cuma dengan tahu emailnya).
- **`GET /videos/:id` dan `GET /clips/:id/download` mengecek kepemilikan** (`video.ownerId`/`clip.video.ownerId` harus sama dengan user di sesi) dan melempar 404 yang sama baik untuk resource yang tidak ada maupun resource milik user lain — supaya endpoint tidak bisa dipakai untuk menebak ID mana yang valid.
- **`apps/web` punya dua route**: `/` (upload video baru + progress live untuk video yang baru saja di-upload) dan `/dashboard` (riwayat semua video milik user, lewat `GET /videos`). Keduanya pakai `useAuth()` hook yang sama (`lib/useAuth.ts`) untuk cek sesi via `GET /auth/me` — bukan `localStorage` — supaya status login selalu konsisten dengan sesi di server.
- **`POST /auth/login` di-rate-limit** (5 percobaan / 60 detik, per IP, via `@nestjs/throttler`). `ThrottlerGuard` **tidak** didaftarkan global — cuma dipasang `@UseGuards(ThrottlerGuard)` langsung di route `login`, jadi endpoint lain (termasuk `/auth/register`) tidak kena efeknya. Config in-memory (bukan Redis-backed) karena `apps/api` masih jalan sebagai satu instance untuk MVP ini.

## Konvensi Coding

- Bahasa: TypeScript di seluruh monorepo (`apps/web`, `apps/api`, `apps/worker`, `packages/shared`).
- Semua kontrak data (job payload, DTO API, enum status) didefinisikan di `packages/shared` dan diimpor, bukan diduplikasi.
- Job BullMQ dinamai dengan verb-noun (`transcribe`, `detect-clips`, `render-clip`) dan payload/return type-nya didefinisikan di `packages/shared`.
- Perubahan skema PostgreSQL melalui migration (bukan sync otomatis) agar histori skema terlacak.

## Status

Dokumen ini adalah ringkasan arsitektur awal untuk fase MVP. Update bagian ini seiring keputusan baru diambil (mis. strategi storage, provider hosting FFmpeg cluster, algoritma deteksi klip yang dipakai).
