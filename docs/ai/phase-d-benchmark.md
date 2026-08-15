# Phase D — Real-Video Benchmark + Human-Review Packet

> **Status: the automated-benchmark half of Phase D shipped and run for real once, against one
> real clip.** The fourth and final phase of the "Speedora Editorial Operating System" mission,
> closing out Phase A (`docs/ai/editorial-director.md`), Phase B (`docs/ai/edit-plan-director.md`),
> and Phase C1 (`docs/ai/render-quality-judge.md`), all merged. The actual **blind human
> evaluation** — a human watching both rendered outputs and filling in the packet's Rubric section
> — has NOT happened; that's explicitly not something an agent can perform. Multi-clip/multi-video
> expansion is a documented non-goal for this first pass, not started.

## 1. What Phase D asks for, and the real scope fork it required

Phase D's own name — "Real-video benchmark, blind human evaluation" — names two different things:
an automated benchmark (buildable), and a qualitative judgment call only a human can make (not
buildable by an agent). Confirmed via `AskUserQuestion`: **build the automated benchmark and a
structured human-review packet; leave the actual evaluation session to a human**, rather than
attempt to simulate it (no LLM-as-judge, no agent-authored verdict).

## 2. Audit findings that shaped the design

A 3-way parallel audit (real video/DB data availability, dual-run harness patterns, review-packet
output shape) found:

- **Real video data already existed, live, in this dev environment** — Docker's Postgres/MinIO
  (confirmed reachable via a direct `docker exec`/`psql` check) hold 3 real, already-rendered
  videos (6.9/8.9/18.2 minutes, 4 clips total), the same pool Editorial Director's own Gate A1
  validation used.
- **A real, previously-undocumented blocker**: the `editorialDecision`/`editPlan`/
  `qualityAssessment` migrations (merged in Phases A/B/C1) had never been applied to this local dev
  Postgres. Applied via `pnpm --filter @speedora/database db:migrate:deploy` as this phase's
  prerequisite step — a required, safe, purely-additive action.
- **Only `EDIT_BUDGET_ENABLED`/`EFFECT_CONFLICT_RESOLUTION_ENABLED` change the physical rendered
  file** — `editPlan.suggestions` feeds `buildReframePlan()`/`computeClipCuts()`/both Reaction Hold
  call sites. `EDITORIAL_DIRECTOR_ENABLED`/`RENDER_QUALITY_JUDGE_ENABLED` gate API exposure only
  (ADR D8) and never affect rendering.
- **A real, unavoidable cost**: `graphResult` (which `editingSuggestions`/`editorialDecision`
  derive from) makes real OpenAI calls regardless of either flag (ADR D8, "compute always"). User-
  confirmed scope: **1 real clip for this first pass**, the longer of the McDonald's video's 2 real
  clips (`cmsq3ix8a028e2su80g10w5y6`, 128.61s requested duration) — chosen for the most content/
  editing-suggestion density among the 4 available real clips.
