# Phase D — Real-Video Benchmark + Human-Review Packet

> **Status: the automated-benchmark half of Phase D shipped and run for real twice, against one
> real clip** — once before this sandbox's detector gaps (§4) were fixed, once after. The fourth
> and final phase of the "Speedora Editorial Operating System" mission, closing out Phase A
> (`docs/ai/editorial-director.md`), Phase B (`docs/ai/edit-plan-director.md`), and Phase C1
> (`docs/ai/render-quality-judge.md`), all merged. The actual **blind human evaluation** — a human
> watching both rendered outputs and filling in the packet's Rubric section — has NOT happened;
> that's explicitly not something an agent can perform. Multi-clip/multi-video expansion is a
> documented non-goal for this first pass, not started.

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
Per this phase's own explicit non-goal, neither was fixed as part of this phase's own PR — both
were fixed separately, immediately after, at the user's explicit request (see below).

- **A real bug, FIXED**: `apps/worker/scripts/detect_camera_motion.py` crashed with
  `TypeError: Object of type float32 is not JSON serializable` when serializing its own `dx` field
  — a numpy `float32` never converted to a native Python `float` before `json.dumps()`. Caught by
  the render graph's existing best-effort handling ("camera motion detection failed, continuing
  without camera motion data"), not fatal, but silently dropped every camera-motion sample.
  `decompose_warp()` now explicitly casts all 4 return values (`dx`/`dy`/`scale`/`rotation`) to
  native `float` — `scale`/`rotation` already came out native via `math.hypot()`/`math.degrees()`,
  but cast explicitly too rather than relying on that implicitly. Verified with a real run (a
  synthetic `ffmpeg testsrc` clip through the actual script, not a mock) producing real, correctly-
  serialized `dx`/`dy`/`scale`/`rotation`/`ecc` values with no crash.
- **A sandbox-completeness gap, FIXED, plus a real production Dockerfile gap it uncovered**: this
  environment was missing the MediaPipe model files `gesture_recognizer.task`,
  `face_landmarker.task`, and `efficientdet_lite0.tflite` (`apps/worker/models/`), and the
  `pytesseract` Python package + a real `tesseract` OCR binary — so Gesture Intelligence, Face
  Landmarks, Object Intelligence, and OCR Text Detection all returned null/empty for this run,
  regardless of the real clip's content. Confirmed the exact caveat `ARCHITECTURE.md` already
  documents for Audio/Scene Intelligence ("an honestly-unverified subprocess") extends to these
  detectors too. Investigating this surfaced a real, separate, more consequential bug:
  `apps/worker/Dockerfile` fetches `blaze_face_short_range.tflite` and `face_landmarker.task` but
  **never fetched `gesture_recognizer.task` or `efficientdet_lite0.tflite` at all** — meaning
  Gesture Intelligence and Object Intelligence were silently null/empty in every **production**
  container built from this Dockerfile too, not just this local sandbox. Fixed: this sandbox's
  `apps/worker/models/` now has all 4 model files (downloaded from MediaPipe's own canonical
  `storage.googleapis.com/mediapipe-models/...` URLs, the same source the existing 2 already used),
  `pytesseract` + a real Tesseract 5.5.3 binary are installed (`TESSERACT_PATH` set in `.env`, the
  already-existing, already-documented escape hatch for exactly this), `apps/worker/Dockerfile`
  gained the 2 missing `curl` fetch steps (same pattern as the existing 2), and `README.md`'s local-
  dev prerequisites gained the 2 missing model bullets. Verified for real: each of the 4 detector
  scripts (`detect_gestures.py`/`detect_objects.py`/`detect_face_landmarks.py`/`detect_ocr_text.py`)
  run directly against synthetic test clips, no crash, real output (OCR correctly read rendered
  text at 95.5% confidence; the other 3 correctly returned null/empty against clips with no real
  hands/objects/faces to detect — a correct result, not a failure).
