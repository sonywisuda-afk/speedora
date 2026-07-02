# viral-clip-app

[![CI](https://github.com/sonywisuda-afk/viral-clip-app/actions/workflows/ci.yml/badge.svg)](https://github.com/sonywisuda-afk/viral-clip-app/actions/workflows/ci.yml)
[![CI web](https://github.com/sonywisuda-afk/viral-clip-app/actions/workflows/ci-web.yml/badge.svg)](https://github.com/sonywisuda-afk/viral-clip-app/actions/workflows/ci-web.yml)
[![CI api](https://github.com/sonywisuda-afk/viral-clip-app/actions/workflows/ci-api.yml/badge.svg)](https://github.com/sonywisuda-afk/viral-clip-app/actions/workflows/ci-api.yml)
[![CI worker](https://github.com/sonywisuda-afk/viral-clip-app/actions/workflows/ci-worker.yml/badge.svg)](https://github.com/sonywisuda-afk/viral-clip-app/actions/workflows/ci-worker.yml)
[![License](https://img.shields.io/badge/license-proprietary-red.svg)](./LICENSE)

AI video repurposing platform (mirip OpusClip) — upload video panjang, otomatis dipotong jadi klip pendek dengan caption. Lihat [`CLAUDE.md`](./CLAUDE.md) untuk ringkasan arsitektur dan keputusan desain.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) 9.x (lihat catatan instalasi di bawah kalau `pnpm` belum ada di PATH)
- [Docker](https://www.docker.com/) (untuk Postgres + Redis lokal)
- [FFmpeg](https://ffmpeg.org/) di `PATH` (untuk `apps/worker`'s `render-clip` job — potong video & burn-in caption). Kalau tidak di `PATH`, set `FFMPEG_PATH` di `.env` ke path binary-nya.
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
   pnpm --filter @viral-clip-app/database db:migrate:dev
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
pnpm --filter @viral-clip-app/api start:dev
pnpm --filter @viral-clip-app/worker dev
pnpm --filter @viral-clip-app/shared build
```

## Database

`packages/database` pakai [Prisma](https://www.prisma.io/) (provider `postgresql`) sebagai ORM & migration tool, dipakai bersama oleh `apps/api` dan `apps/worker`. Skema ada di `packages/database/prisma/schema.prisma`, client hasil generate masuk ke `packages/database/src/generated/prisma` (gitignored, dibuat otomatis lewat `postinstall` setiap `pnpm install`).

Dijalankan dengan `pnpm --filter @viral-clip-app/database <script>`:

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
  worker/     # Konsumer BullMQ — transcribe (Whisper), detect-clips, render-clip (FFmpeg)
packages/
  shared/     # Tipe TypeScript & util yang dipakai lintas apps
  database/   # Prisma schema/client Postgres, dipakai apps/api dan apps/worker
  storage/    # Klien object storage S3-compatible (upload/download/delete), dipakai apps/api dan apps/worker
```

Detail alur pemrosesan video, keputusan arsitektur, dan konvensi coding ada di [`CLAUDE.md`](./CLAUDE.md).

## Environment Variables

Lihat [`.env.example`](./.env.example) untuk daftar lengkap. Yang penting:

- `DATABASE_URL` — connection string Postgres, dipakai `apps/api` dan `apps/worker` lewat `packages/database`
- `REDIS_URL` — dipakai `apps/api` (enqueue job) dan `apps/worker` (consume job) lewat BullMQ
- `NEXT_PUBLIC_API_URL` — base URL API yang dipanggil `apps/web`
- `OPENAI_API_KEY` — dipakai `apps/worker` untuk transcribe job (Whisper via OpenAI's audio API)
- `FFMPEG_PATH` — path ke binary FFmpeg, dipakai `apps/worker` untuk render-clip job. Default `ffmpeg` (asumsi ada di `PATH`)
- `STORAGE_ENDPOINT` / `STORAGE_REGION` / `STORAGE_BUCKET` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` / `STORAGE_FORCE_PATH_STYLE` — kredensial & config bucket object storage S3-compatible (dipakai `packages/storage`, oleh `apps/api` untuk upload video dan `apps/worker` untuk baca source + upload hasil render). Nama var generik (bukan `R2_*`) supaya provider bisa diganti tanpa ubah kode; **isi sendiri di `.env` lokal**, jangan commit nilai asli
- `WEB_ORIGIN` — origin yang diizinkan CORS di `apps/api` untuk request dari `apps/web`
- `JWT_SECRET` — secret untuk sign JWT auth. **Generate sendiri** (`openssl rand -hex 32`), jangan pakai default di `.env.example`
- `JWT_EXPIRES_IN` — masa berlaku token auth. Default `7d`

## API

Endpoint utama di `apps/api`. Semua endpoint kecuali `/auth/register`, `/auth/login`, dan `/health` butuh cookie sesi (login dulu):

| Endpoint | Keterangan |
|---|---|
| `POST /auth/register` | Buat akun (`email` + `password`, min. 8 karakter), langsung login (set cookie) |
| `POST /auth/login` | Login, set cookie sesi (`httpOnly`, JWT) |
| `POST /auth/logout` | Hapus cookie sesi |
| `GET /auth/me` | Info user yang sedang login (401 kalau belum login) |
| `POST /videos` | Upload video (`multipart/form-data`: `file`), `ownerId` diambil dari sesi — bukan dari body. Enqueue job `transcribe` |
| `GET /videos` | Semua video milik user yang sedang login (terbaru dulu), masing-masing dengan `clips` |
| `GET /videos/:id` | Detail video + daftar `clips` (masing-masing dengan `downloadUrl` kalau sudah di-render). 404 kalau video bukan milik user yang sedang login |
| `GET /videos/:id/source` | Stream video sumber asli (bukan hasil render) untuk preview timeline editor, dengan dukungan HTTP Range agar `<video>` bisa scrub/seek |
| `GET /videos/:id/transcript` | Transcript segment video (dipakai timeline editor untuk caption overlay) — endpoint terpisah dari `GET /videos/:id` supaya endpoint yang di-polling tidak ikut membawa payload transcript |
| `POST /videos/:id/retry` | Retry video berstatus `FAILED` — re-enqueue tahap yang belum selesai (disimpulkan dari data yang sudah ada, lihat `CLAUDE.md`). 400 kalau video bukan `FAILED`, 404 kalau bukan milik user yang sedang login |
| `GET /clips/:id/download` | Stream file klip yang sudah di-render sebagai download. 404 kalau klip bukan milik user yang sedang login |
| `PATCH /clips/:id` | Trim manual dari timeline editor — update `startTime`/`endTime` klip. Tidak men-trigger render ulang otomatis |
| `POST /clips/:id/render` | Render ulang satu klip secara eksplisit (reuse job `render-clip` yang sama dengan render pertama) — dipakai setelah trim manual disimpan |
| `GET /health` | Health check (tanpa auth) untuk load balancer/orchestrator — `200 {"status":"ok"}` kalau Postgres bisa dijangkau, `503` kalau tidak |

`apps/api` juga fail-fast saat boot kalau env var wajib (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `STORAGE_*`) kosong/hilang, dan mengirim security response headers via `helmet()`. `apps/worker` melakukan validasi env var serupa saat start (`DATABASE_URL`, `REDIS_URL`, `OPENAI_API_KEY`, `STORAGE_*`).

## Docker / Deploy

Setiap app punya `Dockerfile` sendiri (`apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile`), multi-stage, di-build dari **root repo** (bukan dari folder app-nya) karena ini pnpm workspace — `packages/shared`/`packages/database`/`packages/storage` adalah dependency source, bukan package published:

```bash
docker build -f apps/api/Dockerfile -t viral-clip-app-api .
docker build -f apps/worker/Dockerfile -t viral-clip-app-worker .
# NEXT_PUBLIC_API_URL di-inline ke bundle client saat build, bukan dibaca saat container jalan -
# rebuild image kalau mau ganti API URL-nya.
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t viral-clip-app-web .
```

Tidak ada `.env` yang di-copy ke image manapun — semua config lewat environment variable asli yang dikasih saat `docker run`/lewat orchestrator. `apps/api` fail-fast dan `GET /health`-nya (dicek lewat Docker `HEALTHCHECK`) akan langsung ketahuan kalau ada yang kurang. `apps/worker`'s image sudah termasuk `ffmpeg` asli (`apk add ffmpeg`) — **jangan** override `FFMPEG_PATH` dengan path host kalau lagi jalan di container, biarkan default (`ffmpeg`, sudah ada di `PATH` image-nya).

Database perlu di-migrate dulu sebelum `apps/api`/`apps/worker` jalan — ada `packages/database/Dockerfile` khusus untuk itu (one-shot, bukan service yang jalan terus):

```bash
docker build -f packages/database/Dockerfile -t viral-clip-app-migrate .
docker run --rm -e DATABASE_URL=... viral-clip-app-migrate
```

[`docker-compose.prod.yml`](./docker-compose.prod.yml) merangkai semuanya (Postgres, Redis, migrate, api, worker, web) jadi referensi deployment yang bisa langsung dicoba:

```bash
docker compose -f docker-compose.prod.yml up --build
```

File ini punya `name: viral-clip-app-prod` eksplisit supaya tidak bentrok dengan `docker-compose.yml` (dev, Postgres/Redis saja) kalau keduanya kebetulan jalan bersamaan di direktori yang sama — tanpa itu, compose menganggap service `postgres`/`redis` di kedua file sebagai container yang sama (nama project default dari nama folder), dan `down` salah satu bisa mematikan/menghapus punya yang lain.
