# CLAUDE.md

Architecture & convention reference for **Speedora** — an AI video repurposing platform (OpusClip-
style) that turns long videos into short, viral-ready clips automatically.

This file is an **index**. Detailed, current-state documentation lives in [`docs/`](docs/);
this file stays short on purpose so it's cheap to load every session. Historical "how we got
here" narrative for each shipped feature has been distributed into the topic docs below (as
durable facts, not a session-by-session changelog) — check `git log`/PR history if you need the
literal chronology.

## Product summary

Core MVP flow:

```
Upload video → Transcript (ASR) → Auto-clip detection → Caption + Reframe render → Download
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js + TypeScript |
| Backend API | NestJS |
| Database | PostgreSQL via Prisma (`packages/database`) |
| Queue / Cache | Redis + BullMQ |
| Video processing | FFmpeg (separate worker nodes) |
| ASR | Whisper — Groq `whisper-large-v3-turbo` (default, free) or OpenAI `whisper-1` (paid premium) |
| Object storage | S3-compatible — MinIO in dev, Cloudflare R2 in production |

## Monorepo layout

```
apps/
  web/        # Next.js frontend
  api/        # NestJS backend
  worker/     # BullMQ job consumer — ASR, clip detection, FFmpeg render, AI analysis
packages/
  shared/, database/, storage/, social/, contracts/    # cross-cutting infrastructure
  clip-scoring/, cutlist/, subtitles/, reframe/, emoji-suggester/,
  audio-intelligence/, scene-intelligence/, facial-intelligence/,
  gesture-intelligence/, ocr-intelligence/, object-intelligence/, editing-rhythm/,
  fusion-engine/                                       # stateless JSON-in/JSON-out AI modules
