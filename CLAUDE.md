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
  storage/    # Klien object storage S3-compatible (upload/download/delete), dipakai apps/api dan apps/worker
```

- `apps/web` dan `apps/api` hanya berkomunikasi lewat HTTP API — tidak ada import langsung antar keduanya.
- `apps/worker` tidak melayani HTTP; hanya mengonsumsi job dari BullMQ queue yang di-enqueue oleh `apps/api`.
- Tipe yang dibagi antara frontend, backend, dan worker (mis. bentuk payload job, status enum, DTO) didefinisikan sekali di `packages/shared` — jangan duplikasi tipe di masing-masing app.

## Alur Pemrosesan Video (MVP)

1. **Upload** — `apps/web` upload file ke `apps/api`, video disimpan (object storage), record dibuat di PostgreSQL dengan status `UPLOADED`.
2. **Transcript** — `apps/api` enqueue job `transcribe` ke BullMQ. `apps/worker` menjalankan Whisper, hasil transcript (dengan timestamp) disimpan ke PostgreSQL. Status -> `TRANSCRIBED`.
3. **Auto-clip** — job `detect-clips` (dienqueue oleh `apps/worker` sendiri begitu `transcribe` sukses, bukan oleh `apps/api`) mengirim transcript ke LLM (GPT) untuk memilih 1-3 momen paling menarik/viral-worthy sebagai kandidat klip (start/end timestamp + virality score 0-100). Menghasilkan daftar kandidat klip. Status -> `CLIPS_DETECTED`.
4. **Caption + Reframe** — untuk tiap kandidat klip, `detect-clips` yang sukses langsung enqueue satu job `render-clip` (self-chain, sama seperti `transcribe` -> `detect-clips`). `render-clip` mendeteksi wajah di sepanjang rentang klip (lihat "Smart Reframe (Fase 2)" di bawah), memotong+crop 9:16 video dengan FFmpeg sesuai timestamp klip dan posisi wajah, generate file SRT dari transcript (timestamp digeser relatif ke awal klip), lalu burn-in sebagai subtitle ke video hasil crop. `Clip.outputUrl` di-set setelah render sukses; `Video.status` -> `RENDERED` baru setelah **semua** klip milik video tersebut selesai di-render (bukan begitu klip pertama selesai).
5. **Download** — `apps/web` polling `GET /videos/:id` tiap 2 detik sampai status `RENDERED` atau `FAILED`, lalu menampilkan daftar klip dengan link `GET /clips/:id/download` (`apps/api` streaming file dari object storage, key-nya ada di `Clip.outputUrl`).
6. **Retry** — kalau status `FAILED`, `apps/web` menampilkan tombol Retry yang manggil `POST /videos/:id/retry`. Tahap yang di-retry disimpulkan dari data yang sudah ada (bukan dari marker "gagal di tahap mana" yang disimpan terpisah): belum ada `TranscriptSegment` -> retry `transcribe`; ada segment tapi belum ada `Clip` -> retry `detect-clips`; ada `Clip` tapi sebagian belum punya `outputUrl` -> retry `render-clip` **hanya** untuk klip yang belum itu (tiap klip render independen, jadi satu klip gagal tidak berarti klip lain ikut di-retry). Aman disimpulkan begitu karena `transcribe`/`detect-clips` masing-masing nulis datanya sekaligus naikkan status di step yang sama — kalau job-nya gagal (masuk `catch`), data tahap itu belum sempat ketulis sama sekali. Lihat `VideosService.retry`.

Setiap tahap adalah job terpisah di BullMQ (bukan satu job monolitik) agar retry granular per-tahap dan agar FFmpeg cluster bisa discale independen dari proses ASR.

## Timeline Editor (Fase 1 pasca-MVP)

Route `/videos/:id/edit` di `apps/web` — fine-tune hasil auto-clip sebelum download, tanpa perlu re-upload atau menunggu pipeline ulang dari awal.

- **Preview**: `<video>` (stream source asli via `GET /videos/:id/source`, bukan hasil render) + `<canvas>` overlay di atasnya untuk caption, di-redraw tiap `requestAnimationFrame` mengikuti `video.currentTime`. **Approximate, bukan pixel-perfect** terhadap hasil burn-in libass FFmpeg (font/posisi/outline sederhana) — exact match ditunda ke Fase 3 (custom caption styling), yang nanti natural jadi shared style config antara canvas preview dan FFmpeg ASS override sekaligus.
- **Timeline**: track klip (bar per klip hasil `detect-clips`, drag handle start/end untuk klip yang sedang dipilih) + track caption (transcript segment yang overlap klip terpilih, visual saja, tidak draggable). Dibangun dengan div ber-posisi absolut + persentase (bukan SVG/canvas) untuk timeline-nya sendiri — cuma overlay caption di atas video yang pakai canvas.
- **State**: Zustand (`apps/web/lib/timelineStore.ts`) — cukup ringan untuk state timeline (klip + draft trim + flag dirty/saving/rendering per klip) tanpa perlu Redux penuh.
- **Trim manual TIDAK auto re-render**: `PATCH /clips/:id` (`ClipsService.update`) cuma update `startTime`/`endTime` di DB. Render ulang adalah aksi eksplisit terpisah (`POST /clips/:id/render`) supaya geser slider tidak buang compute FFmpeg tiap perubahan kecil.
- **Re-render reuse job `render-clip` yang sudah ada**, bukan job baru — `render-clip.worker.ts` sudah generik atas start/end dan overwrite key `renders/<clipId>.mp4` yang sama, jadi tidak ada bedanya secara teknis antara render pertama (dari `detect-clips`) dan re-render manual (dari editor). `ClipsService.render` men-clear `Clip.outputUrl` ke `null` **sebelum** enqueue — bukan cuma dibiarkan stale — supaya dua hal yang sudah ada otomatis benar tanpa ubah kode lain: tampilan "Rendering..." di dashboard (sudah ada untuk `downloadUrl: null`) langsung kepakai, dan kalau render-clip job ini gagal, `VideosService.retry`'s pengecekan "klip tanpa `outputUrl` perlu di-render lagi" tetap akurat (bukannya mengira klip ini masih fine karena `outputUrl` lama belum dihapus).
- **`GET /videos/:id/source`** streaming source video (bukan hasil render) dengan dukungan HTTP Range (`packages/storage`'s `getObjectStreamRange`) supaya `<video>` bisa scrub/seek tanpa download seluruh file dulu — `<video crossOrigin="use-credentials">` di frontend supaya cookie sesi ikut terkirim cross-origin (api beda port dari web). Proxy lewat `apps/api` (bukan presigned URL langsung ke R2), konsisten dengan keputusan storage yang sudah ada: client tidak pernah akses bucket langsung.
- **`GET /videos/:id/transcript`** endpoint terpisah dari `findOne()`/`GET /videos/:id` — sengaja tidak digabung supaya endpoint yang di-polling tiap 2 detik (upload progress, dashboard) tidak ikut membawa payload transcript (bisa banyak baris untuk video panjang) padahal cuma editor yang butuh teksnya.
- **`filterSegmentsForClip`** (overlap-filter transcript-untuk-rentang-klip) diekstrak ke `packages/shared/src/utils/transcript.ts` — sebelumnya duplikat identik di `detect-clips.worker.ts` dan `VideosService.retry`; ClipsService.render jadi pemakai ketiga, titik di mana duplikasi lebih dari cukup untuk diekstrak jadi util bersama.

## Smart Reframe (Fase 2 pasca-MVP)

Setiap `render-clip` job sekarang men-crop video ke 9:16 mengikuti wajah yang paling menonjol di frame, bukan sekadar center-crop statis dari aspect ratio asli.

- **Inline di job `render-clip` yang sudah ada, bukan job BullMQ baru** (`detect-faces`) — deteksi wajah adalah sub-step di awal `render-clip` (posisinya setara dengan `buildSrt()` yang sudah ada: dihitung, dipakai, lalu buang, tidak disimpan lintas job). Tidak perlu schema baru di `Clip`, tidak perlu cabang baru di `VideosService.retry` — kalau `render-clip` gagal (termasuk karena deteksi wajah), seluruh job itu yang di-retry sebagai satu unit, sama seperti perilakunya sebelum fase ini.
- **MediaPipe dijalankan lewat subprocess Python asli** (`apps/worker/scripts/detect_faces.py`, dipanggil dari `apps/worker/src/faceDetection.ts` via `child_process` — pola yang sama persis dengan `apps/worker/src/ffmpeg.ts` manggil binary `ffmpeg`), bukan lewat `@mediapipe/tasks-vision` (WASM/Node). MediaPipe secara resmi paling matang di Python/browser, bukan Node server-side. Pakai **Tasks API** (`mediapipe.tasks.python.vision.FaceDetector`) — API lama `mp.solutions.face_detection` sudah **dihapus** di rilis mediapipe terbaru (0.10.x). Tasks API butuh file model `.tflite` terpisah (tidak dibundel di pip package) — di-download dari model zoo MediaPipe, disimpan di `apps/worker/models/` (gitignored, bukan aset yang di-commit; lihat README.md untuk cara download-nya).
- **`node:20-alpine` -> `node:20-slim` (Debian/glibc) untuk image `apps/worker`** — MediaPipe's PyPI wheels **tidak ada build musl (Alpine) sama sekali** (`pip install mediapipe` di Alpine langsung gagal "No matching distribution"). `opencv-python-headless` juga butuh beberapa shared library sistem meski headless (`libxcb1 libxext6 libsm6 libgl1 libglib2.0-0 libgomp1 libxrender1 libegl1 libgles2` — ditemukan lewat trial-and-error terhadap container asli, bukan disalin dari satu sumber tunggal) dan `pip install --break-system-packages` (Debian 12 menerapkan PEP 668 untuk system Python).
- **Deteksi wajah tidak boleh menggagalkan job** — `detectFaces()` di-try/catch dalam `buildReframePlan()` (`render-clip.worker.ts`); kalau subprocess Python gagal karena alasan APAPUN (bukan cuma "tidak ada wajah", tapi juga mis. environment bermasalah), fallback ke center-crop statis, bukan melempar error. Ini perluasan alami dari requirement "jangan gagal cuma karena tidak ada wajah" ke "jangan gagal karena mekanisme deteksinya sendiri bermasalah".
- **Heuristik "wajah paling menonjol", bukan deteksi speaker aktif sungguhan** — kalau ada lebih dari satu wajah di satu frame sampel, dipilih yang bounding box-nya paling besar (proxy untuk "yang bicara"). Deteksi speaker aktif sungguhan (perlu Face Landmarker + korelasi audio) di luar scope fase ini.
- **Sampling ~1 frame/detik** (`FACE_SAMPLE_INTERVAL_SECONDS` di `apps/worker/src/faceDetection.ts`) — klip auto-detect sudah dibatasi 5-60 detik oleh prompt LLM `detect-clips`, jadi maksimal ~60 titik sampel per klip. Python baca frame langsung lewat OpenCV `VideoCapture.set(CAP_PROP_POS_MSEC, ...)` (seek langsung, bukan ekstrak semua frame ke file gambar dulu) — jadi `reserveScratchPath` yang sudah ada **tetap cukup dipakai apa adanya** tanpa perlu direktori scratch baru untuk frame; satu-satunya scratch file baru adalah command file `sendcmd` (lihat di bawah).
- **Interpolasi crop-path dihitung di TypeScript** (`apps/worker/src/reframe.ts`, step lebih rapat — `CROP_PATH_STEP_SECONDS` 0.2 detik — daripada sampling deteksi wajah), bukan sebagai satu ffmpeg expression yang panjang. Hasilnya di-generate jadi file command `sendcmd` (satu baris per titik interpolasi: `TIME crop@reframe x X, crop@reframe y Y;`) yang dipasang sebelum filter `crop` yang di-tag `@reframe` di filtergraph FFmpeg (`crop@reframe=w=W:h=H:x=X0:y=Y0`) — diverifikasi langsung dengan video test pattern sungguhan (posisi crop terbukti benar-benar bergerak, bukan cuma diam di X0/Y0).
- **Fallback ke center-crop statis** (tanpa `sendcmd`, filter `crop=` polos) kalau tidak ada wajah terdeteksi di **satu pun** sampel sepanjang klip (`buildCropPath()` return `null`) — bukan cuma error handling, tapi juga menghindari generate crop-path yang sebenarnya konstan (percuma).
- **Crop cuma gerak di satu sumbu** — untuk source landscape (kasus paling umum, `sourceAspect > 9/16`), tinggi penuh dipertahankan dan cuma lebar yang di-crop, jadi cuma X yang bergerak (Y tetap 0); untuk source yang sudah portrait, sebaliknya. `computeCropDimensions()` selalu membulatkan ke angka genap (requirement `libx264`/`yuv420p`, menolak lebar/tinggi ganjil).

## Keputusan Arsitektur

- **BullMQ dipakai untuk semua kerja berat/async** (transcribe, detect-clips, render-clip). API layer tidak pernah menjalankan Whisper atau FFmpeg secara sinkron di request-response cycle.
- **Worker dipisah dari API** supaya FFmpeg cluster dan proses ASR yang CPU/GPU-intensive bisa di-scale terpisah dari layer API yang menangani traffic HTTP.
- **PostgreSQL sebagai source of truth** untuk status job dan metadata video/klip; Redis hanya untuk antrian (BullMQ) dan cache, bukan penyimpanan permanen.
- **Status video/klip berbentuk state machine linear** (`UPLOADED -> TRANSCRIBED -> CLIPS_DETECTED -> RENDERED`) yang disimpan di PostgreSQL agar frontend bisa polling progres secara konsisten.
- **Prisma di `packages/database` sebagai satu-satunya akses ke PostgreSQL**, dipakai baik oleh `apps/api` maupun `apps/worker` (model: `User`, `Video`, `TranscriptSegment`, `Clip` — lihat `packages/database/prisma/schema.prisma`). Transcript segment disimpan per-video (bukan diduplikasi per-klip); transcript sebuah klip didapat dengan query segment dalam rentang `startTime`-`endTime` klip tersebut.
- **Video disimpan di object storage S3-compatible** (`packages/storage`, dipakai bareng oleh `apps/api` dan `apps/worker`), bukan local disk — supaya `apps/api` dan `apps/worker` (proses terpisah, bisa jalan di mesin/container berbeda) tidak perlu berbagi filesystem. `apps/api/src/storage` upload buffer hasil multer langsung ke bucket lewat `uploadObject()`, `Video.sourceUrl` menyimpan **object key** (`videos/<uuid>.<ext>`), bukan path. Konfigurasi lewat env var generik `STORAGE_*` (`STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_FORCE_PATH_STYLE`) — bukan `R2_*` — supaya provider-nya bisa diganti (mis. AWS S3) tanpa ubah kode, walau dev saat ini dites terhadap Cloudflare R2 asli. `packages/storage` pakai lazy singleton (`getClient()`, konstruksi `S3Client` ditunda sampai first use) untuk hindari bug class baca `process.env` sebelum `.env` ke-load — sama seperti kasus `QueueModule`/`JwtStrategy`.
- **`apps/worker` baca source video langsung dari object storage tanpa nyentuh disk untuk job `transcribe`** — `getObjectStream()` mengembalikan Node `Readable`, di-pipe langsung ke `toFile()` (helper dari OpenAI SDK yang terima `AsyncIterable`) lalu masuk ke Whisper API. Untuk job `render-clip`, FFmpeg **butuh path file lokal asli** (tidak bisa seek/tulis langsung ke object storage), jadi `apps/worker/src/storage.ts` cuma menyediakan **scratch space sementara** di `os.tmpdir()` (`reserveScratchPath()`) — source didownload ke situ, FFmpeg proses di situ, hasil render diupload balik ke bucket (`renders/<clipId>.mp4`), lalu semua file scratch (source/SRT/output) dihapus di blok `finally` terlepas sukses/gagal.
- **Worker meng-update status video sendiri** setelah job selesai (mis. `transcribe` job set status `TRANSCRIBED` setelah berhasil, atau `FAILED` kalau error), bukan lewat callback ke `apps/api`.
- **Worker self-chains job berikutnya dalam pipeline**: `transcribe` job yang sukses langsung enqueue job `detect-clips` sendiri, dan `detect-clips` yang sukses langsung enqueue satu job `render-clip` per kandidat klip (lihat `apps/worker/src/queues.ts`), bukan lewat `apps/api`. Orkestrasi antar-tahap pipeline berada di `apps/worker`, bukan di layer API.
- **FFmpeg dipanggil langsung via `child_process`** (bukan wrapper library seperti `fluent-ffmpeg`) dari `apps/worker/src/ffmpeg.ts`. Butuh binary FFmpeg tersedia (di `PATH`, atau via `FFMPEG_PATH`) di environment tempat `apps/worker` jalan.
- **Render output diupload ke object storage juga** (prefix `renders/`, key `renders/<clipId>.mp4`), konsisten dengan keputusan storage video asli — `apps/worker` satu-satunya penulis object ini.
- **`GET /videos/:id` tidak mengembalikan `Clip.outputUrl` mentah** (object storage key) ke client; di-map jadi `downloadUrl` (`/clips/:id/download` relatif) supaya detail implementasi storage tidak bocor ke API response. `GET /clips/:id/download` di `apps/api` stream file dari bucket lewat `getObjectStream()` (bukan `res.download()` ke path lokal lagi).
- **CORS di `apps/api` di-enable eksplisit dengan `credentials: true`** (`WEB_ORIGIN`, default `http://localhost:3000`) supaya `apps/web` (origin beda, port 3000) bisa manggil `apps/api` (port 3001) dari browser sambil ikut kirim cookie sesi.
- **Auth: email + password + JWT di httpOnly cookie**, bukan token di `localStorage`/`Authorization` header. `AuthModule` (`apps/api/src/auth`) — `POST /auth/register` (bcrypt hash, langsung login), `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. `JwtStrategy` extract token dari cookie `token`, bukan `Bearer` header. `ownerId` untuk video **selalu** diambil dari user di sesi (`@CurrentUser()`), tidak pernah dari body request — endpoint lama `POST /users` (get-or-create by email tanpa password) sudah dihapus karena itu lubang keamanan (siapa saja bisa "jadi" user manapun cuma dengan tahu emailnya).
- **`GET /videos/:id` dan `GET /clips/:id/download` mengecek kepemilikan** (`video.ownerId`/`clip.video.ownerId` harus sama dengan user di sesi) dan melempar 404 yang sama baik untuk resource yang tidak ada maupun resource milik user lain — supaya endpoint tidak bisa dipakai untuk menebak ID mana yang valid.
- **`apps/web` punya dua route**: `/` (upload video baru + progress live untuk video yang baru saja di-upload) dan `/dashboard` (riwayat semua video milik user, lewat `GET /videos`). Keduanya pakai `useAuth()` hook yang sama (`lib/useAuth.ts`) untuk cek sesi via `GET /auth/me` — bukan `localStorage` — supaya status login selalu konsisten dengan sesi di server.
- **`POST /auth/login` di-rate-limit** (5 percobaan / 60 detik, per IP, via `@nestjs/throttler`). `ThrottlerGuard` **tidak** didaftarkan global — cuma dipasang `@UseGuards(ThrottlerGuard)` langsung di route `login`, jadi endpoint lain (termasuk `/auth/register`) tidak kena efeknya. Config in-memory (bukan Redis-backed) karena `apps/api` masih jalan sebagai satu instance untuk MVP ini.
- **Env var wajib divalidasi saat boot, gagal cepat kalau ada yang kosong** — `apps/api/src/config/env.validation.ts` (dipasang via `ConfigModule.forRoot({ validate })`, jalan sinkron sebelum modul lain di-build) dan `apps/worker/src/env.ts` (dipanggil di `main.ts` tepat setelah `dotenv.config()`, sebelum modul lain yang baca `process.env` di-import). Cuma var tanpa fallback aman yang wajib (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`/`OPENAI_API_KEY`, `STORAGE_*`) — var yang sudah punya default masuk akal di kode (`WEB_ORIGIN`, `API_PORT`, `JWT_EXPIRES_IN`, `FFMPEG_PATH`) tidak diwajibkan. Tujuannya supaya `JWT_SECRET` kosong (yang tanpa ini akan diam-diam sign token dengan `undefined`) atau `STORAGE_*` kosong (yang tanpa ini akan gagal jauh di dalam percobaan koneksi S3) langsung ketahuan di boot, bukan nanti pas runtime.
- **`apps/api` pakai `helmet()`** (security response headers: CSP, HSTS, X-Frame-Options, dst — lihat `apps/api/src/main.ts`) dan punya endpoint **`GET /health`** (tidak perlu auth, tidak di-rate-limit — dipanggil load balancer/orchestrator) yang query `SELECT 1` ke Postgres dan balas `503` kalau DB tidak bisa dijangkau.
- **Tiap app punya `Dockerfile` multi-stage sendiri**, di-build dari root repo (workspace deps butuh akses ke `packages/*`). Pakai `pnpm deploy --prod --ignore-scripts` untuk bundel dist + production deps app tersebut jadi direktori yang self-contained tanpa symlink workspace (`--ignore-scripts` karena kalau tidak, postinstall `packages/database` — `prisma generate` — jalan ulang di install `--prod`, padahal `prisma` CLI-nya sendiri devDependency yang sudah kepangkas; generated client dari build step sebelumnya sudah ikut ter-copy apa adanya). Tidak ada `.env` yang di-copy ke image manapun — `envFilePath`/`dotenv.config()` yang dipakai `apps/api`/`apps/worker` cuma no-op kalau file-nya tidak ada, sama seperti perilakunya di CI, dan config sepenuhnya datang dari environment variable asli yang dikasih saat container jalan. `apps/worker`'s image nginstall `ffmpeg` asli lewat `apk` — kalau override `FFMPEG_PATH`, pastikan itu path di *dalam* container, bukan path host (gampang kebawa kalau reuse `.env` dev apa adanya buat container). `apps/web`'s image pakai Next.js `output: 'standalone'` (lihat `next.config.mjs`) plus `NEXT_PUBLIC_API_URL` sebagai build arg (bukan runtime env — `NEXT_PUBLIC_*` di-inline ke bundle client saat `next build`). Migration jalan lewat `packages/database/Dockerfile` terpisah (single-stage, full install biar `prisma` CLI-nya ada) sebagai one-shot job sebelum `apps/api`/`apps/worker` start — lihat `docker-compose.prod.yml`, service `migrate` pakai `condition: service_completed_successfully` supaya api/worker nunggu migration selesai dulu.