- **A NEW real bug, found only once the model file above actually loaded — FIXED**:
  `detect_face_landmarks.py`'s own Kalman-filter tracker threw a real OpenCV assertion,
  `cv2.error: ... (-215:Assertion failed) a_size.width == len in function 'cv::gemm'`, inside both
  `_predicted_box()` and `mark_missed()`. This code path was NEVER exercised before this sandbox
  had a real `face_landmarker.task` to load (every prior test/harness run either lacked the model
  file or used synthetic clips with no trackable face), so the bug had been latent since this
  tracker was written. Root cause: `cv2.KalmanFilter`'s `statePre`/`statePost` need a real
  `(n, 1)` column-vector `Mat`, not a flat `(n,)` 1D array — a well-known cv2 Python-binding
  gotcha; `_init_kalman()` was assigning a flat array, which `predict()`'s internal `cv::gemm`
  call then rejected on dimension mismatch. Once `update()`'s own real `predict()` call threw,
  the `except Exception:` handler around it called `tracker.mark_missed()` as a fallback, which
  hit the SAME broken state and ALSO threw — this second, uncaught exception is what actually
  crashed the whole script (matching the real traceback exactly). Fixed: `_init_kalman()` now
  `.reshape(-1, 1)`s the state before assigning `statePre`/`statePost` (and `update()`'s own
  `correct()` measurement, defensively, for the same reason); `_predicted_box()` now
  `.flatten()`s `predict()`'s return before scalar-indexing it (a real, necessary follow-up once
  `predict()` started correctly returning an `(8, 1)` array instead of silently-wrong data).
  Verified for real: reproduced the exact crash against the exact real McDonald's clip window
  that originally triggered it (via `git stash` back to the pre-fix code), confirmed the fix
  eliminates it on that same real data, and additionally drove `FaceTracker.update()` through 3
  consecutive real detections directly (a synthetic unit-style test, since this specific real clip
  window rarely has a face visible across 2+ consecutive sampled seconds) to exercise the
  `update()`-then-`predict()` path the crash trace's own primary frame came from, not just
  `mark_missed()`'s fallback path. A genuinely richer result too, not just "didn't crash": the
  real clip that used to silently report "no face" on every sample (each real detection's
  `update()` call throwing, caught, converted to an empty/null result) now correctly reports a
  real, continuously-tracked face across the same window.
- **A harness-only timing finding, FIXED**: the harness's own Jest test timeout (originally 30
  minutes) was sized against the FIRST real run, where most detectors failed fast (missing file/
  model). Once the 3 fixes above let every detector actually run to completion, the same benchmark
  took measurably longer — a second real run hit the 30-minute ceiling right at the final upload/
  report-writing step (after the render itself had already succeeded), with Jest tearing down the
  test environment mid-`await`. Bumped to 45 minutes; the next real run (§5) completed cleanly in
  ~39.5 minutes.
- **A root-cause correction to this doc's own first-run finding**: the original text below
  attributed `editPlan.suggestions` staying identical across both flag states to "reduced
  `editingSuggestions` density" from the missing-detector gap. The second real run (§5), with every
  detector now working, still shows `editPlan.suggestions` identical and empty for this clip — the
  REAL reason is that this harness never sets any `VISUAL_EMPHASIS_*_ENABLED` flag
  (`focusShiftEnabled`/`digitalPushEnabled`/`ocrHighlightEnabled`/`reactionHoldEnabled`/
  `pauseHoldEnabled`/`speakerAwareFocusShiftEnabled` all confirmed `false` in this run's own
  `CONFIG_RESOLVED` log), so `computeEditingSuggestions()` has nothing to propose regardless of how
  rich the underlying detector signal is. A real, more precise finding than the original guess —
  see §6's own non-goal note on this.

## 5. Real results, both runs (clip `cmsq3ix8a028e2su80g10w5y6`)

### Run 1 — 2026-08-15, before §4's detector fixes

Full report: `apps/worker/reports/phase-d-benchmark-2026-08-15T21-31-43-256Z.{md,json}` (local
only, not committed).

| | Flag off | Flag on |
|---|---|---|
| `editorialScore` | 53.1 | 65.8 |
| `narrativeQuality` | 43.3 | 75.3 |
| `technicalQuality` | 95.5 | 95.5 |
| `visualQuality` (proxy) | 10.0 | 10.0 |
| `compositeScore` | 56.3 | 69.0 |
| Rendered duration | 124.76s | 124.76s |
| Output checksum | `4f61e543...` | `4f61e543...` (**identical**) |

### Run 2 — 2026-08-16, after §4's detector fixes (gesture/object/face-landmark models +
Tesseract all working; face-landmark tracker's own Kalman bug still open)