```

`apps/web` and `apps/api` only communicate over HTTP. `apps/worker` has no HTTP server — it only
consumes BullMQ jobs. Every AI analysis capability is a small, independently-testable stateless
package following one architectural pattern — see [`ARCHITECTURE.md`](ARCHITECTURE.md) for the
pattern itself and its "add a new module" checklist.

## Documentation index

| Doc | Covers |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Full pipeline, state machine, job design, storage, auth, the JSON-contract pattern, AI signal flow |
| [`docs/coding-standards.md`](docs/coding-standards.md) | Conventions: module checklist, extraction discipline, "scale honesty", data-shape conventions, the recurring TS2742 pitfall |
| [`docs/backend.md`](docs/backend.md) | `apps/api` — auth, endpoints, Publish Center (YouTube/TikTok/Instagram), payments |
| [`docs/frontend.md`](docs/frontend.md) | `apps/web` — routes, Timeline Editor, Dashboard, OCR Review UI, processing UX |
| [`docs/worker.md`](docs/worker.md) | `apps/worker` — job handlers, the full `render-clip` pipeline, Smart Reframe, captions, B-roll |
| [`docs/queue.md`](docs/queue.md) | BullMQ queue design, self-chaining, retry semantics |
| [`docs/database.md`](docs/database.md) | Prisma schema overview, `Clip`'s AI-signal columns, retry inference |
| [`docs/prisma.md`](docs/prisma.md) | Prisma-specific conventions, `Prisma.JsonNull`, the TS2742 pitfall in detail |
| [`docs/redis.md`](docs/redis.md) | Redis usage (BullMQ backing store, rate limiting) — never durable state |
| [`docs/docker.md`](docs/docker.md) | Image builds, MinIO (dev) vs. R2 (prod) storage |
| [`docs/deployment.md`](docs/deployment.md) | Production compose, env var layering |
| [`docs/testing.md`](docs/testing.md) | Module vs. adapter test split, real-Postgres verification, known verification gaps |
| [`docs/ai/llm.md`](docs/ai/llm.md) | The `detect-clips` LLM call — clip selection, `ClipScores`, hooks/hashtags, emoji suggestions |
| [`docs/ai/vision.md`](docs/ai/vision.md) | Face detection/reframe, Face Intelligence (23 sub-features), Gesture Intelligence, Scene Intelligence |
| [`docs/ai/audio.md`](docs/ai/audio.md) | Loudness/RMS/speaking-rate, Speaker Diarization, Vocal Emotion Detection |
| [`docs/ai/ocr.md`](docs/ai/ocr.md) | On-screen text detection, tracking, classification, evaluation tooling, Review UI |
| [`docs/ai/fusion.md`](docs/ai/fusion.md) | The Fusion Engine — current pipeline, weights, prediction/recommendation |
| [`docs/ai/scoring.md`](docs/ai/scoring.md) | How `viralityScore`/`ClipScores`/`highlightScore` relate (they are three different systems) |
| [`docs/ai/speaker-intelligence.md`](docs/ai/speaker-intelligence.md) | Speaker Intelligence roadmap (VAD, Active Speaker Detection, Face-Voice Association, Speaker Timeline/Scoring) — contracts-only status vs. what's already covered by Face/Audio/Gesture Intelligence |
| [`docs/ai/object-intelligence.md`](docs/ai/object-intelligence.md) | Object Intelligence roadmap (per-entity detection/tracking/behavioral features — a separate package from Scene Intelligence) — MediaPipe detector choice, multi-object tracker design, Batch OI-1 through OI-5 (complete) |

## Status

MVP (upload → transcript → auto-clip → caption → download, retry, object storage, Docker/deploy
readiness) is complete and in production.

Everything since the MVP has followed one architectural throughline: the **JSON-contract stateless
module pattern** (`ARCHITECTURE.md`) — proven on a reference module, then used to migrate existing
worker logic, then to add DB audit-trail infrastructure, then proven again on a feature built from
scratch. On top of that pattern sits the **AI Fusion & Multi-Modal Highlight Scoring** initiative:
independent analysis modules for Audio, Scene, Facial, Gesture, OCR, and LLM-derived signals, each
feeding a shared Fusion Engine that produces one explainable `highlightScore` per clip.

High-level state of each major initiative (see the linked docs for what's actually implemented):

- **Editor & rendering features** (Timeline Editor, Smart Reframe/Auto Zoom, caption styling,
  Sentry observability, hook/hashtag generation, Publish Center for YouTube/TikTok/Instagram,
  premium transcription payments, Content Intelligence scoring, Smart Trim/silence removal,
  cross-clip heatmap dashboard, Smart Transitions, Auto B-roll with a 3-provider adapter, B-roll
  normalization, seamless long-video chunking) — all shipped. See `worker.md`, `frontend.md`,
  `backend.md`.
- **JSON-contract module pattern** — established, applied to every existing worker module, proven
  on state-machine audit-trail infra and on a feature built from scratch. See `ARCHITECTURE.md`.
- **Audio / Scene / Facial Intelligence** (Checkpoint 1) — done. **Mini Fusion Engine v1 → v2 →
  v2.1** — done (weighted feature-level fusion, confidence, explainability, ranking, LLM signal,
  prediction/recommendation). See `ai/fusion.md`.
- **Gesture Intelligence, Face Intelligence (5 batches, 23 sub-features), Scene Intelligence
  taxonomy (cut classification, motion energy, directional camera motion, plus the derived-only
  Motion Intelligence batches SC-4 through SC-7 — Motion Direction, Peak Detection, Complexity,
  Smoothness/Camera Jitter)** — done, all wired into the Fusion Engine at weight 0 pending
  calibration. See `ai/vision.md`.
- **OCR Intelligence** (detection → tracking/classification → evaluation tooling → dataset
  annotation UI) — done through OCR-2.5, wired into the Fusion Engine at a real 10% weight. OCR-3
  (object detector) and OCR-4 (scene understanding) are deferred pending a real annotated dataset.
  See `ai/ocr.md`.
- **Object Intelligence roadmap** (per-entity detection/tracking/behavioral features — people,
  vehicles, products, animals) — a separate package from Scene Intelligence, **complete** (OI-1
  through OI-5, closing out the originally-scoped 10-feature taxonomy). Batch OI-1 (Foundation:
  MediaPipe Object Detector + a genuinely multi-object tracker generalizing OCR Intelligence's
  tracker), OI-2 (motion speed/direction, reusing Scene Intelligence's `CameraMotionDirectionType`),
  OI-3 (occlusion — the first OI feature comparing detections across the same frame, not just
  across time), OI-4 (interaction, exposed as `interactionConfidence` — a 3-component composite of
  proximity/temporal co-presence/distance trend, explicitly named to avoid implying real
  interaction detection this pipeline has no depth/pose/action recognition to support), and OI-5
  (`objectAttentionScore` — not a flat average but a "domain of domains" composite of Visibility/
  Activity/Social sub-scores, mirroring the top-level Fusion Engine's own layered shape one level
  down, plus a separate `objectAttentionConfidence` reliability signal mirroring Speaker
  Intelligence's confidence-score pattern) are all done, wired into the Fusion Engine at weight 0.
  See `ai/object-intelligence.md`.
- **Editing Rhythm** (tempo/pacing/acceleration, a composite signal built from other signals'
  already-computed features) — done, wired at a heuristic (unvalidated) 5% weight since production
  has 0 usable samples to calibrate against yet (`apps/worker/src/scripts/
  check-calibration-coverage.ts` is the reusable check — rerun it as production data accumulates).
  See `ai/fusion.md`.
- **Speaker Intelligence roadmap** (VAD, Active Speaker Detection, Face-Voice Association, Lip
  Sync Verification, Speaker Timeline, Speaker Quality/Confidence/Importance/Engagement/
  Attention/Highlight scoring, Conversation Type Classification) — **contracts only**
  (`packages/contracts/src/{voice-activity,speaker-diarization,vocal-emotion,active-speaker,
  speaker-timeline,speaker-quality,speaking-style,conversation-intelligence,speaker-scoring}.ts`),
  no detectors/wiring built yet. Speaker Diarization and Vocal Emotion Detection (already shipped
  in `apps/worker`) were formalized into real Zod contracts in the same pass, closing a gap where
  they were the only two Python-subprocess detectors using an unchecked cast instead of
  `OutputSchema.parse()`. See `ai/speaker-intelligence.md`.
- **Open**: Visual Composition (rule-of-thirds, shot framing), real dissolve-transition detection,
  Eye Contact/Gesture/OCR/etc. weight calibration against real engagement data,
  pitch/F0 audio tracking, every Speaker Intelligence detector above, and the eventual Multi-Modal
  Fusion Engine (whether it enriches `clip-scoring`'s LLM-selected candidates or replaces
  selection with a continuous importance timeline is an explicit open architectural question — see
  `ai/fusion.md`).

For new feature work: check whether it's an extension of an existing signal/module first (extend,
don't rebuild — this has been an explicit recurring instruction across the AI Fusion roadmap), and
follow the JSON-contract checklist in `ARCHITECTURE.md` for anything new.