- **`getProcessor()` (the technique that captures the real BullMQ processor closure) only works
  inside Jest** — confirmed via grep, it depends on `jest.mock('bullmq', ...)`'s hoisting. A plain
  `tsx` script (every other `apps/worker/src/scripts/*.ts`'s own shape) can't use it. The benchmark
  harness follows `render-clip.worker.local-comparison.ts`'s invocation shape instead.
- **Running the real, unmodified processor against an already-rendered clip is unsafe**: the
  completion transaction's `outputUrl: null` optimistic-concurrency guard would silently no-op the
  DB write while `uploadObject()` would still overwrite the REAL `renders/${clipId}.mp4` object in
  MinIO — a real, undocumented side effect on live dev data if not handled. The harness mocks
  Prisma writes (capture, never execute) and redirects uploads to a benchmark-only prefix.

## 3. What shipped

- `apps/worker/src/workers/render-clip.worker.phase-d-benchmark.ts` — the harness. Manual-only
  (not `.spec.ts`, excluded from `pnpm test`), run via:

  ```
  npx jest --testRegex "phase-d-benchmark\.ts$" --runInBand
  ```

  Real setup (a separate real Prisma client + `jest.requireActual('@speedora/storage')`, never the
  mocked modules the two runs use) fetches the real Clip/Video/TranscriptSegment rows and downloads
  the real source video once. Deliberately **unlike** `local-comparison.ts` (which mocks every AI/
  vision detector to keep its own ffmpeg-equivalence question free of LLM cost/non-determinism):
  every AI/vision detector package, `@speedora/visual-emphasis`, `@speedora/reframe`,
  `@speedora/subtitles`, and `../openai` (a REAL OpenAI client) all stay real — this is the entire
  point of Phase D, to observe real signals. B-roll is disabled (external stock-footage HTTP APIs,
  unverified in this sandbox) and 5 ffmpeg helpers unrelated to the comparison (thumbnail/
  storyboard/animated-preview/hover-preview, B-roll trim/fade-prep) are stubbed purely to bound
  wall-clock time — both documented scope simplifications, not silent gaps.

  **A deliberate design simplification versus the original plan**: `graphResult` is NOT
  cached/replayed across the two runs (the original plan described capturing it from the flag-off
  run and replaying it via `jest.spyOn` for the flag-on run, to guarantee byte-identical
  `editingSuggestions` input and halve LLM cost). That needs real `jest.spyOn` module-interception
  risk for a marginal cost saving on a single-clip first pass; the shipped harness runs two fully
  independent real invocations instead, and reports the resulting `editorialScore` delta as
  expected LLM-sampling noise unless it looks large/systematic. The real run below shows exactly
  this tradeoff in practice (see §5).

- `apps/worker/src/scripts/phase-d-report.ts` + `.spec.ts` — the `PhaseDReport` interface and pure
  `renderMarkdown()` function (8 unit tests, no DB/Jest-mock dependency), mirroring
  `generate-dataset-report.ts`'s `Report`/`renderMarkdown()` split. Produces a comparison table per
  run (`EditorialDecision`/`EditPlan` decisions/`FinalClipQualityAssessment`, each dimension's real
  `basis`), two short-lived presigned review links, and a blank Human Review Rubric section
  explicitly labeled "NOT scored by the agent" — mirroring
  `docs/ai/visual-emphasis-integration-audit.md`'s Gate B4/B5 "observation, not verdict" framing.

- Output: one `.md` + one `.json` file per run, written to `apps/worker/reports/` (new, gitignored
  — contains short-lived presigned storage URLs, a real credential-equivalent that must never be
  committed to VCS).

## 4. Real, pre-existing findings this run surfaced

None of these are Phase A/B/C1/D's own code — all are pre-existing gaps in unrelated modules,
surfaced by exercising the real pipeline against a real, 128-second clip for the first time (most
existing test/harness fixtures use short synthetic clips that never exercised these code paths).
Per this phase's own explicit non-goal, none were fixed here — logged as backlog:

- **A real bug**: `apps/worker/scripts/detect_camera_motion.py` crashes with
  `TypeError: Object of type float32 is not JSON serializable` when serializing its own `dx` field
  — a numpy `float32` never converted to a native Python `float` before `json.dumps()`. Caught by
  the render graph's existing best-effort handling ("camera motion detection failed, continuing
  without camera motion data"), not fatal.
- **A sandbox-completeness gap, not a code bug**: this environment is missing the MediaPipe model
  files `gesture_recognizer.task`, `face_landmarker.task`, and `efficientdet_lite0.tflite`
  (`apps/worker/models/`), and the `pytesseract` Python package — so Gesture Intelligence, Face
  Landmarks, Object Intelligence, and OCR Text Detection all return null/empty for this run,
  regardless of the real clip's content. Confirms the exact caveat `ARCHITECTURE.md` already
  documents for Audio/Scene Intelligence ("an honestly-unverified subprocess") extends to these
  detectors too, in this specific sandbox. This measurably reduced `editingSuggestions` density for
  this run (see §5) — a real clip with working face/OCR detection could exercise
  `EDIT_BUDGET_ENABLED`/`EFFECT_CONFLICT_RESOLUTION_ENABLED` more meaningfully.

## 5. Real results (2026-08-15 run, clip `cmsq3ix8a028e2su80g10w5y6`)

The full report is `apps/worker/reports/phase-d-benchmark-2026-08-15T21-31-43-256Z.{md,json}`
(local only, not committed). Summary:

| | Flag off | Flag on |
|---|---|---|
| `editorialScore` | 53.1 | 65.8 |
| `narrativeQuality` | 43.3 | 75.3 |
| `technicalQuality` | 95.5 | 95.5 |
| `visualQuality` (proxy) | 10.0 | 10.0 |
| `compositeScore` | 56.3 | 69.0 |
| Rendered duration | 124.76s | 124.76s |
| Output checksum | `4f61e543...` | `4f61e543...` (**identical**) |

**`editPlan.suggestions` was identical between runs** — no conflict-resolution or budget-
enforcement decision fired for this clip, a real, valid outcome (this clip's real
`editingSuggestions` — reduced by §4's missing-detector gap — simply didn't have anything dense or
conflicting enough for the two flags to act on). The physical rendered output is byte-identical
(matching MD5 checksums), correctly confirming the flags had zero effect on this specific clip's
render.

**The `editorialScore`/`narrativeQuality` delta (53.1→65.8, 43.3→75.3) is therefore attributable
entirely to real LLM sampling non-determinism between the two runs' independent Narrative Graph
calls**, not to the flags — exactly the tradeoff §3's own design note predicted, now observed in
practice with a real, non-trivial magnitude (12.7 points on `editorialScore`, 32 points on
`narrativeQuality`). This is a genuine, useful finding in its own right: Narrative Graph's
real-world LLM output for this clip is not tightly reproducible run-to-run, which the "scale
honesty" convention (ADR D4) already anticipates but this is the first real-clip evidence of the
actual magnitude. Worth a future calibration note, not a bug in this phase's own code.

## 6. Explicit non-goals for this pass

- **The actual blind human evaluation session** — the packet exists; a human hasn't used it yet.
- **Multi-clip/multi-video coverage** — this pass covers 1 real clip, proving the harness end-to-
  end. `BENCHMARK_CLIP_ID` is overridable via `--clipId=` for a cheap future expansion.
- **Fixing §4's real findings** (the camera-motion float32 bug, the missing model files/
  `pytesseract`) — separately-scoped backlog items, unrelated to Phase A/B/C1/D's own code.
- **Caching/replaying `graphResult` across runs** — deliberately simplified away (§3); a future
  pass could revisit this if LLM cost/non-determinism becomes a real blocker at multi-clip scale.
- **Real Brand Kit resolution** (watermark/intro/outro) — the harness job data hardcodes these to
  `null` rather than reproducing `ClipsService`'s own resolution chain; a documented scope
  simplification since Phase D's own question is `editPlan`/`editorialDecision`/
  `qualityAssessment`, not brand-kit fidelity.