Full report: `apps/worker/reports/phase-d-benchmark-2026-08-16T00-16-56-592Z.{md,json}` (local
only, not committed). ~39.5 minutes wall time (up from ~27 minutes for Run 1 — every detector now
actually running to completion instead of failing fast costs real time, see §4's timeout note).

| | Flag off | Flag on |
|---|---|---|
| `editorialScore` | 59.2 | 57.8 |
| `narrativeQuality` | 43.3 | 43.3 |
| `technicalQuality` | 95.5 | 95.5 |
| `visualQuality` (proxy) | 53.3 | 53.3 |
| `compositeScore` | 64.2 | 63.8 |
| Rendered duration | 124.76s | 124.76s |
| Output checksum | `44a699bc...` | `44a699bc...` (**identical**) |

**Both runs**: `editPlan.suggestions` identical between flag states, physical output byte-
identical — see §4's root-cause correction: this harness never enables any
`VISUAL_EMPHASIS_*_ENABLED` flag, so `computeEditingSuggestions()` has nothing to propose
regardless of detector richness. `EDIT_BUDGET_ENABLED`/`EFFECT_CONFLICT_RESOLUTION_ENABLED` are
therefore not exercised in EITHER run — a real, still-open first-pass limitation, not something the
detector fixes could have addressed by themselves.

**Run 1's `editorialScore`/`narrativeQuality` delta (53.1→65.8, 43.3→75.3) was real LLM sampling
non-determinism** between two independent Narrative Graph calls, not the flags — exactly the
tradeoff §3's own design note predicted. **Run 2's much smaller `editorialScore` delta (59.2→57.8)
and IDENTICAL `narrativeQuality` (43.3 both) is consistent with that same explanation** — the two
runs' independent LLM calls this time happened to land closer together, which is itself expected
(sampling noise varies run to run, it doesn't have a fixed magnitude). Neither run's delta is
attributable to the flags, which had zero measurable effect on `editingSuggestions` in either run.

**`visualQuality`'s jump between runs (10.0 → 53.3, in both flag states) is the one number that
moved for a REAL, understood reason, not noise**: `visualQuality` is a `'proxy'` derived from
`categories.visualEngagement` (`packages/render-quality-judge`'s own honest-proxy design, see
`docs/ai/render-quality-judge.md`), which is itself an average of `editingSuggestions[].score`.
With Composition Intelligence's face-detection input now real (rather than always-empty) between
runs, the composition/primary-subject signal feeding `editingSuggestions` scoring changed — a real,
if indirect, consequence of §4's detector fixes, even though it didn't change `editPlan.suggestions`
itself (still empty either way — see above) or the physical render.

## 6. Explicit non-goals for this pass

- **The actual blind human evaluation session** — the packet exists; a human hasn't used it yet
  (now with 2 real report packets to choose from, or use both).
- **Multi-clip/multi-video coverage** — this pass covers 1 real clip, proving the harness end-to-
  end. `BENCHMARK_CLIP_ID` is overridable via `--clipId=` for a cheap future expansion.
- **Re-running the full benchmark a third time now that the Kalman-filter bug (§4) is fixed too**
  — a cheap, valuable follow-up (richer real face-tracking data feeding `editingSuggestions`), not
  done as part of the fix itself.
- **Enabling `VISUAL_EMPHASIS_*_ENABLED` flags to get a real `editPlan`/`EDIT_BUDGET_ENABLED`/
  `EFFECT_CONFLICT_RESOLUTION_ENABLED` comparison** — §4/§5's own root-cause finding: neither real
  run so far has exercised these two flags' actual arbitration behavior, since the harness never
  turns on any underlying Visual Emphasis technique. A real, valuable next benchmark run, not done
  here (a genuinely new harness change, not a re-run of the existing one).
- **Caching/replaying `graphResult` across runs** — deliberately simplified away (§3); a future
  pass could revisit this if LLM cost/non-determinism becomes a real blocker at multi-clip scale.
- **Real Brand Kit resolution** (watermark/intro/outro) — the harness job data hardcodes these to
  `null` rather than reproducing `ClipsService`'s own resolution chain; a documented scope
  simplification since Phase D's own question is `editPlan`/`editorialDecision`/
  `qualityAssessment`, not brand-kit fidelity.
