# Fusion Engine

`packages/fusion-engine` combines every AI Intelligence signal for one clip into a single
explainable `highlightScore`. Pure/synchronous — no `deps`, no DB, no external calls (see
`coding-standards.md`'s module pattern). This is the most actively-evolving part of the codebase;
this doc describes the **current** (v2.1) pipeline, not its history.

## Architectural note: this is not the file-based pipeline the original spec assumed

An earlier gap analysis mapped a 14-phase spec (which assumed a literal `audio.json` →
`semantic_score.json` → ... file-based pipeline between fully isolated processes) onto this
codebase. Both satisfy the same core principle ("a module doesn't need to know another module's
storage schema") but via different mediums: this codebase uses **Zod schemas in
`packages/contracts` + in-process function calls**, with **PostgreSQL** (not files on disk) as the
hand-off/source-of-truth between pipeline stages. The spec also analyzed the *entire* video's
visual content before selecting clips (visual analysis is expensive per-second); this codebase
selects clips first via one LLM call over the transcript (`ai/llm.md`), then only analyzes visual
signals for the clips actually chosen — a deliberate cost tradeoff, not an oversight.

## `IntelligenceSignal` convention

Every signal that produces both a raw timeline and a derived summary follows one shape:
`{ raw: RawSample[], features: DerivedFeatures }` — modules themselves keep returning raw data
unchanged (no signature break); a separate, pure, synchronous `deriveXFeatures()` function per
module computes the summary. See `database.md`'s column table for which signals have both vs. only
a features column (e.g. `editingRhythm`, which is itself a composite derived from *other* signals'
features).

## Pipeline (7 stages, each independently testable)

1. **Feature Extraction** (`feature-pipeline.ts`'s `extractFeatures`) — every signal is broken into
   multiple *named* features, not one score per signal. E.g. `audio` → `averageRmsDb` +
   `speakingRateStdDev`; `scene` → `cutsPerMinute`; `facial`/`gesture` →
   `dominant{Emotion|Gesture}Weight` + `peakConfidence` + `stability`; `llm` → all 9 `ClipScores`
   dimensions individually, prefixed by domain (`engagement.hookStrength`,
   `knowledge.practicalValue`, `conversion.ctaStrength`).
2. **Feature Normalization** (`NORMALIZERS` registry, keyed by feature name) — every feature maps
   to `[0, 1]` regardless of native unit (dB, cuts/min, an already-0–1 confidence, a signed -1..1
   range for `accelerationScore`). An unrecognized feature name throws rather than silently
   normalizing — deliberately no wildcard fallback.
3. **Feature Weighting** — a signal's configured weight is split evenly across however many of its
   features actually have data for this clip.
4. **Scoring** (`compute-highlight-score.ts`) — weighted average over features with weight > 0;
   `null` if the total available weight is 0.
5. **Confidence** — `coverage` (fraction of total weight that had data) × `quality` (average
   `peakConfidence` among features that are **both** present *and* weight > 0 — a real bug was
   caught and fixed here before shipping: an earlier draft let a weight-0 signal's high confidence
   inflate overall `confidence`, which is a contradiction since that signal doesn't move the score
   at all).
6. **Explainability** — `topFactors` ranked by `weightedContribution` (not raw feature value), so a
   heavily-weighted signal always outranks a lightly-weighted one regardless of magnitude.
7. **Prediction & Recommendation** (`predict.ts`/`recommend.ts`) — deterministic, no ML:
   - `predictPerformance(highlightScore, confidence)` → `{bucket, rationale}`. `uncertain` if
     `confidence < 0.4` or the score is 36–64; `likely_high_performer` at ≥65; `likely_low_performer`
     at ≤35. Thresholds are reasonable guesses, not calibrated against real clip performance.
   - `buildRecommendation(prediction, weighted)` → `{action, message}`. High → `publish_as_is`.
     Uncertain → `review_manually`. Low → looks up the single weakest weighted contribution and
     maps its feature name to a specific action/message (e.g. a weak framing feature suggests
     `reframe_shot`) via a lookup table covering every feature this pipeline can produce.

## Current default weights (`packages/fusion-engine/src/weights.ts`)

| Signal | Weight | Status |
|---|---|---|
| `audio` | 35% | active |
| `scene` | 25% | active |
| `facial` | 20% | active |
| `ocr` | 10% | active (wired at OCR Batch OCR-2) |
| `editingRhythm` | 5% | **heuristic, unvalidated** (see below) |
| `llm` | 5% | active (wired at Fusion v2.1) |
| `sceneMotion`, `cameraMotion`, `gesture`, `faceGeometry` | 0% | collected, visible in `contributions`, not yet calibrated |

These are explicit values given by the user, not learned — a future "weight optimization"
checkpoint is expected to replace this table with values fit to real engagement data. Every
weight-0 signal is deliberately wired all the way through (feature extraction, normalization,
`contributions`) rather than left disconnected, specifically so real distributions can be observed
before anyone decides on a calibrated weight — "wire in now, gather data, evaluate, then
calibrate" is a recurring, explicit instruction across this roadmap.

`editingRhythm`'s 5% is a deliberate exception to that pattern, not a calibrated result:
`apps/worker/src/scripts/check-calibration-coverage.ts` (run 2026-07-10) confirmed **0 usable
samples** exist in production (0 clips have both `editingRhythmFeatures` and a linked
`PublishRecord` with a `viewCount`) — real statistical calibration is not yet possible. The 5% was
assigned by explicit user decision as a temporary reasoned guess, borrowed from `scene`'s share
(30% → 25%, chosen as the donor since editingRhythm's tempo/pacing features already partly derive
from scene's own cut data) so the active weights still sum to 1.0. Re-run
`check-calibration-coverage.ts` as production data accumulates and replace this value with a real
fit once there's enough data (the script's own threshold is 500 usable samples).

## `SCORE_DOMAINS` — grouping `ClipScores`' 9 LLM dimensions

`engagement` (hookStrength/curiosity/emotion/storytelling), `knowledge` (educationalValue/
practicalValue/novelty/trustAuthority), `conversion` (ctaStrength). Currently a **naming
convention only** (feature names are prefixed by domain in `extractLlmFeatures`) — the `llm`
signal's 5% weight is still split evenly across whichever of the 9 dimensions have data, not
allocated per-domain. See `ai/scoring.md` for what each dimension actually measures.

## Ranking

Once every sibling clip in a video has finished rendering, `rankClips()` re-scores the whole batch
and writes `Clip.highlightRank` — a separate step from per-clip scoring, run in its own try/catch
in the `render-clip` adapter so a ranking failure never undoes an otherwise-successful render.

## Editing Rhythm — the one signal with no raw detector

`packages/editing-rhythm` is the sole **composite** signal in this roadmap: its input is *other*
signals' already-computed data (`sceneCuts`, `motionEnergy`, and the aggregate features
`cutsPerMinute`/`averageMotionEnergy`/`averageSpeakingRateWordsPerSecond`), not raw footage/audio
of its own — so there's no independent raw timeline to persist, only
`Clip.editingRhythmFeatures`. Three pure functions: `calculateTempo()` (average of whichever of
cuts-per-minute/motion-energy/speaking-rate are available, each capped and normalized),
`calculatePacing()` (coefficient-of-variation of inter-cut segment lengths, mapped to `(0,1]` via
`1/(1+CV)` — 1 means perfectly even spacing), `calculateAcceleration()` (-1..1, whether cuts/motion
are concentrated in the first or second half of the clip — a "building"/accelerating-edit proxy;
the only *signed* feature in the whole Fusion Engine, normalized via a linear -1..1 → 0..1 map).

## Known verification gaps

The ffmpeg/Python-subprocess-backed signals feeding this pipeline (scene cuts, motion energy,
camera motion, every face/gesture/OCR detector) have never been run against real binaries — see
`ai/vision.md`, `ai/ocr.md`, `testing.md`. The Fusion Engine's own math is fully unit-tested
against fixtures and is not itself affected by that gap.
