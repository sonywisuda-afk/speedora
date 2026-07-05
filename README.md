# Speedora

[![CI](https://github.com/sonywisuda-afk/speedora/actions/workflows/ci.yml/badge.svg)](https://github.com/sonywisuda-afk/speedora/actions/workflows/ci.yml)
[![CI web](https://github.com/sonywisuda-afk/speedora/actions/workflows/ci-web.yml/badge.svg)](https://github.com/sonywisuda-afk/speedora/actions/workflows/ci-web.yml)
[![CI api](https://github.com/sonywisuda-afk/speedora/actions/workflows/ci-api.yml/badge.svg)](https://github.com/sonywisuda-afk/speedora/actions/workflows/ci-api.yml)
[![CI worker](https://github.com/sonywisuda-afk/speedora/actions/workflows/ci-worker.yml/badge.svg)](https://github.com/sonywisuda-afk/speedora/actions/workflows/ci-worker.yml)
[![License](https://img.shields.io/badge/license-proprietary-red.svg)](./LICENSE)

AI video repurposing platform (mirip OpusClip) — upload video panjang, otomatis dipotong jadi klip pendek dengan caption. Lihat [`CLAUDE.md`](./CLAUDE.md) untuk ringkasan arsitektur dan keputusan desain.

## Fitur

**Pipeline inti**: pilih mesin transkripsi → upload video panjang (file langsung atau tempel link YouTube) → transkrip otomatis (Whisper) → deteksi klip viral-worthy (LLM) → crop 9:16 + burn-in caption (FFmpeg) → download, dengan retry per-tahap kalau ada yang gagal.

- **Premium transcription** — pilih **Groq Whisper** (gratis, default) atau **OpenAI Whisper** (premium, Rp 10.000/video via Midtrans) sebelum tiap upload/import; pilihan berlaku per-video, bukan setting akun. Lihat bagian "Setup Pembayaran Premium Transcription" di bawah.
- **Import dari YouTube** — alternatif upload file: tempel link video YouTube, `apps/worker` yang unduh (yt-dlp) lalu masuk ke pipeline yang sama persis seperti upload langsung.
- **Timeline editor** — trim start/end klip manual, preview video+caption di browser, render ulang eksplisit tanpa upload ulang.
- **Smart reframe** — crop 9:16 mengikuti wajah paling menonjol di frame (deteksi wajah via MediaPipe), fallback ke center-crop kalau tidak ada wajah terdeteksi.
- **Caption styling** — tiga preset burn-in caption: default, karaoke (highlight kata per-kata sinkron audio), dan bold-highlight (angka/ALL-CAPS/kutipan ditebalkan otomatis).
- **Observability** — error tracking terpusat (Sentry) untuk kegagalan job worker maupun exception API.
- **Hook & hashtag generator** — LLM yang sama yang mendeteksi klip juga menghasilkan saran hook text pembuka dan hashtag per klip, bisa diedit manual.
- **Publish Center** — connect akun YouTube, TikTok, dan Instagram (OAuth, token terenkripsi at-rest), lalu publish klip langsung atau dijadwalkan ke waktu tertentu (dengan cancel/reschedule) dari dashboard yang sama.
- **Analytics dasar** — views/likes/comments klip yang sudah dipublish disinkronkan otomatis tiap beberapa jam dan ditampilkan inline di dashboard.
- **Lupa & ganti kata sandi** — link reset dikirim lewat email (SMTP via nodemailer); kalau `SMTP_HOST` belum dikonfigurasi, link-nya di-log ke console `apps/api` supaya fitur tetap bisa dites di dev lokal. Ganti kata sandi (perlu login) tersedia di halaman `/accounts`.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) 9.x (lihat catatan instalasi di bawah kalau `pnpm` belum ada di PATH)
- [Docker](https://www.docker.com/) (untuk Postgres + Redis lokal)
- [FFmpeg](https://ffmpeg.org/) di `PATH` (untuk `apps/worker`'s `render-clip` job — potong video, crop 9:16, & burn-in caption). Kalau tidak di `PATH`, set `FFMPEG_PATH` (dan `FFPROBE_PATH`) di `.env` ke path binary-nya.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) di `PATH` (`pip install yt-dlp`) — untuk `apps/worker`'s `import-youtube` job (fitur "Import dari YouTube" di halaman upload). Kalau tidak di `PATH`, set `YTDLP_PATH` di `.env` ke path binary-nya.
- Python 3.9+ dengan `pip install mediapipe opencv-python-headless` (untuk smart reframe — deteksi wajah di `apps/worker`'s `render-clip` job, lihat `apps/worker/scripts/detect_faces.py`). Kalau `python3` tidak di `PATH`, set `PYTHON_PATH` di `.env`.
- Model MediaPipe Face Detector — download sekali ke `apps/worker/models/blaze_face_short_range.tflite` (folder ini gitignored, bukan aset yang di-commit):
  ```bash
  mkdir -p apps/worker/models
  curl -sL -o apps/worker/models/blaze_face_short_range.tflite \
    https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite
  ```
- Bucket object storage S3-compatible (mis. [Cloudflare R2](https://developers.cloudflare.com/r2/), AWS S3, atau kompatibel lainnya) — video upload dan hasil render disimpan di sini, bukan local disk. Isi kredensialnya di `STORAGE_*` env var (lihat `.env.example`).

### Install pnpm

Kalau `pnpm` belum tersedia sebagai command global:

```bash
corepack enable
corepack prepare pnpm@9 --activate
```

Kalau `corepack prepare` gagal karena permission ke folder instalasi Node (mis. `C:\Program Files\nodejs`), install lewat npm ke prefix milik user sendiri:

```bash
npm config set prefix ~/.npm-global
npm install -g pnpm@9
export PATH="$HOME/.npm-global:$PATH"   # tambahkan ke ~/.bashrc atau profile shell kamu
```

## Setup

1. Clone repo dan install dependencies:

   ```bash
   pnpm install
   ```

2. Salin environment variables:

   ```bash
   cp .env.example .env
   ```

3. Nyalakan Postgres & Redis lokal (lihat [`docker-compose.yml`](./docker-compose.yml)):

   ```bash
   pnpm docker:up
   ```

4. Buat schema database (Prisma migration, lihat `packages/database/prisma/schema.prisma`):

   ```bash
   pnpm --filter @speedora/database db:migrate:dev
   ```

5. Jalankan semua service dalam mode dev (build `packages/shared` + `packages/database` dalam watch mode, lalu `apps/web`, `apps/api`, `apps/worker` paralel):

   ```bash
   pnpm dev
   ```

   - `apps/web` → http://localhost:3000 (upload video baru) dan `/dashboard` (riwayat video + klip)
   - `apps/api` → http://localhost:3001 (default `API_PORT`, lihat `.env.example`)
   - `apps/worker` → tidak melayani HTTP, hanya konsumsi job dari BullMQ/Redis

> Kalau port default Postgres/Redis (`5432`/`6379`) sudah dipakai proses lain di mesin kamu, ubah `POSTGRES_PORT`/`REDIS_PORT` (dan `DATABASE_URL`/`REDIS_URL` yang cocok) di `.env` lokal sebelum `pnpm docker:up`.

## Scripts

Dijalankan dari root, berlaku untuk seluruh workspace kecuali disebutkan lain:

| Script | Keterangan |
|---|---|
| `pnpm dev` | Jalankan `packages/shared` (watch build) + `apps/web` + `apps/api` + `apps/worker` secara paralel |
| `pnpm build` | Build semua package secara berurutan (`shared` dulu, karena app lain bergantung padanya) |
| `pnpm lint` | Jalankan ESLint di semua app/package |
| `pnpm typecheck` | Jalankan `tsc --noEmit` di semua app/package |
| `pnpm format` | Format seluruh repo dengan Prettier |
| `pnpm format:check` | Cek formatting tanpa mengubah file (cocok untuk CI) |
| `pnpm docker:up` | Nyalakan Postgres + Redis lokal (`docker compose up -d`) |
| `pnpm docker:down` | Matikan Postgres + Redis lokal |

Untuk menjalankan script pada satu package saja, gunakan `--filter`, misalnya:

```bash
pnpm --filter @speedora/api start:dev
pnpm --filter @speedora/worker dev
pnpm --filter @speedora/shared build
```

### Migrasi one-off: re-encode source AV1 lama ke H.264

Import YouTube sekarang memilih H.264 (avc1) supaya pratinjau `<video>` di timeline editor bisa diputar di semua browser. Video yang **sudah** ter-import sebelum perubahan itu mungkin tersimpan sebagai AV1 (av01) dan pratinjaunya tidak bisa diputar di sebagian browser. Untuk mengonversi source-source lama itu ke H.264 di tempat (object key sama, durasi/timeline tidak berubah jadi klip & transkrip tetap valid):

```bash
# Semua video: cek codec source-nya, re-encode yang bukan H.264
pnpm --filter @speedora/worker reencode:sources

# Atau satu video tertentu saja (kasih video id sebagai argumen)
pnpm --filter @speedora/worker reencode:sources <videoId>
```

Idempotent — source yang sudah H.264 dilewati, jadi aman dijalankan berulang. Butuh env `DATABASE_URL`/`STORAGE_*`/`FFMPEG_PATH` yang sama seperti `apps/worker` biasa.

## Database

`packages/database` pakai [Prisma](https://www.prisma.io/) (provider `postgresql`) sebagai ORM & migration tool, dipakai bersama oleh `apps/api` dan `apps/worker`. Skema ada di `packages/database/prisma/schema.prisma`, client hasil generate masuk ke `packages/database/src/generated/prisma` (gitignored, dibuat otomatis lewat `postinstall` setiap `pnpm install`).

Dijalankan dengan `pnpm --filter @speedora/database <script>`:

| Script | Keterangan |
|---|---|
| `db:generate` | Generate ulang Prisma Client dari schema (otomatis jalan setelah `pnpm install`) |
| `db:migrate:dev` | Buat & apply migration baru berdasarkan perubahan schema (dev only) |
| `db:migrate:deploy` | Apply migration yang sudah ada tanpa membuat yang baru (dipakai di CI/production) |
| `db:push` | Sinkronkan schema ke database tanpa migration file (prototyping cepat, bukan untuk data production) |
| `db:studio` | Buka Prisma Studio (GUI) untuk lihat/edit data |

## Struktur Project

```
apps/
  web/        # Next.js 14 (App Router, TypeScript, Tailwind) — frontend
  api/        # NestJS — REST API, auth, job orchestration
  worker/     # Konsumer BullMQ — transcribe (Whisper), detect-clips, render-clip (FFmpeg), publish-clip, schedule-publish-clip, sync-publish-stats
packages/
  shared/     # Tipe TypeScript & util yang dipakai lintas apps
  database/   # Prisma schema/client Postgres, dipakai apps/api dan apps/worker
  storage/    # Klien object storage S3-compatible (upload/download/delete), dipakai apps/api dan apps/worker
  social/     # OAuth client, enkripsi token, upload & stats klien per-platform (YouTube, TikTok, Instagram), dipakai apps/api dan apps/worker
```

Detail alur pemrosesan video, keputusan arsitektur, dan konvensi coding ada di [`CLAUDE.md`](./CLAUDE.md).

## Environment Variables

Lihat [`.env.example`](./.env.example) untuk daftar lengkap. Yang penting:

- `DATABASE_URL` — connection string Postgres, dipakai `apps/api` dan `apps/worker` lewat `packages/database`
- `REDIS_URL` — dipakai `apps/api` (enqueue job) dan `apps/worker` (consume job) lewat BullMQ
- `NEXT_PUBLIC_API_URL` — base URL API yang dipanggil `apps/web`
- `GROQ_API_KEY` — dipakai `apps/worker` untuk transcribe job, mesin transkripsi **default & gratis** (Groq's Whisper large-v3-turbo, lewat endpoint OpenAI-compatible-nya). **Wajib** — dapatkan key gratis di [console.groq.com/keys](https://console.groq.com/keys)
- `OPENAI_API_KEY` — dipakai `apps/worker` untuk transcribe job, mesin transkripsi **premium** (OpenAI's Whisper `whisper-1`) yang dipilih user lewat layar "Pilih Mesin Transkripsi" dan dibayar per-video via Midtrans (lihat bagian "Setup Pembayaran Premium Transcription" di bawah). **Opsional** — tanpa ini, transkripsi gratis (Groq) tetap jalan normal untuk semua video; cuma video yang memilih OpenAI yang gagal sampai key ini diisi
- `FFMPEG_PATH` — path ke binary FFmpeg, dipakai `apps/worker` untuk render-clip job. Default `ffmpeg` (asumsi ada di `PATH`)
- `YTDLP_PATH` — path ke binary yt-dlp, dipakai `apps/worker` untuk import-youtube job. Default `yt-dlp` (asumsi ada di `PATH`)
- `STORAGE_ENDPOINT` / `STORAGE_REGION` / `STORAGE_BUCKET` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` / `STORAGE_FORCE_PATH_STYLE` — kredensial & config bucket object storage S3-compatible (dipakai `packages/storage`, oleh `apps/api` untuk upload video dan `apps/worker` untuk baca source + upload hasil render). Nama var generik (bukan `R2_*`) supaya provider bisa diganti tanpa ubah kode; **isi sendiri di `.env` lokal**, jangan commit nilai asli
- `WEB_ORIGIN` — origin yang diizinkan CORS di `apps/api` untuk request dari `apps/web`
- `JWT_SECRET` — secret untuk sign JWT auth. **Generate sendiri** (`openssl rand -hex 32`), jangan pakai default di `.env.example`
- `JWT_EXPIRES_IN` — masa berlaku token auth. Default `7d`
- `SENTRY_DSN` — dipakai `apps/api` dan `apps/worker` untuk error tracking (Sentry). **Opsional** — boleh kosong di dev lokal, `Sentry.init()` otomatis no-op tanpa DSN
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — kredensial OAuth client dari [Google Cloud Console](https://console.cloud.google.com/apis/credentials) untuk fitur "Connect YouTube account" (Fase 6a) dan publish klip ke YouTube (Fase 6b). **Opsional** — tanpa ini `apps/api` tetap jalan normal, cuma `GET /social/youtube/connect` yang gagal (503) sampai diisi. Butuh YouTube Data API v3 aktif di project Google Cloud-nya, dan `$API_BASE_URL/social/youtube/callback` terdaftar sebagai authorized redirect URI
- `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` — kredensial dari [TikTok Developer Portal](https://developers.tiktok.com/apps) untuk "Connect TikTok account" dan publish (mode "Upload to Inbox", Fase 6d). **Opsional**, sama perlakuannya seperti var Google di atas. Redirect URI-nya `$API_BASE_URL/social/tiktok/callback`
- `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` — kredensial dari [Meta for Developers](https://developers.facebook.com/apps) (produk Facebook Login + Instagram Graph API) untuk "Connect Instagram account" dan publish Reels (Fase 6d follow-up). **Opsional**, sama perlakuannya seperti var di atas. Butuh akun Instagram Business/Creator yang ditautkan ke Facebook Page. Redirect URI-nya `$API_BASE_URL/social/instagram/callback`
- `API_BASE_URL` — base URL `apps/api` sendiri (dilihat dari browser), dipakai membangun OAuth `redirect_uri` untuk ketiga platform di atas. Default `http://localhost:$API_PORT`
- `TOKEN_ENCRYPTION_KEY` — key AES-256-GCM untuk enkripsi access/refresh token `SocialAccount` sebelum disimpan. **Generate sendiri** (`openssl rand -hex 32`) — beda dari var opsional lain di atas, tidak ada fallback aman untuk sebuah encryption key, jadi kosongkan ini bikin connect account gagal loud (bukan diam-diam simpan token tanpa enkripsi)
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` — kredensial SMTP dipakai `apps/api`'s `MailService` untuk mengirim email reset kata sandi. **Opsional** — kosongkan `SMTP_HOST` di dev lokal dan link reset-nya di-log ke console `apps/api`, bukan dikirim beneran
- `MIDTRANS_SERVER_KEY` / `MIDTRANS_CLIENT_KEY` / `MIDTRANS_IS_PRODUCTION` — kredensial [Midtrans](https://midtrans.com) dipakai `apps/api`'s `PaymentsModule` untuk checkout premium transcription (Rp 10.000/video, pay-per-use). **Opsional** — tanpa ini, `POST /payments/premium-transcription/checkout` 503 sampai diisi; semua fitur lain (termasuk transkripsi gratis) tetap jalan normal. Lihat bagian "Setup Pembayaran Premium Transcription" di bawah
- `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` / `NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION` — dipakai `apps/web` untuk memuat Midtrans Snap.js. Nilainya sama dengan `MIDTRANS_CLIENT_KEY`/`MIDTRANS_IS_PRODUCTION` di atas — Client Key Midtrans memang didesain aman diekspos ke browser

## Menghubungkan Akun Sosial Media (halaman `/social`)

Tombol "Hubungkan YouTube/TikTok/Instagram" di halaman `/social` butuh app OAuth yang didaftarkan **sekali** di masing-masing platform (dilakukan oleh kamu sebagai pemilik aplikasi, bukan per-user — tiap user yang login tetap connect akun mereka sendiri lewat consent screen platform itu seperti biasa). Tanpa ini, tombolnya tetap tampil tapi menampilkan error 503 yang jelas ("... is not configured") begitu diklik.

1. **Generate `TOKEN_ENCRYPTION_KEY` dulu** (tidak butuh akun apa pun): `openssl rand -hex 32`, isi ke `.env`. Ini yang mengenkripsi access/refresh token semua platform di database.
2. **YouTube (Google Cloud Console)** — yang paling sederhana untuk dicoba pertama:
   - Buka [console.cloud.google.com](https://console.cloud.google.com/apis/credentials), buat project baru (atau pakai yang sudah ada).
   - Aktifkan **YouTube Data API v3** (menu "APIs & Services" → "Library").
   - Buat kredensial: "Create Credentials" → "OAuth client ID" → tipe **"Web application"**.
   - Tambahkan Authorized redirect URI: `http://localhost:3001/social/youtube/callback` (ganti host/port sesuai `API_BASE_URL` kalau beda).
   - Salin **Client ID** dan **Client Secret** ke `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` di `.env`.
   - Selama app masih di mode "Testing" (belum lolos verifikasi Google), tambahkan akun Google yang mau dipakai tes sebagai "Test user" di layar OAuth consent screen-nya.
3. **TikTok (TikTok Developer Portal)**:
   - Daftar app di [developers.tiktok.com/apps](https://developers.tiktok.com/apps), tambahkan produk **Login Kit** + **Content Posting API**.
   - Redirect URI: `http://localhost:3001/social/tiktok/callback`.
   - Salin **Client Key**/**Client Secret** ke `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.
   - Selama app belum lolos App Review, akun TikTok penguji perlu didaftarkan sebagai "target user" di portal-nya dulu (lihat CLAUDE.md's Fase 6d untuk detail kenapa mode publish-nya "Upload to Inbox", bukan langsung live).
4. **Instagram (Meta for Developers)**:
   - Buat app di [developers.facebook.com/apps](https://developers.facebook.com/apps), tambahkan produk **Facebook Login** + **Instagram Graph API**.
   - Redirect URI: `http://localhost:3001/social/instagram/callback`.
   - Salin **App ID**/**App Secret** ke `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`.
   - Akun yang dipakai connect harus akun Instagram Business/Creator yang ditautkan ke Facebook Page yang kamu kelola — akun IG personal biasa tidak bisa dipakai.
5. Restart `apps/api` setelah mengisi env var apa pun di atas (dibaca sekali saat boot).

Ketiganya independen — kamu bisa isi salah satu duluan (mis. cuma YouTube) dan yang lain tetap 503 sampai diisi menyusul.

## Setup Pembayaran Premium Transcription (Midtrans)

Layar "Pilih Mesin Transkripsi" yang muncul sebelum upload/import video butuh akun [Midtrans](https://midtrans.com) untuk mengaktifkan pilihan **OpenAI Whisper (Premium)** — mesin transkripsi default (**Groq Whisper**) sudah gratis dan tidak butuh setup ini sama sekali. Tanpa kredensial Midtrans, tombol "Bayar & Pakai OpenAI" tetap tampil tapi menampilkan error yang jelas begitu diklik.

1. **Daftar akun Midtrans** di [dashboard.sandbox.midtrans.com](https://dashboard.sandbox.midtrans.com) (mode **Sandbox** — bisa langsung dipakai tanpa proses approval, mensimulasikan pembayaran sungguhan tanpa uang asli berpindah). Untuk produksi nanti, daftar akun sungguhan di [midtrans.com](https://midtrans.com) (butuh proses verifikasi bisnis).
2. **Ambil Server Key dan Client Key**: masuk ke dashboard Sandbox → **Settings** → **Access Keys**. Salin:
   - **Server Key** → `MIDTRANS_SERVER_KEY` (rahasia — jangan pernah expose ke frontend/commit ke git)
   - **Client Key** → `MIDTRANS_CLIENT_KEY` **dan** `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` (nilai yang sama; Client Key memang didesain aman untuk browser, dipakai Snap.js)
3. **Set `MIDTRANS_IS_PRODUCTION=false`** dan `NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION=false` selama pakai key Sandbox (keduanya harus konsisten — key Sandbox dipasangkan dengan environment Sandbox, key produksi dengan environment produksi).
4. **Daftarkan webhook notification URL** — ini yang membuat `PremiumCredit` benar-benar naik status ke `PAID` setelah pembayaran (lihat CLAUDE.md's "Premium Transcription" section untuk kenapa webhook, bukan callback client-side Snap.js, yang jadi sumber kebenaran). Di dashboard Sandbox → **Settings** → **Configuration** → **Payment Notification URL**, isi `http://localhost:3001/payments/webhook/midtrans`.
   - Midtrans mengirim notifikasi dari server mereka, jadi **tidak bisa menjangkau `localhost`** langsung. Untuk tes pembayaran sungguhan secara lokal, jalankan tunnel publik (mis. `ngrok http 3001`) dan pakai URL publik itu (`https://xxxx.ngrok.io/payments/webhook/midtrans`) sebagai notification URL-nya.
5. **Simulasikan pembayaran** — Sandbox Midtrans menyediakan [simulator](https://simulator.sandbox.midtrans.com/) dan nomor kartu/VA test resmi untuk tiap metode pembayaran (lihat [dokumentasi testing Midtrans](https://docs.midtrans.com/docs/testing-payment-on-sandbox)) supaya seluruh alur checkout → webhook → `PremiumCredit` jadi `PAID` bisa dicoba tanpa uang asli.
6. Restart `apps/api` dan `apps/web` setelah mengisi env var apa pun di atas (dibaca sekali saat boot/build).

## API

Endpoint utama di `apps/api`. Semua endpoint kecuali `/auth/register`, `/auth/login`, dan `/health` butuh cookie sesi (login dulu):

| Endpoint | Keterangan |
|---|---|
| `POST /auth/register` | Buat akun (`email` + `password`, min. 8 karakter), langsung login (set cookie) |
| `POST /auth/login` | Login, set cookie sesi (`httpOnly`, JWT) |
| `POST /auth/logout` | Hapus cookie sesi |
| `GET /auth/me` | Info user yang sedang login (401 kalau belum login) |
| `POST /auth/forgot-password` | Kirim link reset kata sandi ke `email` kalau terdaftar (respons sama persis baik email cocok atau tidak, supaya tidak bisa dipakai menebak email mana yang punya akun) — via SMTP, atau di-log ke console `apps/api` kalau `SMTP_HOST` belum dikonfigurasi |
| `POST /auth/reset-password` | Set kata sandi baru pakai `token` dari link reset (berlaku 1 jam), langsung login (set cookie) |
| `POST /auth/change-password` | Ganti kata sandi (perlu `currentPassword` yang benar), butuh sesi login |
| `POST /videos` | Upload video (`multipart/form-data`: `file` + `transcriptionProvider` opsional, `GROQ` kalau tidak diisi), `ownerId` diambil dari sesi — bukan dari body. Enqueue job `transcribe`. 400 kalau `transcriptionProvider: OPENAI` tapi tidak ada `PremiumCredit` yang `PAID` & belum terpakai |
| `GET /videos` | Semua video milik user yang sedang login (terbaru dulu), masing-masing dengan `clips` |
| `GET /videos/:id` | Detail video + daftar `clips` (masing-masing dengan `downloadUrl` kalau sudah di-render). 404 kalau video bukan milik user yang sedang login |
| `GET /videos/:id/source` | Stream video sumber asli (bukan hasil render) untuk preview timeline editor, dengan dukungan HTTP Range agar `<video>` bisa scrub/seek |
| `GET /videos/:id/transcript` | Transcript segment video (dipakai timeline editor untuk caption overlay) — endpoint terpisah dari `GET /videos/:id` supaya endpoint yang di-polling tidak ikut membawa payload transcript |
| `POST /videos/:id/retry` | Retry video berstatus `FAILED` — re-enqueue tahap yang belum selesai (disimpulkan dari data yang sudah ada, lihat `CLAUDE.md`). 400 kalau video bukan `FAILED`, 404 kalau bukan milik user yang sedang login |
| `GET /clips/:id/download` | Stream file klip yang sudah di-render sebagai download. 404 kalau klip bukan milik user yang sedang login |
| `PATCH /clips/:id` | Trim manual dari timeline editor — update `startTime`/`endTime`, `captionStyle`, `hookText`, atau `hashtags` klip. Tidak men-trigger render ulang otomatis |
| `POST /clips/:id/render` | Render ulang satu klip secara eksplisit (reuse job `render-clip` yang sama dengan render pertama) — dipakai setelah trim manual disimpan |
| `POST /clips/:id/publish` | Publish klip ke akun sosmed yang sudah di-connect. `scheduledAt` (ISO 8601) opsional — kalau diisi (waktu masa depan), dijadwalkan alih-alih langsung publish |
| `PATCH /clips/:id/publish/:recordId` | Reschedule `PublishRecord` yang masih `SCHEDULED` ke `scheduledAt` baru. 404 kalau sudah di-klaim poller (bukan `SCHEDULED` lagi) |
| `DELETE /clips/:id/publish/:recordId` | Batalkan `PublishRecord` yang masih `SCHEDULED`. 404 kalau sudah di-klaim poller |
| `GET /social/accounts` | Daftar akun sosmed (YouTube/TikTok/Instagram) yang sudah di-connect user yang sedang login |
| `DELETE /social/accounts/:id` | Disconnect akun sosmed (revoke token di platform, best-effort, lalu hapus record lokal) |
| `GET /social/youtube/connect` \| `GET /social/tiktok/connect` \| `GET /social/instagram/connect` | Mulai OAuth flow connect akun (navigasi browser top-level, bukan `fetch()`) — 503 kalau kredensial OAuth platform terkait belum diisi di env |
| `GET /social/youtube/callback` \| `GET /social/tiktok/callback` \| `GET /social/instagram/callback` | OAuth callback dari masing-masing platform, tidak butuh cookie sesi (identitas user diambil dari `state` yang ditandatangani) |
| `POST /payments/premium-transcription/checkout` | Mulai transaksi Midtrans Snap untuk satu kredit premium transcription (Rp 10.000), kembalikan `snapToken` untuk Snap.js. 503 kalau `MIDTRANS_SERVER_KEY`/`MIDTRANS_CLIENT_KEY` belum diisi |
| `GET /payments/premium-transcription/status` | Apakah user punya `PremiumCredit` `PAID` yang belum terpakai — di-polling `apps/web` setelah checkout sampai webhook Midtrans mengonfirmasi pembayaran |
| `POST /payments/webhook/midtrans` | Notifikasi server-to-server dari Midtrans (bukan dari browser, tidak butuh cookie sesi) — signature-nya diverifikasi dulu sebelum `PremiumCredit` di-update jadi `PAID`/`FAILED`/`EXPIRED` |
| `GET /health` | Health check (tanpa auth) untuk load balancer/orchestrator — `200 {"status":"ok"}` kalau Postgres bisa dijangkau, `503` kalau tidak |

`apps/api` juga fail-fast saat boot kalau env var wajib (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `STORAGE_*`) kosong/hilang, dan mengirim security response headers via `helmet()`. `apps/worker` melakukan validasi env var serupa saat start (`DATABASE_URL`, `REDIS_URL`, `GROQ_API_KEY`, `STORAGE_*` — `OPENAI_API_KEY`/`MIDTRANS_*` sengaja tidak wajib, lihat bagian Environment Variables di atas).

## Docker / Deploy

Setiap app punya `Dockerfile` sendiri (`apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile`), multi-stage, di-build dari **root repo** (bukan dari folder app-nya) karena ini pnpm workspace — `packages/shared`/`packages/database`/`packages/storage` adalah dependency source, bukan package published:

```bash
docker build -f apps/api/Dockerfile -t speedora-api .
docker build -f apps/worker/Dockerfile -t speedora-worker .
# NEXT_PUBLIC_API_URL di-inline ke bundle client saat build, bukan dibaca saat container jalan -
# rebuild image kalau mau ganti API URL-nya.
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t speedora-web .
```

Tidak ada `.env` yang di-copy ke image manapun — semua config lewat environment variable asli yang dikasih saat `docker run`/lewat orchestrator. `apps/api` fail-fast dan `GET /health`-nya (dicek lewat Docker `HEALTHCHECK`) akan langsung ketahuan kalau ada yang kurang. `apps/worker`'s image sudah termasuk `ffmpeg` asli (`apk add ffmpeg`) dan `yt-dlp` (`pip install yt-dlp`, satu layer yang sama dengan mediapipe) — **jangan** override `FFMPEG_PATH`/`YTDLP_PATH` dengan path host kalau lagi jalan di container, biarkan default (sudah ada di `PATH` image-nya).

Database perlu di-migrate dulu sebelum `apps/api`/`apps/worker` jalan — ada `packages/database/Dockerfile` khusus untuk itu (one-shot, bukan service yang jalan terus):

```bash
docker build -f packages/database/Dockerfile -t speedora-migrate .
docker run --rm -e DATABASE_URL=... speedora-migrate
```

[`docker-compose.prod.yml`](./docker-compose.prod.yml) merangkai semuanya (Postgres, Redis, migrate, api, worker, web) jadi referensi deployment yang bisa langsung dicoba:

```bash
docker compose -f docker-compose.prod.yml up --build
```

File ini punya `name: speedora-prod` eksplisit supaya tidak bentrok dengan `docker-compose.yml` (dev, Postgres/Redis saja) kalau keduanya kebetulan jalan bersamaan di direktori yang sama — tanpa itu, compose menganggap service `postgres`/`redis` di kedua file sebagai container yang sama (nama project default dari nama folder), dan `down` salah satu bisa mematikan/menghapus punya yang lain.