## Konvensi Coding

- Bahasa: TypeScript di seluruh monorepo (`apps/web`, `apps/api`, `apps/worker`, `packages/shared`).
- Semua kontrak data (job payload, DTO API, enum status) didefinisikan di `packages/shared` dan diimpor, bukan diduplikasi.
- Job BullMQ dinamai dengan verb-noun (`transcribe`, `detect-clips`, `render-clip`) dan payload/return type-nya didefinisikan di `packages/shared`.
- Perubahan skema PostgreSQL melalui migration (bukan sync otomatis) agar histori skema terlacak.

## Status

MVP (upload -> transcript -> auto-clip -> caption -> download, plus retry, object storage di Cloudflare R2, dan Docker/deploy readiness) selesai dan sudah di-merge ke master.

Roadmap pasca-MVP (satu fase per PR):

1. ✅ **Timeline Editor interaktif** (`apps/web`) — selesai. Lihat bagian "Timeline Editor (Fase 1 pasca-MVP)" di atas.
2. ✅ **Smart reframe — auto-track wajah untuk crop 9:16** (`apps/worker`) — selesai. Lihat bagian "Smart Reframe (Fase 2 pasca-MVP)" di atas.
3. ⏳ Caption styling custom — karaoke/bold-highlight (`apps/worker` + `apps/web`)
4. ⏳ Observability dasar — Sentry error tracking (`apps/api` + `apps/worker`)
5. ⏳ Hook generator + auto hashtag AI (`apps/worker`, extend LLM pipeline yang sudah ada)
6. ⏳ Publish scheduler multi-platform + analytics dashboard (fase besar, dipecah lagi nanti)

Update bagian ini setelah tiap fase selesai, dan tetap catat keputusan arsitektur baru (mis. strategi storage, provider hosting FFmpeg cluster, algoritma deteksi klip yang dipakai) di bagian yang relevan di atas.
