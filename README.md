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

   - `apps/web` → http://localhost:3000
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
```

Detail alur pemrosesan video, keputusan arsitektur, dan konvensi coding ada di [`CLAUDE.md`](./CLAUDE.md).

## Environment Variables

Lihat [`.env.example`](./.env.example) untuk daftar lengkap. Yang penting:

- `DATABASE_URL` — connection string Postgres, dipakai `apps/api` dan `apps/worker` lewat `packages/database`
- `REDIS_URL` — dipakai `apps/api` (enqueue job) dan `apps/worker` (consume job) lewat BullMQ
- `NEXT_PUBLIC_API_URL` — base URL API yang dipanggil `apps/web`
- `OPENAI_API_KEY` — dipakai `apps/worker` untuk transcribe job (Whisper via OpenAI's audio API)
- `FFMPEG_PATH` — path ke binary FFmpeg, dipakai `apps/worker` untuk render-clip job. Default `ffmpeg` (asumsi ada di `PATH`)
- `WEB_ORIGIN` — origin yang diizinkan CORS di `apps/api` untuk request dari `apps/web`. Default `http://localhost:3000`

## API

Endpoint utama di `apps/api` yang dipakai `apps/web`:

| Endpoint | Keterangan |
|---|---|
| `POST /users` | Get-or-create user dari `email` (belum ada sistem auth beneran — ini placeholder identitas) |
| `POST /videos` | Upload video (`multipart/form-data`: `ownerId` + `file`), enqueue job `transcribe` |
| `GET /videos/:id` | Detail video + daftar `clips` (masing-masing dengan `downloadUrl` kalau sudah di-render) |
| `GET /clips/:id/download` | Stream file klip yang sudah di-render sebagai download |
