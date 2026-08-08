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
  primary-subject/, composition-intelligence/,
  fusion-engine/,                                      # stateless JSON-in/JSON-out AI modules
  fusion-ml/,                                           # Fusion Engine v3 (M2A-B) - contracts,
                                                         # interfaces, a real (if simple) baseline
                                                         # model, no caller in apps/worker/api yet
                                                         # (see ai/fusion-v3.md)
  dataset-quality/                                      # M1.5's missing-data/distribution/drift/
                                                         # calibration + M1's correlation math -
                                                         # shared by apps/worker's CLI report and
                                                         # apps/api's GET /ops/ai/* (M5C-B)
  llm-client/, hook-prediction/,                        # AI Intelligence v4 Phase 0-7 - see
  multimodal-reasoning/, semantic-events/,               # ai/intelligence-v4.md
  narrative-graph/, contextual-momentum/,
  emotional-arc/, multi-speaker-reasoning/,
  virality-engine/
```

`apps/web` and `apps/api` only communicate over HTTP. `apps/worker` has no HTTP server — it only
consumes BullMQ jobs. Every AI analysis capability is a small, independently-testable stateless
package following one architectural pattern — see [`ARCHITECTURE.md`](ARCHITECTURE.md) for the
pattern itself and its "add a new module" checklist.

## Documentation index

| Doc | Covers |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Full pipeline, state machine, job design, storage, auth, the JSON-contract pattern, AI signal flow |
| [`docs/data-ownership.md`](docs/data-ownership.md) | Entity relationship map (`User`/`Workspace`/`WorkspaceMembership`/`SocialAccount`/`Campaign`/`PublishRecord`/both snapshot models) — the two coexisting scoping models (direct ownership vs. workspace membership) and why both exist |
| [`docs/coding-standards.md`](docs/coding-standards.md) | Conventions: module checklist, extraction discipline, "scale honesty", data-shape conventions, the recurring TS2742 pitfall, enum mapping rules (Contract Governance) |
| [`docs/backend.md`](docs/backend.md) | `apps/api` — auth, endpoints, Publish Center (YouTube/TikTok/Instagram), payments |
| [`docs/analytics-architecture.md`](docs/analytics-architecture.md) | Flow-level view of Sprint 6A-6K: Publish → Snapshot → Aggregation → Visualization → Insight → Prediction — how a clip's real performance becomes a dashboard number, a narrative, and a projection |
| [`docs/conversion-architecture.md`](docs/conversion-architecture.md) | Sprint 6K's Tracked Link → Redirect → Bot Filter → Dedup → Click Event → Conversion Count → Dashboard flow — and why "conversion" here means click count, not a purchase/signup event |
| [`docs/capability-matrix.md`](docs/capability-matrix.md) | The two per-platform capability registries (publish vs. read/analytics) reproduced as reference tables, plus an "adding a new platform" checklist |
| [`docs/frontend.md`](docs/frontend.md) | `apps/web` — routes, Timeline Editor, Dashboard, OCR Review UI, processing UX |
| [`docs/worker.md`](docs/worker.md) | `apps/worker` — job handlers, the full `render-clip` pipeline, Smart Reframe, captions, B-roll |
| [`docs/worker-architecture.md`](docs/worker-architecture.md) | Flow-level companion to `worker.md`: Queue → Worker → Snapshot → Retry → Failure isolation — why the pipeline's atomic-write Snapshot pattern is what makes stage-inferred retry possible |
| [`docs/queue.md`](docs/queue.md) | BullMQ queue design, self-chaining, retry semantics |
| [`docs/video-import-reliability.md`](docs/video-import-reliability.md) | Download Reliability Framework — the `import-youtube` job's two-layer retry (in-process + BullMQ), health-check gate, full failure-category table, metrics/alerting additions, troubleshooting |
| [`docs/database.md`](docs/database.md) | Prisma schema overview, `Clip`'s AI-signal columns, retry inference |
| [`docs/prisma.md`](docs/prisma.md) | Prisma-specific conventions, `Prisma.JsonNull`, the TS2742 pitfall in detail |
| [`docs/redis.md`](docs/redis.md) | Redis usage (BullMQ backing store, rate limiting) — never durable state |
| [`docs/docker.md`](docs/docker.md) | Image builds, MinIO (dev) vs. R2 (prod) storage |
| [`docs/deployment.md`](docs/deployment.md) | Production compose, env var layering |
| [`docs/backup-restore.md`](docs/backup-restore.md) | Automated Postgres/object-storage backup (`ops/backup`), verification, restore procedure, `GET /backups` |
| [`docs/monitoring.md`](docs/monitoring.md) | Lightweight operational monitoring endpoints (`/metrics`, `/queues`, `/workers`, `/storage`, `/database`, `/redis`) — no Prometheus/OpenTelemetry |
| [`docs/alerting.md`](docs/alerting.md) | Alert-condition foundation (thresholds, internal alert states) — no external integrations |
| [`docs/operations-runbook.md`](docs/operations-runbook.md) | Backup, restore, disaster recovery, node/worker replacement, database/storage recovery procedures |
| [`docs/production-hardening-report.md`](docs/production-hardening-report.md) | Final engineering report for the backup/rate-limiter/monitoring/alerting initiative — every change by phase, files touched, remaining tech debt, deferred items, roadmap, readiness score |
| [`docs/testing.md`](docs/testing.md) | Module vs. adapter test split, real-Postgres verification, known verification gaps, `pnpm verify` pre-push convention |
| [`docs/export-center-manual-verification.md`](docs/export-center-manual-verification.md) | Manual pre-merge checklist for Export Center download routes (Sprint 03b) — real-browser download behavior, Excel/VLC compatibility, UTF-8/BOM correctness; complements the automated suite, doesn't replace it |
| [`docs/performance-evaluation.md`](docs/performance-evaluation.md) | Stabilization Pass Area 5 — real `EXPLAIN ANALYZE`/index review/N+1 audit, worker throughput, redirect latency, and frontend bundle impact of Recharts, evidence-backed at seeded scale |
| [`docs/ai/llm.md`](docs/ai/llm.md) | The `detect-clips` LLM call — clip selection, `ClipScores`, hooks/hashtags, emoji suggestions |
| [`docs/ai/vision.md`](docs/ai/vision.md) | Face detection/reframe, Face Intelligence (23 sub-features), Gesture Intelligence, Scene Intelligence |
| [`docs/ai/audio.md`](docs/ai/audio.md) | Loudness/RMS/speaking-rate, Speaker Diarization, Vocal Emotion Detection |
| [`docs/ai/ocr.md`](docs/ai/ocr.md) | On-screen text detection, tracking, classification, evaluation tooling, Review UI |
| [`docs/ai/fusion.md`](docs/ai/fusion.md) | The Fusion Engine — current pipeline, weights, prediction/recommendation |
| [`docs/ai/fusion-to-insight.md`](docs/ai/fusion-to-insight.md) | Fusion Engine → Explainability → Analytics → Insight → Prediction — disambiguates the three unrelated things called "prediction" in this codebase (the Fusion Engine's own frozen bucket, Sprint 6J's per-owner regression, and the paused Fusion Engine v3) and draws the write-once-model vs. read-time-interpretation line |
| [`docs/ai/fusion-v3.md`](docs/ai/fusion-v3.md) | Fusion Engine v3 (Milestones 2A-B) — `packages/fusion-ml`'s ML abstractions/interfaces/mock implementations (2A), plus (2B) a real Prisma-backed dataset builder, real dataset/feature versioning, a real evaluation runner, and a real gradient-descent baseline linear model, orchestrated by `runFusionV3Pipeline()`; v2 remains the only engine in production, nothing here is wired into `render-clip.worker.ts` |
| [`docs/ai/scoring.md`](docs/ai/scoring.md) | How `viralityScore`/`ClipScores`/`highlightScore` relate (they are three different systems) |
| [`docs/ai/speaker-intelligence.md`](docs/ai/speaker-intelligence.md) | Speaker Intelligence roadmap (VAD, Active Speaker Detection, Face-Voice Association, Speaker Timeline/Scoring) — contracts-only status vs. what's already covered by Face/Audio/Gesture Intelligence |
| [`docs/ai/object-intelligence.md`](docs/ai/object-intelligence.md) | Object Intelligence roadmap (per-entity detection/tracking/behavioral features — a separate package from Scene Intelligence) — MediaPipe detector choice, multi-object tracker design, Batch OI-1 through OI-5 (complete) |
| [`docs/ai/composition-intelligence.md`](docs/ai/composition-intelligence.md) | Composition Intelligence roadmap (rule of thirds, headroom, lead room, centering, composition stability, framing consistency, subject loss ratio) — reclassifies an earlier 15-batch "Camera Intelligence" proposal, most of which turned out to already be Scene/Motion/Object Intelligence; **complete** — contract, `packages/composition-intelligence` derive functions, the standalone `packages/primary-subject` selection package, worker adapter, and Fusion Engine wiring (RB-1/RB-2) are all done at weight 0, pending calibration |
| [`docs/ai/dataset-feedback-loop.md`](docs/ai/dataset-feedback-loop.md) | Dataset & Feedback Loop (post-hardening roadmap Milestone 1) — `PublishRecordStatsSnapshot` engagement history, the `engagementScore` heuristic, and `export-training-dataset.ts`'s feature/outcome join + correlation read, the prerequisite for Fusion Engine v3's ML-based weighting |
| [`docs/ai/dataset-validation-calibration.md`](docs/ai/dataset-validation-calibration.md) | Dataset Validation & Calibration (post-hardening roadmap Milestone 1.5, between Milestone 1 and Fusion Engine v3) — `generate-dataset-report.ts`'s Dataset Health Report (Missing Data, Feature Distribution, Feature Drift Detection, Correlation Dashboard, Weight Calibration Report), and the two-tier `dataset-lib.ts` data model that makes most of it useful ahead of real engagement data |
| [`docs/ai/subtitle-intelligence.md`](docs/ai/subtitle-intelligence.md) | Subtitle & Dynamic Caption Intelligence (spec Parts 7-8, AI Intelligence v4 Track B Phase A1/A2/B1/B2) — full audit/ADR/dependency-graph/phased-roadmap for a structural (verbatim-words-only) subtitle re-chunker plus a moment-to-moment dynamic caption treatment engine; **Phase A1 + A2 shipped flag-off** (`@speedora/subtitle-rewriter`, `Clip.subtitleIntelligence`, `Clip.smartSegmentation` wired into `buildAss()`), B1/B2 still design only |
| [`docs/ai/intelligence-v4.md`](docs/ai/intelligence-v4.md) | AI Intelligence v4 — the ADR (D1-D16), dependency graph, and (post Parts 4-15 re-audit) 18-phase Track A roadmap for a new additive prediction layer (Hook Prediction, Virality, Retention Curve, Narrative Graph, Multimodal Reasoning, Personalization, ...) that sits beside `highlightScore`, not instead of it; Phase 0 (`packages/llm-client`), Phase 1 (Hook Prediction Engine), Phase 2 (Semantic Event Detection + `packages/multimodal-reasoning`), Phase 3 (Narrative Graph), Phase 4 (Contextual Momentum), Phase 5 (Emotional Arc), Phase 6 (Multi-speaker Reasoning), Phase 7 (Cross-module Fusion, spec Part 4 - Virality Engine, `packages/virality-engine` — shipped by reverse-engineering Part 4 before its real spec text existed, later realigned by Phase 9), Phase 8 (Confidence Calibration, cross-cutting hygiene pass), Phase 9 (Virality Engine Realignment, spec Part 4 — once the real spec text arrived, **replaced** Phase 7's 8 reverse-engineered sub-probabilities with the spec's own 7: Scroll Stop/Watch/Completion/Share/Comment/Save/Follow Probability + Overall Viral Score, the one deliberate breaking change in this initiative, ADR D12; no new migration/node/DTO field needed), Phase 10 (Retention Curve Insights, spec Part 5 extension, `packages/retention-curve-insights` — strictly additive (ADR D13, unlike Phase 9): Phase 4's MomentumCurve/Phase 5's EmotionalArc are unchanged, only consumed; derives dropPoints/replayZones/emotionalPeaks via peak/trough detection reused from `packages/scene-intelligence` and curiosityPeaks via a new `isCuriositySemanticEventType()` exhaustive switch over SemanticEvent[]; timeline visualization deferred to Phase 12), and Phase 11 (Multimodal Reasoning Engine, spec Part 6, extends Phase 2's `packages/multimodal-reasoning` alongside its untouched `findConcurrentEvidence` — normalizes Transcript/Scene/OCR/Face/Gesture/Audio/Speaker plus a documented non-normative Object Intelligence extension into one evidence shape, groups by transcript segment, one LLM call per clip finds `refers_to`/`co_occurs_with`/`emphasizes` connections, a deterministic post-LLM step drops any connection whose cited evidence doesn't resolve or spans fewer than 2 modalities) are shipped; Phases 12-17 (Explainability, Candidate Expansion, Ranking Refinement + Personalization, Learning Pipeline, Evaluation Suite, Production Hardening — renumbered from the original 9-14 to make room for the 3 new phases the re-audit surfaced) are roadmap only; **Track B** (parallel, non-blocking editorial track) has its Phase A1 (Subtitle Rewriter, spec Part 7) and Phase A2 (wiring it into `buildAss()` via a new `Clip.smartSegmentation` toggle) shipped flag-off — see `ai/subtitle-intelligence.md` — with B1/B2 still roadmap only |

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
  Attention/Highlight scoring, Conversation Type Classification) — **this doc's "contracts only,
  no detectors/wiring built yet" status is stale** (confirmed while wiring Composition
  Intelligence's Primary Subject Selection, which consumes Active Speaker Detection's real output
  directly): `packages/active-speaker-intelligence` (`detectActiveSpeaker`,
  `associateSpeakersWithFaces`, `verifyLipSync`) and `packages/speaker-scoring`
  (confidence/engagement/importance/highlight scoring) are fully implemented and already wired into
  `render-clip.worker.ts` and the Fusion Engine (`speaker` key, weight 0). A full re-audit of
  exactly which roadmap items are done vs. still contracts-only hasn't been done — treat this bullet
  and `ai/speaker-intelligence.md` as needing a refresh pass, not as accurate today.
- **Composition Intelligence roadmap** (rule of thirds, headroom, lead room, centering, composition
  stability, framing consistency, subject loss ratio) — a reclassification of an earlier proposed
  15-batch "Camera Intelligence" subsystem, most of which turned out to already be Scene/Motion/
  Object Intelligence under a camera-flavored name. **Complete**: the contract
  (`packages/contracts/src/composition-intelligence.ts`), the derive-function package
  (`packages/composition-intelligence`), a standalone, deliberately non-composition-specific
  Primary Subject Selection package (`packages/primary-subject` — reusable by a future Thumbnail
  Intelligence/Reframe/Multi-Subject initiative, not buried as a private detail of this one), the
  `render-clip.worker.ts` adapter, and Fusion Engine wiring (a new `composition` key, weight 0) are
  all done. See `ai/composition-intelligence.md`.
- **Open**: real dissolve-transition detection, Eye Contact/Gesture/OCR/Composition/etc. weight
  calibration against real engagement data, pitch/F0 audio tracking, a Speaker Intelligence
  re-audit (see above), Video Quality Intelligence (focus/exposure/noise/compression — a separate,
  not-yet-scoped roadmap explicitly split out of Composition Intelligence), and the eventual
  Multi-Modal Fusion Engine (whether it enriches `clip-scoring`'s LLM-selected candidates or
  replaces selection with a continuous importance timeline is an explicit open architectural
  question — see `ai/fusion.md`).
- **Dataset & Feedback Loop** (Milestone 1 of the post-production-hardening AI-quality roadmap) —
  the prerequisite for turning the Fusion Engine from rule-based weights into a trained model.
  `PublishRecordStatsSnapshot` (append-only engagement history), `shareCount`/Instagram
  `watchTimeSeconds` on the existing `sync-publish-stats` job, the `engagementScore` heuristic, and
  `export-training-dataset.ts`'s feature/outcome join + correlation read are all done. YouTube
  watch-time/CTR (needs a new OAuth scope + user reconnect) and TikTok watch-time (no such platform
  endpoint) are explicit, documented scope cuts, not gaps. See `ai/dataset-feedback-loop.md`.
- **Dataset Validation & Calibration** (Milestone 1.5, inserted between Milestone 1 and Fusion
  Engine v3) — turns the raw dataset into insights before M2's model-training work starts.
  `generate-dataset-report.ts` (`pnpm report:dataset-health`) produces one Dataset Health Report
  covering Missing Data, Feature Distribution, Feature Drift Detection, a Correlation Dashboard, and
  a Weight Calibration Report (heuristic suggestion only, not auto-applied to
  `packages/fusion-engine/src/weights.ts`). Missing Data/Distribution/Drift run over every clip with
  computed Fusion Engine features, not just published ones, so they're useful ahead of Milestone 1's
  engagement data — verified against dev data. See `ai/dataset-validation-calibration.md`.
- **Fusion Engine v3** — has its own lettered sub-sequence inside this roadmap slot: M2A Foundation
  (done) → M2B Real ML Pipeline (done) → wait for production samples → M2C Baseline ML Training →
  M2D Calibration → M2E Canary Rollout → M2F Production Switch. **v2 (`packages/fusion-engine`)
  remains the only engine in production throughout** — zero call sites added in
  `apps/worker`/`apps/api`; `render-clip.worker.ts` is untouched.
  - **M2A (Foundation)**: ML abstractions (`FeatureVector`/`TrainingSample`/`PredictionResult`/
    `RankingResult`/`ModelMetadata` in `packages/contracts/src/fusion-ml.ts`), the 5 requested
    interfaces (`FeatureExtractor`/`DatasetBuilder`/`ModelTrainer`/`ModelEvaluator`/`Predictor`,
    each with one `Mock*` implementation), a model registry (`InMemoryModelRegistry`), and a real
    offline evaluation framework (Precision@K/Recall@K/Spearman/NDCG). A new
    `FUSION_ENGINE_V3_ENABLED` env var (default off) establishes this codebase's first feature-flag
    convention, read by `isFusionV3Enabled()` but not consumed anywhere yet.
  - **M2B (Real ML Pipeline)**: the pipeline stopped being framework-only. `ProductionDatasetBuilder`
    (`apps/worker/src/ml/`) is a real, Prisma-backed adapter reusing Milestone 1.5's
    `loadUsableSamples()`, bridged via a new `FUSION_V2_TO_V3_SIGNAL_MAP` (v2's `facial` → v3's
    `emotion`, everything else maps to itself). `computeDatasetVersion()`/`computeFeatureVersion()`
    are real deterministic sha256-based versioning, feeding a new `FeatureRegistry` alongside
    M2A's `ModelRegistry` (both still in-memory only — no real storage backing yet, same call as
    M2A). `BaselineLinearModelTrainer`/`BaselineLinearPredictor` are real gradient-descent linear
    regression (not a placeholder), and `runFusionV3Pipeline()` orchestrates all of it end-to-end,
    proven by an automated test (`pipeline.spec.ts`) — this **is** the milestone's "End-to-End
    Pipeline Verification." `pnpm --filter @speedora/worker pipeline:fusion-v3` is the real entry
    point; against production's still-0 usable samples it reports that honestly (`--mock` shows a
    full run against synthetic data). See `ai/fusion-v3.md`.

- **AI Explainability** (Milestone 4) — a read-only, per-clip view of the Fusion Engine's output
  (`GET /clips/:id/explainability`, `/videos/:id/explainability` page). No scoring-pipeline changes;
  `results: [{ engine: 'v2', ... }]` is deliberately an array so a future engine can append a second
  entry without a contract change — this pattern is reused by every Milestone 5C-B `/ops/ai/*`
  response.
- **Analytics Dashboard** — split into three stages, the user's own recommended breakdown so each
  stays small and independently verifiable: **M5A Overview** (`/analytics`, totals/platform-breakdown/
  upload-trend, owner-scoped) → **M5B Performance** (top clips/videos, engagement trend, platform
  comparison, a first light AI Performance Summary) → **M5C**, which the user split further into
  **M5C-A User AI Analytics** (a small owner-scoped addition to M5B's AI Performance Summary:
  Highlight Score Distribution + per-signal Contribution %) and **M5C-B AI Operations Dashboard**
  (`/ops/ai`, system-wide — pools every user's clips rather than one, role-gated to `ADMIN`/
  `AI_ENGINEER`/`OPERATOR` since it's an engineering "is the model healthy?" surface, not a creator
  "how did my content do?" one). M5C-B is also where Milestone 1.5's Missing Data/Feature
  Distribution/Feature Drift/Correlation/Weight Calibration — previously only reachable via
  `generate-dataset-report.ts`'s CLI output — got a web UI for the first time, plus two new sections
  (AI Health, Training Readiness for the eventual M2C). The underlying M1.5 pure functions moved to a
  new shared package, `packages/dataset-quality`, so both `apps/worker`'s CLI script and `apps/api`'s
  `/ops/ai/*` can reuse the exact same tested logic (apps only talk over HTTP/queue, so it couldn't
  stay in `apps/worker`). All done. This was also this codebase's first role concept
  (`UserRole` on `User`) — see `docs/backend.md`'s "AI Operations Dashboard" section and
  `docs/operations-runbook.md` for granting a role.
- **Sprint 6A-6K** ("Opus-Clip-equivalent Analytics Dashboard") — a from-scratch expansion on top of
  the M5A-C Analytics Dashboard above, all done: workspace-scoped Leaderboard (6D) and Campaign
  Analytics (6E) siblings to the owner-scoped `/analytics/*` surface (see `data-ownership.md` for why
  both scoping models coexist rather than one replacing the other), account-level Follower snapshots
  (6F), a shared chart-component foundation (6C.5), a publish-time-of-day Heatmap (6H), a per-clip AI
  Insight narrative comparing real outcomes against the Fusion Engine's own explainability (6I), a
  per-owner heuristic engagement Prediction via closed-form linear regression — explicitly not a
  trained model, and not the same thing as the Fusion Engine's own `predict.ts` bucket or the paused
  Fusion Engine v3 (6J, see `ai/fusion-to-insight.md`), and Conversion (6K) — a from-scratch
  Tracked-Link/click-tracking feature (`conversion-architecture.md`) where "conversion" means a
  bot-filtered, deduplicated click count, not a purchase/signup event. `backend.md`'s endpoint list
  predates this sprint and doesn't yet enumerate its routes; `analytics-architecture.md`/
  `conversion-architecture.md` are the canonical reference for them until that's backfilled. (Sprint
  6G has no corresponding artifact anywhere in the codebase — likely renumbered or merged into an
  adjacent sub-sprint, not a gap in what shipped.) See `analytics-architecture.md`,
  `conversion-architecture.md`, `capability-matrix.md`, `data-ownership.md`, `ai/fusion-to-insight.md`.
- **Stabilization Pass** — a 5-area post-Sprint-6A-6K hardening pass, all done: API Contract Audit
  (Area 1), bounded-context Architecture Documentation (Area 2), Cross-Feature E2E Verification
  (Area 3 — a real-Postgres/Redis proof that Upload→Processing→Publish→Snapshot→Overview→Trend→
  Campaign→Followers→Heatmap→Insight→Prediction→Tracked Link→Conversion actually works end to end,
  plus 6 explicit failure scenarios; `apps/worker/src/scripts/cross-feature-e2e/`, see
  `testing.md`), Visual QA (Area 4 — a code-level audit given no browser automation is available
  here; dark mode confirmed absent at the time (2026-07-19) — **stale as of 2026-07-27**: dark mode
  shipped in the Design System full replace (commit `9ffa077`, `next-themes` + a full `.dark`
  CSS-variable palette + `ThemeToggle`, working app-wide via the semantic-token convention with no
  per-component `dark:` variants needed) — tooltips/empty/loading states pass by
  construction, 2 responsive-layout gaps flagged as backlog and fixed in the Phase F cross-cutting
  hardening pass (2026-08-02)), and Performance Evaluation (Area 5 — real `EXPLAIN
  ANALYZE`/index review/N+1 audit plus worker throughput, redirect latency, and Recharts bundle
  impact, see `performance-evaluation.md`). Three tech-debt findings were deliberately left open and
  documented rather than fixed in this pass (none blocked production-readiness): a dotenv/module-load
  env-read ordering risk in `apps/worker/src/redis.ts`, an unbounded `capturedAt`-less query in
  `AnalyticsService.getOverview`, and a silent no-retry/no-alerting failure mode in
  `sync-publish-stats.worker.ts`/`sync-follower-count.worker.ts`. The Sprint 6A-6K analytics module is
  considered production-ready as of this pass. **Update (2026-07-24)**: the user prioritized the 3
  items (worker silent-retry highest, `getOverview` next, `redis.ts` lowest) and the first is now
  fixed — `SocialAccount.consecutiveSyncFailures`/`lastSyncFailureAt` are tracked per-account by both
  sync workers (reset on any success, incremented + timestamped on failure), and a new
  `sync-failure-warning` `AlertRule` (`apps/worker/src/workers/alert-engine.worker.ts`) notifies the
  account owner once `SYNC_FAILURE_ALERT_THRESHOLD` (default 3) consecutive failures are reached, via
  a new `NotificationType.SYNC_FAILURE_WARNING`. **Update (2026-07-24, same day)**: the second item is
  now fixed too — `AnalyticsService.getOverview`'s separate, unbounded `publishRecordStatsSnapshot.
  findMany()` (grew with an owner's entire sync HISTORY, forever) is gone; the platform-breakdown query
  and the engagement-average query are merged into one `publishRecord.findMany()` with a nested
  `statsSnapshots: { orderBy: { capturedAt: 'desc' }, take: 1 }` — the same "latest snapshot per
  parent" pattern `fetchPublishedRecords()` and `apps/worker`'s `dataset-lib.ts`
  (`loadUsableSamples`) already use elsewhere. Cost now scales with the owner's published-record
  COUNT (bounded, same as `totalClips`/`publishedClips`), not sync-history length. Deliberately *not*
  a `capturedAt`-window bound like `getFollowers`/`getHeatmap` — `averageEngagementScore` is documented
  as an all-time figure, so windowing it would silently change its meaning, not just its performance.
  **Update (2026-07-24, same day)**: the third and last item is fixed too — `apps/worker/src/redis.ts`'s
  `REDIS_URL` is now read lazily inside `createRedisConnection()` instead of at module scope, so it's
  no longer sensitive to import order (any dotenv-based tsx/esbuild script gets the right value
  regardless of when this module is transitively imported relative to `config()`). Locked in by a new
  `redis.spec.ts` (previously untested) — verified to actually catch the old bug by reverting to the
  module-scope version and confirming 2 of 3 new tests fail against it. `cross-feature-e2e/index.ts`/
  `run.ts`'s dynamic-import-after-`config()` split stays regardless, as defense-in-depth for other
  transitively-imported modules with the same eager-module-scope-env-read shape (e.g.
  `apps/worker/src/prisma.ts`'s `createPrismaClient()` call) — their comments were updated to say so.
  All 3 Stabilization Pass Area 3/5 tech debts are now resolved.
- **Download Reliability Framework** — an audit-and-harden pass over the `import-youtube` (yt-dlp)
  pipeline, prompted by a real production crash (empty-stderr exit, correlated with a concurrent
  antivirus scan) that had already been fixed at the classification level. Adds a second, BullMQ-
  level retry layer (`IMPORT_YOUTUBE_RETRY_OPTIONS`) coordinated with the existing in-process retry
  via `UnrecoverableError` for non-retryable categories, a cached pre-flight health-check gate, 5
  new failure categories (`disk`/`permission`/`geo_restricted`/`authentication`/`invalid_url`), 5
  derived reliability metrics, and a new `video-import-crash-spike` `AlertRule`. No new subsystem —
  every addition extends an existing pattern (BullMQ `attempts`/`backoff` already used by
  `publish-clip`, the `isFinalAttempt` gating already proven by `publish-clip.worker.ts`, the
  `AlertRule`/`ALERT_RULES` extension point already used 3 times, the all-time Redis metrics store).
  See `docs/video-import-reliability.md` for the full design and known verification gaps (the new
  stderr-regex categories are unverified against real yt-dlp output in this environment).
- **AI Intelligence v4** — a new, additive prediction layer sitting BESIDE the Fusion Engine
  (`highlightScore` measures "interestingness"; v4 predicts short-form *performance* — hook
  strength, virality, retention, narrative structure, niche personalization). Not a rewrite and not
  Fusion Engine v3's ML retraining effort (those remain separate, both untouched by this
  initiative). Has its own 14-part ADR + phased roadmap (`ai/intelligence-v4.md`). **Phase 0
  (Foundation)**: `packages/llm-client` extracts the OpenAI structured-output call pattern already
  independently duplicated 4x in this codebase (`clip-scoring`/`subtitle-translate`/`seo-copy`/
  `clip-query-parser`) — existing call sites are not migrated. **Phase 1 (Hook Prediction Engine)**:
  `packages/hook-prediction` predicts a clip's opening-hook probability by combining already-
  computed signals (`AudioFeatures`, dominant speaker confidence, a pause feature reusing
  `@speedora/cutlist`'s silence-gap math) with one new LLM reasoning step (sentiment/surprise/
  controversy/keyword rarity/topic shift/question density/numeric facts/named entities) —
  `Clip.hookPrediction`, wired into the render-graph, exposed at `GET /clips/:id/intelligence`
  behind `HOOK_PREDICTION_ENABLED` (default off; the flag gates API exposure only, computation
  always runs so no backfill is needed later). **Phase 2 (Semantic Event Detection)**:
  `packages/semantic-events` detects narrative events (a 22-value taxonomy — confession/mistake/
  failure/success/secret/warning/prediction/tutorial/breaking_news/conflict/lawsuit/money/ai/
  business/career/health/fear/urgency/controversy/achievement/transformation/life_lesson) from
  transcript text via one LLM call, then grounds each with on-screen evidence via a new standalone
  `packages/multimodal-reasoning` (pulled forward from spec Part 6, since the roadmap already names
  further future consumers) — `Clip.semanticEvents`, same render-graph/flag-gate/DTO-extension
  pattern as Phase 1, behind its own `SEMANTIC_EVENT_DETECTION_ENABLED` flag. **Phase 3 (Narrative
  Graph)**: `packages/narrative-graph` segments a clip into a real story structure (hook/setup/
  context/problem/conflict/escalation/peak/resolution/takeaway/cta) plus relations between segments
  (`leads_to`/`resolves` — `resolves` can connect non-adjacent segments, the concrete thing that
  makes it a graph rather than a sliding window) via one LLM call, consuming Phase 2's
  `SemanticEvent[]` as optional context. A pure `validateGraph()` step collapses to an
  `unsegmented: true` fallback (a real, successful result, not a failure) on any structural
  problem, rather than a partial repair — this phase's required risk mitigation against a
  silently-wrong graph reading as authoritative. `Clip.narrativeGraph`, same pattern as Phases 1-2,
  behind its own `NARRATIVE_GRAPH_ENABLED` flag. **Phase 4 (Contextual Momentum)**:
  `packages/contextual-momentum` — the first v4 module with no LLM call at all, a pure/synchronous
  composition over already-computed signals (motion energy, optional camera motion, optional
  `EditingRhythmFeatures.accelerationScore`, optional Phase 3 `narrativeGraph` as a segment-type
  multiplier) producing a per-instant `MomentumCurve` timeline. Its render-graph node is
  `optional: false` (unlike Phases 1-3's LLM-backed nodes, it can't hit real I/O failure), so
  `Clip.contextualMomentum` is null only when a row predates this phase's migration, never "the
  node failed." Same DTO-extension pattern as Phases 1-3, behind its own
  `CONTEXTUAL_MOMENTUM_ENABLED` flag. **Phase 5 (Emotional Arc)**: `packages/emotional-arc` — the
  vocal-emotion half of spec Part 5 (Retention Curve Prediction), pairing with Phase 4's
  `MomentumCurve`. Same no-LLM shape as Phase 4: a pure/synchronous composition over
  already-persisted `TranscriptSegment.emotion` labels (the classifier itself, `apps/worker/src/
  vocalEmotion.ts`, already ran at transcribe time and is untouched by this phase) plus optional
  Phase 2 `SemanticEvent[]` context, tiered via a new `emotionalBoostForSemanticEventType()`
  exhaustive switch over all 22 `SEMANTIC_EVENT_TYPES`, producing a per-segment `EmotionalArc`
  timeline. Also satisfies the roadmap's "vocal-emotion rescue" Track B prerequisite (a missing
  derive function + render-graph visibility) without relocating `vocalEmotion.ts` itself — that
  file shells out to a Python subprocess using `apps/worker`-local infra, the same shape as
  `apps/worker/src/diarization.ts`, which was likewise never relocated into
  `packages/speaker-diarization`. Same DTO-extension pattern as Phases 1-4, behind its own
  `EMOTIONAL_ARC_ENABLED` flag. **Phase 6 (Multi-speaker Reasoning)**:
  `packages/multi-speaker-reasoning` extends spec Part 6 (Multimodal Reasoning, Phase 2's
  `packages/multimodal-reasoning`, itself untouched by this phase) along a speaker-identity axis —
  a post-hoc, pure/synchronous attribution of Phase 4's `MomentumCurve` and Phase 5's
  `EmotionalArc` to individual speakers via Speaker Intelligence's already-existing
  `SpeakerTimelineEntry[]` (talk-time ratio, opening-hook-window talk-time ratio reusing Phase 1's
  `HOOK_WINDOW_SECONDS` heuristic, average/peak momentum, dominant emotion + average intensity per
  speaker). Returns `null` whenever a clip has fewer than 2 distinct speakers — the "must not
  affect single-speaker clips" risk the roadmap flagged, addressed by design via a cheap
  `Set`-size check, not an afterthought. `Clip.multiSpeakerBreakdown`'s null-semantics are a THIRD
  pattern (unlike both established ones): null means either "predates migration" or "genuinely
  single-speaker," not distinguished at the column level; its `sinks.ts` entry correspondingly
  breaks from Phase 4/5's plain-array-cast convention and uses the Phase 1-3 `?? Prisma.JsonNull`
  pattern instead, since a real success can produce `null`. Same DTO-extension pattern as Phases
  1-5, behind its own `MULTI_SPEAKER_REASONING_ENABLED` flag. **Phase 7 (Cross-module Fusion, spec
  Part 4 - Virality Engine)**: `packages/virality-engine` — same zero-LLM shape as Phase 4/5/6,
  fusing Phases 1/3/4/5's own already-computed outputs (not detecting anything new) into 8
  heuristic sub-probabilities (`hookStrength`/`replayPotential` from Hook Prediction,
  `buildIntensity`/`peakMomentum` from Contextual Momentum, `emotionalIntensity`/`emotionalRange`
  from Emotional Arc, `narrativeCompleteness`/`payoffPresence` from Narrative Graph, via a new
  `isPayoffSegmentType()` exhaustive switch) plus one composite `viralityProbability` (average of
  every non-null sub-probability) and a coverage-only `confidence`. Deliberately distinct from the
  pre-existing, unrelated `Clip.viralityScore` (Fase 8's MVP LLM clip-scoring, used to *select*
  candidates before render) — kept the "Virality" name for direct roadmap traceability but named
  the new field `Clip.viralityPrediction`, with `docs/ai/scoring.md` gaining a new 4th section
  disambiguating the two explicitly. Reverts to Phase 4/5's simpler null-semantics (not Phase 6's
  third pattern) since this node always produces a real object once it runs, no "doesn't apply"
  case. Caught and fixed a real bug during verification: an early version's `narrativeGraph !==
  null` strict check threw when the render-graph handed back `undefined` rather than `null`; fixed
  to the `!= null` loose-inequality pattern `@speedora/contextual-momentum`'s own `segmentAt()`
  already established, with a dedicated regression test. Same DTO-extension pattern as Phases 1-6,
  behind its own `VIRALITY_ENGINE_ENABLED` flag. **Phase 8 (Confidence Calibration,
  cross-cutting)**: a labeling/consistency hygiene pass, not a new module — the first phase since
  Phase 0 to add no new package/contract/migration/API field, because real numeric calibration is
  impossible (0 usable engagement samples, the same blocker every phase already documents). Filled
  in `HookPredictionOutput.confidence`'s previously-missing field comment, standardized the "scale
  honesty" module-level comment (ADR D4 phrase + the "never present as ML-model output downstream
  without this caveat" instruction) across the 6 contract files that lacked it
  (`semantic-events.ts`/`narrative-graph.ts`/`contextual-momentum.ts`/`emotional-arc.ts`/
  `multi-speaker-reasoning.ts`/`virality-engine.ts`), and added "kind of confidence" pointers
  distinguishing code-computed coverage (Phase 1, 7) from LLM-self-reported certainty (Phase 2, 3)
  confidence fields, replacing Phase 7's prior one-directional, unconfirmable cross-reference. Also
  disambiguated from Milestone 1.5's pre-existing, unrelated "Weight Calibration Report" (Fusion
  Engine v2 signal weights, not v4 per-field confidence) — a new confidence-field taxonomy table
  lives in `ai/intelligence-v4.md`'s "Phase 8 architecture (as shipped)" section. **Phase 9
  (Virality Engine Realignment, spec Part 4)**: the user supplied the real Part 4-15 spec text for
  the first time (a "Parts 4-15 re-audit" with its own ADR D12-D16 ran first) and it named 7
  different probabilities than Phase 7 had reverse-engineered without that text. **Replaces** (not
  extends) Phase 7's 8 structural sub-probabilities with the spec's own `scrollStopProbability`/
  `watchProbability`/`completionProbability`/`shareProbability`/`commentProbability`/
  `saveProbability`/`followProbability`, plus a renamed top-level `overallViralScore` (was
  `viralityProbability`) — the one deliberate exception to this initiative's strict additive-only
  convention (ADR D12), justified because `VIRALITY_ENGINE_ENABLED` was `false` in production so
  zero real consumers depended on the old shape. Needed no new migration
  (`Clip.viralityPrediction` is `Json?`, no DB-level schema), no new render-graph node, no new sink
  wiring, and no new `ClipIntelligenceDto` field — smaller footprint than a typical new-phase PR
  despite being a breaking change. `followProbability` is documented as the weakest-supported of
  the 7 (no speaker-trust signal is one of this phase's 4 dependencies). See `ai/intelligence-v4.md`'s
  "Phase 9 architecture (as shipped)" section. **Phase 10 (Retention Curve Insights, spec Part 5
  extension)**: unlike Phase 9, this stays strictly additive (ADR D13) — Phase 4's `MomentumCurve`
  and Phase 5's `EmotionalArc` are unchanged, only consumed by a new layer on top. New
  `packages/retention-curve-insights` derives `dropPoints`/`replayZones`/`emotionalPeaks` (peak/
  trough detection reused from `packages/scene-intelligence`'s own `findPeakIndices`/
  `meanAndStddev`, now exported, plus a new mirror-image `findTroughIndices`) and `curiosityPeaks`
  (`SemanticEvent[]` filtered via a new `isCuriositySemanticEventType()` exhaustive switch —
  secret/prediction/warning/breaking_news/controversy read as curiosity-evoking). Genuinely needed
  a new migration this time (`Clip.retentionCurveInsights`, a new field, not a shape change), new
  render-graph node, new sink entry, and new `ClipIntelligenceDto` field, behind its own
  `RETENTION_CURVE_INSIGHTS_ENABLED` flag. Timeline visualization is explicitly deferred to Phase
  12 (Explainability) — this phase ships the data only, same "data first, UI deferred" pattern
  every prior phase has followed. See `ai/intelligence-v4.md`'s "Phase 10 architecture (as
  shipped)" section. **Phase 11 (Multimodal Reasoning Engine, spec Part 6)**: extends Phase 2's
  `packages/multimodal-reasoning` (its existing `findConcurrentEvidence`/`groundedFactSchema` are
  untouched, still Phase 2's own grounding helper) with the genuine cross-modal reasoning layer
  Part 6 actually asks for — normalizes 8 evidence sources (`normalizeEvidence()`: Transcript/
  Scene/OCR/Face/Gesture/Audio/Speaker, Part 6's own 7 normative modalities, plus Object
  Intelligence's `objectTracks` as a documented, non-normative extension) into one common
  `MultimodalEvidence` shape, groups them by transcript segment — a real structural unit, not an
  arbitrary window (`groupEvidenceByTranscriptSegment()`) — then makes exactly ONE LLM call per
  clip (`extractRawConnections()`, never per-signal/per-group) to find `refers_to`/
  `co_occurs_with`/`emphasizes` connections spanning >= 2 distinct modalities, closed off by a
  deterministic post-LLM hallucination guard (`validateConnections()`) that drops any connection
  whose cited evidence doesn't actually resolve to real evidence sent to the LLM, or whose
  resolved modalities don't span >= 2 distinct values (recomputed from evidence, never trusted as
  the LLM reported them). Same LLM-backed null-semantics as hookPrediction/semanticEvents/
  narrativeGraph (`Clip.multimodalReasoning` null means the LLM call failed/never ran, not just
  "predates migration"), behind its own `MULTIMODAL_REASONING_ENABLED` flag. See
  `ai/intelligence-v4.md`'s "Phase 11 architecture (as shipped)" section. Parts 13/10/11/12
  (Explainability, Candidate Expansion, Ranking Refinement + Personalization, Online Learning
  readiness, renumbered to Phases 12-15) plus Evaluation Suite, Production Hardening (Phases
  16-17), and Track B's Subtitle/Caption/Visual Emphasis editorial features are a documented,
  estimated, dependency-ordered
  roadmap only — not built. See `ai/intelligence-v4.md`.

For new feature work: check whether it's an extension of an existing signal/module first (extend,
don't rebuild — this has been an explicit recurring instruction across the AI Fusion roadmap), and
follow the JSON-contract checklist in `ARCHITECTURE.md` for anything new. **Run `pnpm verify`
before pushing** (`format:check` → `lint` → `typecheck` → `build` → `test`, the same checks CI
runs) — see `docs/testing.md`'s "`pnpm verify` — run before every push" section for why this
convention exists.
