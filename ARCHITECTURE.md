# Architecture: DB-backed orchestration + JSON-contract modules

This documents a pattern for adding new analysis/calculation logic to Speedora without it becoming entangled with Prisma/BullMQ, so future modules are easy to test, easy to replace, and safe to build in parallel without migration conflicts. See [`CLAUDE.md`](./CLAUDE.md) for the overall product/pipeline architecture this sits inside.

## The pattern

| Layer | Pattern | Why |
|---|---|---|
| **Orchestration / job pipeline** (detect-clips → render → publish, etc.) | **DB-backed** (`apps/api`, `apps/worker`) | Needs durable state, retry, audit trail, status the user can poll |
| **Individual calculation/analysis module** (scoring, transforms, detection) | **JSON-in / JSON-out** (`packages/<module-name>`) | Stateless, fast to test with fixtures, easy to swap the algorithm without touching DB schema |
| **The seam between the two** | **Adapter** (a `*.worker.ts` or service in `apps/*`) | Fetches/shapes DB data → calls the module → persists the result. The module never knows the adapter, or the DB, exists. |

**The one rule that matters: a stateless module never queries the DB itself.** All Prisma/BullMQ access happens in the adapter. This is what prevents every new module from having to know the DB schema, and prevents schema drift when two people build modules in parallel.

## Package layout

- **`packages/contracts`** — Zod schemas (+ inferred TS types) for each module's input/output. Pure schema definitions, zero logic, zero dependencies on Prisma/BullMQ/`packages/database`. One file per module (e.g. `clip-scoring.ts`).
- **`packages/<module-name>`** (e.g. `packages/clip-scoring`) — the stateless module itself. Usually one exported function, `(input, deps?) => Promise<Output>`; a module with several independent pure operations used by different callers (e.g. `packages/cutlist`) can export several functions instead of forcing them into one call — the rule is statelessness and no DB access, not a fixed function count. External side effects the module genuinely needs (an LLM call, for example) are passed in via a `deps` parameter rather than constructed from `process.env` inside the module, so tests can inject a fake without any module-level mocking.
- **The adapter** — lives where the orchestration already lives (an `apps/worker/src/workers/*.worker.ts` file, or an `apps/api` service). Responsible for: reading DB/job data, narrowing it down to the module's own (deliberately minimal) input contract, calling the module, and persisting/enqueuing the result.

## Worked examples

### Clip scoring (one-function module, calls an external LLM)

- Contract: [`packages/contracts/src/clip-scoring.ts`](./packages/contracts/src/clip-scoring.ts)
- Module: [`packages/clip-scoring/src/score-clip-candidates.ts`](./packages/clip-scoring/src/score-clip-candidates.ts) — takes transcript segments, returns scored/sanitized clip candidates. Calls OpenAI (injected via `deps.openai`), does its own filtering/sanitization/Smart-Start-End snapping. No Prisma, no BullMQ, no Sentry.
- Adapter: [`apps/worker/src/workers/detect-clips.worker.ts`](./apps/worker/src/workers/detect-clips.worker.ts) — narrows `TranscriptSegment[]` (which also carries `speaker`/`emotion` the module never needs) down to the module's input shape, calls `scoreClipCandidates`, then persists `Clip` rows, updates `Video.status`, and enqueues `render-clip` jobs.
- Tests: [`packages/clip-scoring/src/score-clip-candidates.spec.ts`](./packages/clip-scoring/src/score-clip-candidates.spec.ts) tests the module purely with JSON fixtures and a faked OpenAI client — no DB/queue mocking at all. [`apps/worker/src/workers/detect-clips.worker.spec.ts`](./apps/worker/src/workers/detect-clips.worker.spec.ts) mocks the module directly and tests only the orchestration (persistence, status transitions, enqueue, Sentry).

### Cutlist (multi-function module, pure math, no external calls at all)

- Contract: [`packages/contracts/src/cutlist.ts`](./packages/contracts/src/cutlist.ts) — just the shared `CutRange` shape; there's no untrusted external input here (unlike an LLM response), so there's no single input/output object to validate.
- Module: [`packages/cutlist/src/cutlist.ts`](./packages/cutlist/src/cutlist.ts) — `computeSilenceCuts`/`computeFillerCuts`/`mergeCutRanges`/`totalCutSeconds`/`computeCutJunctionTimestamps`, five independent pure functions used by two different consumers (`render-clip.worker.ts` and `ffmpeg.ts`), so it stays a small function library rather than one combined entry point.
- Consumers: `apps/worker/src/workers/render-clip.worker.ts` (combines silence+filler+merge into its own `computeClipCuts` helper, already working on clip-relative words it derives itself) and `apps/worker/src/ffmpeg.ts` (`computeCutJunctionTimestamps`, for Smart Transitions). Neither is a classic "adapter" in the DB sense for this module — `ffmpeg.ts` is itself a near-stateless helper (shells out to the `ffmpeg` binary, no DB).

### Subtitles (fixing a real DB-type leak during migration)

- Contract: [`packages/contracts/src/subtitles.ts`](./packages/contracts/src/subtitles.ts) — `CaptionStyle` is duplicated as a plain string-literal Zod enum here, same reasoning as clip-scoring's `CLIP_INTENTS`.
- Module: [`packages/subtitles/src/build-ass.ts`](./packages/subtitles/src/build-ass.ts) — previously lived at `apps/worker/src/subtitles.ts` and imported `CaptionStyle` directly from `@speedora/database` (the Prisma-generated enum) even though it never touched Prisma otherwise — the one real "pure module coupled to the DB package" case found when auditing for this migration. Fixed by depending on the contract's own enum instead.
- Adapter: `apps/worker/src/workers/render-clip.worker.ts`'s `toSubtitleSegments()` narrows `TranscriptSegment[]` the same way `detect-clips.worker.ts` does, and casts the job's `CaptionStyle` enum value to the contract's string-literal type at the one call site that needs it (the two are guaranteed to share runtime string values by convention).

### Reframe (subprocess dependency injected, plus deployment paths that must stay in the adapter)

- Contract: [`packages/contracts/src/reframe.ts`](./packages/contracts/src/reframe.ts) — `FaceBox`/`FaceSample` (MediaPipe's output shape), `DetectFacesInput`, `CropDimensions`/`CropWindow`.
- Module: [`packages/reframe/src/face-detection.ts`](./packages/reframe/src/face-detection.ts) (`detectFaces`, subprocess call injected via `deps.execFile`, same shape as clip-scoring's `deps.openai`) + [`packages/reframe/src/crop-path.ts`](./packages/reframe/src/crop-path.ts) (`computeCropDimensions`/`findEmphasisWords`/`buildCropPath`/`buildSendCmdScript`, pure math, cutlist-style multi-function library). Bundled into one package rather than two, because `crop-path.ts` consumes `FaceSample` directly and the two were always used together as one "Smart Reframe" feature.
- **The subtlety that made this migration different from the others**: the old `apps/worker/src/faceDetection.ts` resolved its Python script and MediaPipe model file paths itself, via `path.join(__dirname, ...)`. Once that code moves into `packages/reframe/dist`, the same `__dirname`-relative resolution would silently point at the wrong location. Fixed by treating `pythonPath`/`scriptPath`/`modelPath` as deployment plumbing, not module logic — they're part of `DetectFacesDeps`, injected by a new adapter-side file, [`apps/worker/src/faceDetectionDeps.ts`](./apps/worker/src/faceDetectionDeps.ts), which deliberately lives at the same directory depth the old file did so its own `__dirname` math stays correct. **Lesson for the next module**: any `deps` your module needs isn't just "external API clients" — it's anything environment/deployment-specific, including file paths, executable names, and env-var-driven config. If a piece of module logic reads `process.env` or builds a path from `__dirname`, that's a sign it belongs in the adapter's deps object instead.
- Adapter: `apps/worker/src/workers/render-clip.worker.ts`'s `buildReframePlan()` calls `detectFaces({ sourcePath, startTime, endTime }, faceDetectionDeps)` and the pure crop-path functions directly — no narrowing function needed here (unlike clip-scoring/subtitles), because `TranscriptWord` (`packages/shared`) and `TranscriptWordInput` (`packages/contracts`) are already structurally identical with no extra fields to strip.

### Emoji suggester (proof that the checklist works for a brand-new feature, not just migrations)

Everything above was extracted from code that already existed. This one is the opposite: a feature that never existed anywhere in the codebase, built by following the checklist below from a blank page, to prove the pattern actually accelerates new work rather than just describing existing code.

- Contract: [`packages/contracts/src/emoji-suggestions.ts`](./packages/contracts/src/emoji-suggestions.ts) — `{ text: string }` in, `{ emojis: string[] }` out. The simplest possible shape: no untrusted external data, no DB-shaped type to narrow.
- Module: [`packages/emoji-suggester/src/suggest-emojis.ts`](./packages/emoji-suggester/src/suggest-emojis.ts) — deterministic keyword-pattern matching (same "honest heuristic, not ML" philosophy as `@speedora/subtitles`'s bold-highlight patterns and `@speedora/reframe`'s emphasis words), capped at 5 results. Pure and synchronous - no `deps` parameter at all, because there's no external call or deployment-specific value to inject.
- Schema change: `Clip.emojiSuggestions String[] @default([])` - a real migration (`20260706034409_add_clip_emoji_suggestions`), run against the live dev database the same way as Fase 3's `VideoStatusEvent`.
- Adapter: `apps/worker/src/workers/detect-clips.worker.ts`'s new `emojiSuggestionsFor()` slices each candidate's own overlapping transcript segments (reusing the same `filterSegmentsForClip` utility the candidate's returned `transcript` field already uses), joins their text, and calls `suggestEmojis()` before persisting each `Clip`. Threaded through `packages/shared`'s `ClipCandidate`/`Clip` types and `ClipsService.toDto()` the same way `hookText`/`hashtags`/`topics` already are - `VideosService.mapVideoWithClips()` needed no change at all, since it spreads the raw Prisma row rather than listing fields explicitly.
- Verified against a real database, not just mocks - a one-off script computed suggestions, persisted a `Clip` row with them, read it back, and confirmed cascade-delete, against the actual dev Postgres (same pattern as Fase 3's verification).

### Audio Intelligence (an honestly-unverified subprocess, and why that's flagged rather than hidden)

- Contract: [`packages/contracts/src/audio-intelligence.ts`](./packages/contracts/src/audio-intelligence.ts) — `analyzeAudioLoudness` (subprocess) and `computeSpeakingRate` (pure) get separate input/output schemas, bundled in one contract file since they're always used together.
- Module: [`packages/audio-intelligence/src/loudness.ts`](./packages/audio-intelligence/src/loudness.ts) (ffmpeg `astats` filter, one subprocess call per segment, injected via `deps.execFile`/`deps.ffmpegPath` — same shape as reframe's `deps.pythonPath`/`deps.scriptPath`) + [`speaking-rate.ts`](./packages/audio-intelligence/src/speaking-rate.ts) (pure word-count/duration math, no `deps` at all — same shape as emoji-suggester).
- **The difference from every other subprocess-based module here**: reframe's face detection, diarization, and vocal emotion were all verified end-to-end against the real tool in an earlier session. This one wasn't — the sandbox this was built in has neither `ffmpeg` nor Python on its `PATH`. The `astats` stderr parser is only tested against a hand-written fixture string shaped like ffmpeg's documented output, not a real ffmpeg run. This is stated plainly in `CLAUDE.md`'s Fase 25 section rather than glossed over — **run it against a real ffmpeg binary before trusting it in production**.
- Lesson: when you can't verify a subprocess module end-to-end in your current environment, still build it (fixture tests catch real logic bugs), but say so explicitly in the docs instead of implying the same verification confidence as modules that were actually run for real.

### Scene Intelligence (single-function subprocess module, same unverified-sandbox caveat)

- Contract: [`packages/contracts/src/scene-intelligence.ts`](./packages/contracts/src/scene-intelligence.ts) — `DetectSceneCutsInput` (`videoPath`, `startTime`, `endTime`, optional `threshold`), `DetectSceneCutsOutput` (`cuts: number[]`, clip-relative).
- Module: [`packages/scene-intelligence/src/detect-scene-cuts.ts`](./packages/scene-intelligence/src/detect-scene-cuts.ts) — one ffmpeg subprocess call using `select='gt(scene,threshold)',showinfo` to flag hard shot/scene cuts, injected via `deps.execFile`/`deps.ffmpegPath` (same shape as audio-intelligence's `deps`). Parses `pts_time:` occurrences out of ffmpeg's `showinfo` stderr; never throws — a failed/unparseable run returns `{ cuts: [] }`, same "optional signal" contract as every other subprocess module here.
- **Same unverified-sandbox caveat as Audio Intelligence** — this was built in the same ffmpeg-less/Python-less sandbox, so the `showinfo` stderr parser is fixture-tested only, not run against a real `ffmpeg` binary. One specific open question is flagged in the module's own comments: whether `-ss` before `-i` resets `pts_time` to 0 at the seek point or reports absolute source time — if it's the latter, the fix is subtracting `startTime` before returning. **Run against a real ffmpeg binary before trusting this in production.**
- Adapter: `apps/worker/src/workers/render-clip.worker.ts` calls `detectSceneCuts({ videoPath: sourcePath, startTime, endTime }, sceneIntelligenceDeps)` right after building the reframe plan, wrapped in the same try/catch/never-fail-the-job pattern as face detection; the result is persisted as `Clip.sceneCuts` (`Float[] @default([])`, migration `20260706052907_add_clip_scene_cuts`) alongside `outputUrl` in the existing `prisma.clip.update()` call.
- Verified against a real database, not just mocks — a one-off script created a `Clip` with `sceneCuts`, updated it, read it back, and confirmed cascade-delete, against the actual dev Postgres. The ffmpeg-parsing half of the module remains the one unverified piece (see caveat above).
- **Batches SC-4/SC-5 (Motion Direction, Motion Peak Detection)** — proof that "extend, don't rebuild" (this file's own recurring instruction) can mean literally zero new subprocess calls: both are pure, synchronous extensions of the already-existing `deriveCameraMotionFeatures()`/`deriveMotionEnergyFeatures()`, computed from samples Batch SC-2/SC-3 already collect. No new Python script, no new model file, no new Prisma migration (the `Clip.motionEnergyFeatures`/`.cameraMotionFeatures` columns are opaque `Json?` — widening their Zod schema is enough). `dominantDirection` (SC-4) is majority-voted the same way `dominantMotionType` already is, but is deliberately *not* wired into the Fusion Engine (no defensible ordinal "more of this = better" reading, unlike zoom/pan/tilt) — it's descriptive/explainability only, same treatment as Batch 4.5's `trackingQualityMetrics`. `peakRatePerMinute` (SC-5) *is* wired in, under the existing `sceneMotion` signal key, still at weight 0. `deriveMotionEnergyFeatures()` gained a required `clipDurationSeconds` parameter for this (mirroring `deriveSceneFeatures`' own precedent) — its one call site (`render-clip.worker.ts`) already had `endTime - startTime` in scope.
- **Batch SC-6 (Motion Complexity)** — same "extend, don't rebuild" story, this time producing TWO new features instead of one, per the user's own explicit "feature-level fusion" direction from the Mini Fusion Engine v2 section above (extract named features, don't pre-blend into one module-owned score): `motionEnergyFeatures.motionVariability` (coefficient of variation of `motionEnergy` samples) and `cameraMotionFeatures.motionTypeDiversity` (normalized Shannon entropy over the pan/tilt/zoom/static per-sample counts `deriveCameraMotionFeatures()` already computes for `dominantMotionType` — free to add, no extra pass over the data). Both feed their existing `sceneMotion`/`cameraMotion` Fusion signals at the existing weight-0. `deriveMotionEnergyFeatures()`'s mean/stddev computation was factored into a shared `meanAndStddev()` helper reused by both `motionVariability` and SC-5's peak-threshold math, rather than computed twice over the same `values` array.
- **Batch SC-7 (Motion Smoothness / Camera Jitter)** — the fourth and final derived-only Motion Intelligence batch in this pass. `cameraMotionFeatures.smoothnessScore` is a magnitude-based complement to `shakeScore` (sign-reversal count only) — it averages `|Δdx| + |Δdy|` between consecutive classifiable samples and maps it to 0-1 via a new `JITTER_CAP` constant, same unvalidated-threshold honesty as every other cap in `derive-camera-motion-features.ts`. Wired into the Fusion Engine the same way `shakeScore` is (plain feature, `cameraMotion` signal, weight 0, explicitly undecided polarity). This closes out the "derived-only" Motion Intelligence roadmap (SC-4 through SC-7) — the next planned batch, Object Motion (SC-8), is the first one that genuinely needs a new detector/tracker and gets its own plan.

### Facial Intelligence (a nullable Json field, and the TS2742 trap it walks into if you don't narrow it)

- Contract: [`packages/contracts/src/facial-intelligence.ts`](./packages/contracts/src/facial-intelligence.ts) — `FACIAL_EMOTIONS` (fixed 7-class FER+ taxonomy), `FacialEmotionSample` (`t`, `emotion | null`, `score | null`).
- Module: [`packages/facial-intelligence/src/detect-facial-emotion.ts`](./packages/facial-intelligence/src/detect-facial-emotion.ts) — same shape as reframe's `detectFaces`: subprocess injected via `deps.execFile`/`deps.pythonPath`/`deps.scriptPath`/`deps.modelPath` (reusing face detection's own MediaPipe model file to crop to the most prominent face before classifying it — see `apps/worker/scripts/detect_facial_emotion.py`'s module comment). Propagates errors rather than swallowing them internally, same as `detectFaces` — the adapter owns the "never fail the job" decision, not the module.
- Same unverified-sandbox caveat as Audio/Scene Intelligence — fixture-tested only, the Python script itself has never been run against a real model/video.
- **The trap this one walked into**: `Clip.facialEmotions` is a nullable `Json` column, same category as `Clip.scores` (Fase 8) — and `VideosService.mapVideoWithClips` already had a comment explaining exactly why an un-narrowed `Json` field breaks `nest build`'s declaration emit (`TS2742: inferred type cannot be named without a reference to .../prisma/client/runtime`). The new field wasn't destructured out of that method's `...clip` spread at first, so it reintroduced the exact bug the comment warned about — caught by running the actual `nest build` (not just `tsc --noEmit`, which passed fine), a reminder that declaration-emit-only errors don't show up in a plain typecheck.
- Fixed the same way `scores` was: destructure `facialEmotions` out of the spread, narrow it through a new `toSharedFacialEmotions()` (`apps/api/src/videos/transcript-segment.util.ts`), and thread the real type through `packages/shared`'s `Clip`/`FacialEmotionSample` and `ClipsService.toDto()`.
- **A second, smaller trap**: writing `null` to a nullable `Json` column via Prisma's `update()` needs the `Prisma.JsonNull` sentinel, not a plain `null` — Prisma treats plain `null` on a `Json` field as ambiguous with "field not provided" and its generated types reject it (a compile error, not a silent bug) until you use `Prisma.JsonNull` for "set an actual SQL NULL here."
- Adapter: `apps/worker/src/workers/render-clip.worker.ts` calls `detectFacialEmotion({ sourcePath, startTime, endTime }, facialIntelligenceDeps)` right after scene cut detection, in its own try/catch (same never-fails-the-job pattern); persists `facialEmotions ?? Prisma.JsonNull` alongside `sceneCuts`/`outputUrl` in the same `prisma.clip.update()` call.
- Verified against a real database, not just mocks — a one-off script created a `Clip` with a `facialEmotions` array, cleared it to `Prisma.JsonNull`, rewrote it, read it back, and confirmed cascade-delete, against the actual dev Postgres. The Python/model half remains the one unverified piece (see caveat above).

### The `IntelligenceSignal` convention (raw vs. derived features, and defining a consumer's contract before the consumer exists)

Explicit user architectural direction, given right after the Facial Intelligence module above was finished: before extending the AI Fusion roadmap further, (1) give every signal module a shared shape so the eventual Fusion Engine doesn't need to special-case each phase's format, (2) add a dense "features" summary layer distinct from raw per-sample data, (3) keep raw and derived cleanly separated (raw stays available for debugging, features become the actual Fusion input), (4) preserve the "module throws, adapter catches" pattern unchanged, and (5) define the Fusion Engine's *input contract* now, not when Phase G is finally built.

- **[`packages/contracts/src/intelligence-signal.ts`](./packages/contracts/src/intelligence-signal.ts)** — not one Zod schema (every module's raw/features shapes differ), but a *convention* plus a generic helper: `intelligenceSignalSchema(rawSchema, featuresSchema) => z.object({ raw: z.array(rawSchema), features: featuresSchema })`. A detection/classification module's own exported function (`detectFacialEmotion`, `detectSceneCuts`) keeps returning bare `raw` — **no signature change** to code already built and verified in earlier phases. Deriving `features` is a **separate, pure, synchronous** export per module (`deriveFacialEmotionFeatures`, `deriveSceneFeatures`, `deriveAudioFeatures`) — the adapter calls both.
- **Raw and features are separated at the DB column level, not just the type level** — `Clip.sceneCuts`/`Clip.facialEmotions` (raw, already existing) are untouched; three **new** nullable `Json` columns (`audioFeatures`/`sceneFeatures`/`facialFeatures`) hold only the derived summaries. The Fusion Engine only ever needs to read the three `*Features` columns — never the raw timelines.
- **`packages/contracts/src/fusion.ts` defines the Fusion Engine's consumption contract now** — `fusionInputSchema` (`clipId` plus `audio`/`scene`/`facial`, each `.optional()` — a clip missing one or more signals must degrade gracefully, not force every signal present) and `fusionOutputSchema` (`highlightScore` nullable 0-100, a per-signal `breakdown`, and a required `reason` string — explainable by construction, same principle as Fase 8's `ClipScores`/`reason`). Every future signal module (Gesture, Eye Contact, Visual Intelligence) is expected to add an optional field to `fusionInputSchema` — extend it, never replace it, matching the roadmap's explicit "Mini Fusion Engine v1 gets extended at each checkpoint, not rebuilt."
- **The "module throws, adapter catches" pattern was NOT touched** — `detectSceneCuts`/`detectFacialEmotion`'s try/catch in `render-clip.worker.ts` is exactly what it was before this change; the three new `deriveXFeatures()` calls are added right after, operating on whatever raw data (possibly empty) came out of that unchanged try/catch.
- **The same TS2742 trap (see the Facial Intelligence entry above) reappeared** for these three new Json columns — fixed the identical way: `AudioFeatures`/`SceneFeatures`/`FacialEmotionFeatures` added to `packages/shared`'s `Clip`, narrowed via `toSharedAudioFeatures()`/`toSharedSceneFeatures()`/`toSharedFacialFeatures()` in both `VideosService.mapVideoWithClips` and `ClipsService.toDto`. A recurring lesson: **any** new nullable `Json` column on `Clip` needs to be destructured out of a spread and narrowed before it reaches an inferred return type in `apps/api`, not just the first one that happened to trigger the error.
- Verified against a real database — a one-off script created a `Clip` with all three feature columns populated, cleared one to `Prisma.JsonNull`, read it back, and confirmed cascade-delete.

### Mini Fusion Engine v1 (consuming a contract defined ahead of the module that implements it)

The Fusion Engine's contract (`fusionInputSchema`/`fusionOutputSchema`) was written in the entry above, *before* any module consumed it - this is the module that actually does.

- Contract: already exists — [`packages/contracts/src/fusion.ts`](./packages/contracts/src/fusion.ts).
- Module: [`packages/fusion-engine/src/compute-highlight-score.ts`](./packages/fusion-engine/src/compute-highlight-score.ts) — pure and synchronous, no `deps` at all (same shape as emoji-suggester), because combining already-computed features into a score needs no external call or deployment-specific value. Each signal (`audio`/`scene`/`facial`) is scored independently by its own sub-function and skipped entirely if that signal wasn't available - `highlightScore` is the average of whichever sub-scores exist, `null` only when literally none do.
- **Explicitly a heuristic, not a trained model** — same honesty already established for Fase 8's `ClipScores`: the dB-to-score and emotion-weight mappings are reasonable starting points with no engagement dataset behind them, documented as needing validation once real usage data exists.
- Adapter: `apps/worker/src/workers/render-clip.worker.ts` calls `computeHighlightScore({ clipId, audio: audioFeatures, scene: sceneFeatures, facial: facialFeatures ?? undefined })` right after the three `deriveXFeatures()` calls (Fase 28) — **not** wrapped in try/catch, because the function is pure/synchronous and the only way it could throw (a malformed input) can't happen given how its inputs are constructed just above.
- **The TS2742 trap for the third time** — `Clip.highlightBreakdown` (another nullable `Json` column) hit the exact same declaration-emit error as `facialEmotions` and the three Fase 28 feature columns. Fixed the identical way (`FusionBreakdown` in `packages/shared`, `toSharedHighlightBreakdown()`). `highlightScore`/`highlightReason` (a `Float?`/`String?`, not `Json`) needed no narrowing at all — a reminder that this trap is specific to `Json` columns, not nullable columns in general.
- Verified against a real database — a one-off script created a `Clip` with all three highlight columns populated, read it back, and confirmed cascade-delete.
- **Checkpoint 1 is now fully complete**: Audio + Scene + Facial Intelligence, their derived features, and a real Fusion Engine consuming them, all exist and are wired end-to-end. The next checkpoints (Gesture/Eye Contact, then Visual Intelligence) are expected to **extend** `fusionInputSchema` and `computeHighlightScore` with their own optional sub-scores, not replace either. **Superseded by v2 below**, per explicit user direction, before Eye Contact was built.

### Gesture Intelligence (mirroring Facial Intelligence almost exactly, but with its own model)

- Contract: [`packages/contracts/src/gesture-intelligence.ts`](./packages/contracts/src/gesture-intelligence.ts) — 7-gesture MediaPipe taxonomy plus `"none"` (a hand detected but no recognized gesture, distinct from `null` meaning no hand at all).
- Module: [`packages/gesture-intelligence/src/detect-gestures.ts`](./packages/gesture-intelligence/src/detect-gestures.ts) (subprocess, injected `deps`, same shape as `detectFacialEmotion`) + [`derive-features.ts`](./packages/gesture-intelligence/src/derive-features.ts) (pure, math identical to `deriveFacialEmotionFeatures` with gesture-shaped field names).
- **The one real difference from Facial Intelligence**: this needs its OWN MediaPipe model file (`gesture_recognizer.task` — a different Task entirely from face detection's `blaze_face_short_range.tflite`), so `apps/worker/src/gestureIntelligenceDeps.ts` has its own `modelPath`/env var rather than reusing face detection's.
- Same unverified-sandbox caveat, same TS2742 trap (fourth time) on `Clip.gestures`/`.gestureFeatures`, fixed identically.

### Mini Fusion Engine v2 (weighted, feature-level, with confidence/explainability/ranking as first-class stages)

Explicit user architectural direction, given after v1 shipped and while Gesture Intelligence was being built: (1) weighted, not averaged, scoring so each signal's contribution is independently tunable/optimizable later; (2) `confidence` and structured `explainability` as first-class output; (3) FEATURE-level fusion — extract/normalize/weight individual named features, not one pre-collapsed score per module, so a new module contributes richer information without losing detail. The user also supplied the actual weight numbers to use: Audio 35%, Scene 30%, Facial 20%, OCR 10%, LLM 5% (Gesture and any future signal default to 0 until there's data to justify a real weight).

- Contract: [`packages/contracts/src/fusion.ts`](./packages/contracts/src/fusion.ts) — completely reshaped. `fusionOutputSchema` gained `confidence` and `explainability.topFactors`; `highlightBreakdown`'s shape changed from one sub-score per signal (v1) to an array of per-FEATURE `contributions` (signal, feature, rawValue, normalizedValue, weight, weightedContribution) — v2's central idea made concrete in the schema itself. A new `rankedClipSchema` supports the batch-ranking stage.
- Module, split into explicit pipeline stages, each independently testable:
  - [`weights.ts`](./packages/fusion-engine/src/weights.ts) — `DEFAULT_FUSION_WEIGHTS`, the exact numbers the user gave, injectable as a parameter to `computeHighlightScore` rather than hardcoded forever (Checkpoint 5's planned "Weight Optimization" is expected to override this table, not touch engine code).
  - [`feature-pipeline.ts`](./packages/fusion-engine/src/feature-pipeline.ts) — `extractFeatures` (each signal's Features object → several named raw values, not one), `normalizeFeatures` (a per-feature-name registry mapping every value to `[0, 1]`), `weightFeatures` (a signal's configured weight split evenly across however many of its own features are actually present, so total influence matches the configured weight regardless of feature count).
  - [`compute-highlight-score.ts`](./packages/fusion-engine/src/compute-highlight-score.ts) — `computeScore` (weighted average over features with weight > 0), `computeConfidence` (coverage × quality), `buildExplainability` (top factors by `|weightedContribution|`, not raw normalized value — a small-weight feature with a big raw value shouldn't outrank a big-weight feature with a smaller one).
  - [`rank-clips.ts`](./packages/fusion-engine/src/rank-clips.ts) — a separate, tiny pure function operating on a BATCH of already-scored clips (not one clip in isolation), called once every clip in a video has finished rendering.
- **A real design bug found and fixed before it ever reached the adapter**: the first `computeConfidence` implementation computed `quality` from every feature named `peakConfidence`, including ones from a zero-weight signal (gesture). A high gesture confidence could inflate overall `confidence` even though gesture never moves `highlightScore` — a direct contradiction. Caught while writing a test asking "does adding gesture data to an already-scored clip change its confidence?" — it shouldn't, and didn't after adding a `weight > 0` filter to the `quality` calculation too. A regression test locks this in.
- Adapter: `render-clip.worker.ts` now passes `gesture` into `computeHighlightScore`, persists `highlightBreakdown: highlight.contributions`, `highlightExplainability: highlight.explainability`, `highlightConfidence: highlight.confidence` — and, once `allRendered` is true (an existing checkpoint from Fase 3), re-queries sibling clips, calls `rankClips()`, and persists `highlightRank` per clip, wrapped in its own try/catch (a ranking failure never fails the render job that just succeeded).
- **The TS2742 trap for the fifth time** — `highlightExplainability` (new `Json`) and `highlightBreakdown`'s changed shape (object → array, so its narrowing function's fallback changed from `?? {}` to `?? []`) both needed attention. Fixed identically to every prior occurrence.
- Verified against a real database — a one-off script created a `Clip` with gestures/gestureFeatures/highlightExplainability/highlightConfidence populated, simulated ranking two sibling clips, cleared gestures to `Prisma.JsonNull`, read everything back, and confirmed cascade-delete.
- **Update (Fase 32)**: "Prediction" and "Recommendation" are now built, and the "Practical Score" ambiguity flagged above was resolved by asking the user directly rather than guessing — see the next worked example.

### Mini Fusion Engine v2.1 — LLM signal, domain grouping, Prediction & Recommendation (clarifying ambiguity via `AskUserQuestion` instead of guessing)

Direct continuation of v2, in three back-to-back user directives. Two of them were ambiguous enough to block implementation outright: "Practical Score" didn't map to anything in `ClipScores`, and "Prediction"/"Recommendation" had no defined output shape. Both were resolved by asking the user (not guessing) before writing any code — the user picked **"new LLM-scored metric"** for `practicalValue` (scored independently by the LLM, not derived from other scores) and **"simple derived labels"** for Prediction/Recommendation (`{bucket, rationale}` / `{action, message}`, not a numeric probability).

- Contract: [`packages/contracts/src/clip-scoring.ts`](./packages/contracts/src/clip-scoring.ts) — `clipScoresSchema` grew from 7 to 9 fields (`practicalValue`, `ctaStrength`), plus a new `SCORE_DOMAINS` map (`engagement`/`knowledge`/`conversion`) that's a **naming convention only right now, not a weight allocation** — the `llm` signal's single configured weight is still split evenly across whichever of the 9 features are present, regardless of which domain they belong to. That's flagged explicitly in code comments as a deliberately-deferred step, not an oversight.
- `packages/fusion-engine/src/feature-pipeline.ts`'s `extractLlmFeatures()` maps `ClipScores` 1:1 into 9 domain-prefixed features (`engagement.hookStrength`, `knowledge.practicalValue`, `conversion.ctaStrength`, ...) — a straight mapping, not a derivation, because an LLM-scored `ClipScores` object is already "Features"-shaped per clip (unlike audio/scene/facial, which reduce a raw per-sample timeline down to a summary).
- [`predict.ts`](./packages/fusion-engine/src/predict.ts) and [`recommend.ts`](./packages/fusion-engine/src/recommend.ts) — two new pure pipeline stages appended after Explainability. `predictPerformance()` is a plain threshold function over the already-computed `highlightScore`/`confidence`; `buildRecommendation()` looks at the single weakest-contributing feature (among `weight > 0` items) when the prediction is negative, and maps its name to a specific, human-readable action via a lookup table. Both inherit the same "heuristic, not a trained model" honesty as the rest of this engine.
- **A latent wiring bug found by audit, not by a failing test**: `RenderClipJobData` grew a `scores` field so the render-clip job could feed a clip's own Fase 8 `ClipScores` into the new `llm` signal — but `apps/worker/src/queues.ts`'s `new Queue(name, opts)` has no explicit generic, so TypeScript enforces nothing about job-data shape at that call site. Adding a required field there is invisible to `tsc`; all three enqueue sites (`detect-clips.worker.ts`, `ClipsService.render`, `VideosService.retry`) had to be found by grepping for `renderClipQueue.add(`, not by trusting the compiler.
- **TS2742, sixth occurrence** — three new nullable `Json` columns (`llmFeatures`, `highlightPrediction`, `highlightRecommendation`) needed the same destructure-and-narrow treatment as every prior Json field.
- **A downstream build break found only by building `apps/web`, not just `apps/api`** — `TimelineEditor.tsx` and `VideoAnalysisDashboard.tsx` (Fase 10) each keep their own `SCORE_LABELS: Record<keyof ClipScores, string>` map (two deliberate copies, below this project's extract-at-3rd-duplication threshold). The compiler enforces that every `ClipScores` key has a label, so widening the interface broke `next build`'s type-check until both copies were updated. A reminder that a shared type in `packages/shared` changing means every consuming app needs a real build, not just the one you meant to touch.

### Object Intelligence Batch OI-1 (a new package, and a tracker precedent swap mid-design)

Explicit user architectural direction, given while researching what became SC-8: don't stop at
"Object Motion" — build a full Object Intelligence layer (per-entity detection/tracking/behavioral
features: `objectCount`, `dominantObject`, `objectMotionSpeed`/`Direction`, `objectInteraction`,
`objectPersistence`, `objectEntryExit`, `objectOcclusion`, `objectTrackingConfidence`,
`objectAttentionScore`), as its own standalone package (`packages/object-intelligence`), not an
extension of `scene-intelligence` — that package covers global scene/camera characteristics, this
one covers individual entities.

- **Detector choice was a real research question, not a default pick**: YOLOv8/Ultralytics was
  ruled out on licensing (AGPL-3.0 — commercial use requires open-sourcing the whole codebase or an
  Enterprise license), not technical merit. MediaPipe's Object Detector (EfficientDet-Lite0, COCO
  80-class, Apache 2.0) won because it's already this codebase's exact vision-detector ecosystem.
- **The tracker precedent changed mid-research, based on what the actual problem needed**: initial
  instinct was to generalize Face Intelligence Batch 4's Kalman-filter `FaceTracker` — but that
  tracker only ever follows a SINGLE most-prominent face (a literal 1×1 Hungarian assignment each
  frame), not a real multi-object solution. `@speedora/ocr-intelligence`'s `trackOcrText()` (Batch
  OCR-2) turned out to be the right precedent instead — it already solves genuine N-active-tracks-
  vs-M-detections-per-frame assignment (multiple simultaneous text blocks), entirely in pure
  TypeScript, post-hoc over already-collected samples. `track-objects.ts` generalizes it directly,
  with one change: `category` is a hard gate on the match cost (a "car" must never merge into a
  "person" track), not a weighted term like OCR's text-similarity.
- Contract: [`packages/contracts/src/object-intelligence.ts`](./packages/contracts/src/object-intelligence.ts) — `objectDetectionSchema`/`objectSampleSchema` mirror `ocr.ts`'s multi-detection-per-frame shape exactly (`category` is a plain `z.string()`, not an enum — COCO's 80 labels are an externally-fixed model vocabulary, not a small taxonomy this codebase designed, unlike `FACIAL_EMOTIONS`/`CAMERA_MOTION_TYPES`). `objectTrackSchema` mirrors `ocrTextTrackSchema` minus OCR-specific fields. `objectFeaturesSchema` needs no separate field for `objectPersistence`/`objectEntryExit` from the user's original taxonomy — those are just `ObjectTrack.persistenceScore`/`.startTime`/`.endTime`, already present per-track for free.
- Module: [`packages/object-intelligence`](./packages/object-intelligence) — `detect-objects.ts` (subprocess, same shape as `detectFaces`/`detectGestures`), `track-objects.ts` (the generalized OCR-style tracker above), `derive-object-features.ts` (aggregates tracks, same shape as `deriveOcrFeatures`).
- Adapter: `apps/worker/src/workers/render-clip.worker.ts` calls `detectObjects()` in the same never-fails-the-job try/catch as every other MediaPipe detector, then `trackObjects()`/`deriveObjectFeatures()` unguarded (pure functions), persisting `objects`/`objectTracks`/`objectFeatures` (three new nullable `Json` columns, same three-layer pattern as `ocrText`/`ocrTracks`/`ocrFeatures`) in the existing `prisma.clip.update()` call.
- Fusion Engine: `object` added to `FUSION_SIGNALS`/`fusionInputSchema`/`DEFAULT_FUSION_WEIGHTS` (weight 0, collect-first-calibrate-later). `averageObjectsPerFrame`/`averageTrackingConfidence`/`averagePersistence` are extracted; `dominantObject` is deliberately NOT scored (no defensible ordinal ranking across 80 unrelated COCO categories, unlike OCR's purpose-designed 6-category `OCR_CATEGORY_WEIGHT` table) — same reasoning as Motion Intelligence Batch SC-4's `dominantDirection`.
- **TS2742, again** — `objects`/`objectTracks`/`objectFeatures` needed the same destructure-and-narrow treatment in `VideosService.mapVideoWithClips`/`ClipsService.toDto` as every prior nullable `Json` column. Caught proactively this time (both `nest build` and `next build` run clean on the first try), not by hitting the trap.
- Verified against a real database — the actual dev Postgres (`docker compose`, not a fixture) was reachable in this environment, so `prisma migrate dev` ran for real rather than being deferred as "pending verification."

### Object Intelligence Batch OI-2 (reusing a sibling package's enum instead of inventing a near-duplicate)

Immediate follow-up to OI-1, continuing the "extend, don't rebuild" pattern one level further: zero new subprocess, and this time zero new DB migration too — `motionSpeed`/`motionDirection` (`objectTrackSchema`) and `averageMotionSpeed` (`objectFeaturesSchema`) all live inside the three `Json` columns OI-1 already added.

- **`motionDirection` reuses `CameraMotionDirectionType` directly** (imported from `scene-intelligence.ts` into `object-intelligence.ts`, both within `packages/contracts`) rather than defining a near-identical object-specific enum — a bounding box growing/shrinking is genuinely the same "toward/away from camera" concept as camera zoom in/out, not a coincidental naming overlap. `track-objects.ts`'s `computeMotionDirection()` mirrors `deriveCameraMotionFeatures()`'s zoom-then-pan/tilt classification priority, but computes a NET first-to-last comparison rather than a per-appearance-pair majority vote — a single tracked object's overall displacement is the more natural per-track read than a frame-by-frame vote.
- **A real test-fixture lesson about the tracker's own matching constraint**: the first draft of the motion tests used displacements large enough to clearly exceed `OBJECT_MOTION_CAP`, but large enough relative to the (default 0.2-wide) test fixture's own bounding box that consecutive appearances no longer cleared `MATCH_COST_THRESHOLD` — the tracker legitimately split them into two separate one-appearance tracks instead of one moving track, so `motionDirection` came back `null`. Not a bug in the production code — an honest consequence of `track-objects.ts`'s own documented limitation (no Kalman-style position prediction to bridge a gap). Fixed by widening the fixture's bounding box for the "capped at max speed" test, matching the real-world intuition that a wide/large object can plausibly move further between samples while still being trackable by IoU alone than a narrow one can.
- `dominantObject`/`objectCount` (OI-1) and now `motionDirection` (OI-2) are wired for storage/persistence but deliberately NOT extracted into Fusion scoring - the recurring "categorical label with no defensible ordinal ranking" reasoning, this time stated three times across two batches rather than once, which is itself a signal this exclusion is a stable convention, not a one-off judgment call.

### Object Intelligence Batch OI-3 (the first OI feature needing cross-object, not just cross-time, data)

Continues the "extend, don't rebuild" streak (zero new subprocess, zero new migration - `occlusionScore`/`averageOcclusionScore` live inside OI-1's existing `Json` columns), but is architecturally different from OI-1/OI-2 in one way: those two only ever looked at a single track's OWN appearances over time; occlusion inherently needs to compare a detection against every OTHER detection present in the SAME frame. `track-objects.ts`'s main per-sample loop already has every frame's full detection list in scope (`detections = sample.objects`), so `computeOcclusionScores()` slots in as one more per-sample computation alongside the existing match-cost candidate search, reusing the same `iou()` helper `MATCH_COST_THRESHOLD`'s candidate search already relies on - no new cross-object machinery needed, just a new use of data already in scope.

`occlusionScore` deliberately ignores category (unlike the track-matching cost function's hard gate) - real-world occlusion doesn't care whether the occluding object is the same kind of thing. Wired into Fusion with the same "polarity unproven" honesty as `cameraMotion`'s `shakeScore`/`smoothnessScore`, not `sceneMotion`'s `averageMotionEnergy` - occlusion's direction (good or bad for engagement) is genuinely unclear, unlike motion/persistence's more defensible "more = more dynamic" reading.

### Object Intelligence Batch OI-4 (a mid-flight redesign, not a first-draft implementation)

The one batch in this roadmap explicitly flagged from the start as needing real design judgment, not a mechanical extension - "objectInteraction" has no single obvious computable proxy. First attempt: reuse `occlusionScore`'s exact shape but with center-distance instead of IoU (`interactionScore`, proximity-only). This shipped, built, and passed its own tests - then the user reviewed it mid-session and redirected before it was wired further: expose it as `interactionConfidence` (not a bare "score"), make explicit that this pipeline has no depth/pose/action recognition and therefore cannot claim real interaction, and combine THREE components (proximity, temporal co-presence, distance trend) rather than proximity alone.

- **A real example of "ask, don't guess" working as designed**: an `AskUserQuestion` was raised with a recommended default (proximity-only) and three alternatives before implementation began; it went unanswered for 60s, so implementation proceeded with the recommended default per this codebase's own "proceed on reasonable judgment when blocked" convention - and the user's follow-up correction arrived exactly along the lines the question had anticipated (their own message referenced the "proximity is the primary proxy" framing directly), confirming the question had correctly identified the real ambiguity rather than guessing an unrelated concern.
- **The rework required restructuring how the module computes track fields, not just renaming one**: `occlusionScore`/`motionSpeed`/etc. are all computable per-track in ONE pass (`buildTrack()`, called via a single `.map()` over finished tracks) because they only need that track's OWN appearance history. `interactionConfidence`'s temporal co-presence component needs every OTHER track's finished start/end time - not available until every track is built. `trackObjects()` now runs `buildTrack()` first (returning tracks minus `interactionConfidence`, plus two internal-only intermediate scores), then a second pass computes `interactionConfidence` per track against the now-complete track list, matching the "collected once, computed globally" shape this composite genuinely needs rather than forcing it into the single-pass shape every other field happens to fit.
- `computeConvergenceScore()` reuses the exact same per-appearance nearest-distance series `computeProximityScore()` averages - one raw measurement (`nearestDistance`, kept un-normalized on `Appearance` specifically so both consumers could derive their own summary from it), two independent derived readings, no duplicate geometry computation.
- Naming as a deliverable: `interactionScore` → `interactionConfidence` is not a cosmetic rename - the contract comment, docs, and code comments were all rewritten to state explicitly what this number is NOT (a real interaction/action signal) alongside what it is (a proximity/timing/trend heuristic), matching this codebase's established "don't let a name imply more certainty than the underlying measurement supports" discipline (see Face Intelligence's `dominantAffect` vocabulary restriction for the same principle applied earlier).

### Object Intelligence Batch OI-5 (a second mid-flight redesign - a domain layer, not a flat average)

Closes out the originally-scoped 10-feature Object Intelligence roadmap (OI-1 through OI-5). Like OI-4, this batch went through a real design correction mid-implementation, not a first-draft-and-done sequence: an initial `attentionScore` draft (an unweighted five-way mean of size, centrality, persistence, motion, and inverse-occlusion) was fully specified in the contract and had its supporting constants (`ATTENTION_SIZE_CAP`/`ATTENTION_CENTRALITY_CAP`) added to `track-objects.ts` before the user reviewed it and redirected to a structurally different design - the constants were then deleted rather than force-fit, since the new design has no size/centrality concept at all.

- **The redesign's actual content**: instead of one flat average over five-plus raw signals, `attentionScore` is built as a small internal "fusion within Object Intelligence" - three intermediate, independently-explainable domain scores (Visibility, Activity, Social - see `docs/ai/object-intelligence.md`'s Batch OI-5 section for the exact ingredients), each an unweighted mean of already-computed or newly-derived `[0, 1]` values, then `attentionScore = average(visibility, activity, social)`. This mirrors the shape of the TOP-LEVEL Fusion Engine itself (extract → normalize → combine, with named intermediate structure rather than one opaque blend), just applied one architectural layer down, inside a single signal package rather than across all of them. The user's own stated reason for the redesign - "jauh lebih mudah dijelaskan" (much easier to explain) - is a real, recurring design value in this codebase, not just user preference: `docs/ai/fusion.md`'s own explainability requirements exist for the same reason.
- **A second new field alongside the redesign, not part of it**: `attentionConfidence`, added on the user's explicit instruction to mirror a pattern already established elsewhere in the codebase (Speaker Intelligence's `speakerConfidenceScoreSchema`) - a SEPARATE reliability signal for a composite score, not a sixth ingredient folded into the score itself. The user's own example (a track appearing for 0.2s could score a high `attentionScore` from geometry alone, but should read as low-confidence) is exactly the "is this composite backed by enough data" question `computeConfidence()` already asks at the top-level Fusion Engine (`coverage × quality` in `compute-highlight-score.ts`) - `attentionConfidence` asks the same question one layer down, scoped to a single track's own appearance count (`clamp01(appearsFrames / CONFIDENCE_FRAME_CAP)`), deliberately not persistence-based so the same absolute amount of observed evidence reads the same regardless of how long the surrounding clip happens to be.
- **Two new per-track sub-computations needed cross-track data, extending OI-4's established two-pass precedent rather than introducing a third pattern**: `partnerScore` (Social domain - count of distinct OTHER tracks ever detected nearby in the SAME sampled frame) needs raw per-appearance timestamps/boxes from every other track, not just their summarized start/end time the way OI-4's `temporalOverlapScore` needed - so the second pass now looks at the original `ActiveTrack[]` (with full `.appearances`), not only the `buildTrack()`-summarized track list, the one place in this module a track's OWN computation reaches into ANOTHER track's raw per-frame data rather than its finished aggregate.
- **Deliberate reuse over recomputation**: the Social domain's `coPresenceScore` is the exact same `temporalOverlapScore` value OI-4's `interactionConfidence` already computes - passed as a parameter into both consumers instead of being computed twice, the same "one raw measurement, multiple independent derived readings" discipline OI-4's `computeConvergenceScore()`/`computeProximityScore()` pair already established for `nearestDistance`.
- **`attentionConfidence` reuses the Fusion Engine's existing `peakConfidence` feature-name convention**, not a new parallel one: `extractObjectFeatures()` pushes `averageAttentionConfidence` under `feature: 'peakConfidence'` (the same name facial/gesture's own classifier-certainty features already use), so `computeHighlightScore()`'s `computeConfidence()` picks it up automatically once `object`'s weight ever moves off 0, rather than requiring a second confidence-aggregation code path to be added later.

### Shared sub-schemas

`packages/contracts/src/transcript-word.ts` holds the one `TranscriptWordInput` shape used by clip-scoring, cutlist, subtitles, and reframe — extracted once a second module needed the exact same shape, rather than each contract file defining its own copy (the same "extract at 2nd/3rd duplication" convention the rest of this codebase already follows).

Use these as templates for the next module — pick the clip-scoring shape if the module makes one external call and produces one JSON result; pick the cutlist/emoji-suggester shape if it's pure, synchronous logic with no external dependency at all; pick the reframe shape if the module needs an injected external call plus deployment-specific file/executable paths.

## State machine + audit trail for long-running jobs

The `Video` pipeline (`UPLOADING`/`IMPORTING` → `UPLOADED` → `TRANSCRIBED` → `CLIPS_DETECTED` → `RENDERED`, or `FAILED` at any step) already had an explicit `VideoStatus` enum as its state - the missing piece was a durable history of *transitions*, not just the current value, and a single choke point that writes it.

- **`VideoStatusEvent`** (`packages/database/prisma/schema.prisma`) — one row per transition: `videoId`, `toStatus`, `errorMessage` (set only for `FAILED`), `createdAt`. There's no `fromStatus` column - transitions for one video are always sequential (never processed by two workers concurrently for the same video), so the previous status is just the prior row's `toStatus` when queried `ORDER BY createdAt`, and storing it again would be redundant.
- **`@speedora/database`'s `updateVideoStatus()`/`recordVideoStatusEvent()`** (`packages/database/src/video-status.ts`) are the *only* sanctioned way to change `Video.status`. `updateVideoStatus(prisma, videoId, status, { data?, errorMessage? })` updates the row and inserts the event atomically via `$transaction`; `recordVideoStatusEvent()` is the bare event-insert half, for callers (`VideosService.upload()`/`.importFromYoutube()`) that need to compose it into their own transaction because the `Video` row is being `create()`'d for the first time in that same transaction.
- **Every existing call site was migrated to go through these** — `VideosService` (upload/import/retry) and all four workers (`transcribe`, `detect-clips`, `import-youtube`, `render-clip`) no longer call `prisma.video.update({ data: { status ... } })` directly. `FAILED` transitions now also capture `error instanceof Error ? error.message : String(error)` into the event row, so a failure can be diagnosed from a DB query alone, without needing Sentry access.
- **This is deliberately infrastructure, not a JSON-contract module** — `video-status.ts` takes a real `PrismaClient` and writes to the DB directly; it doesn't belong in `packages/contracts`/a stateless module package, because its entire job *is* being the DB-access choke point the rest of this document tells other modules to stay away from.
- **Retry behavior itself was intentionally left unchanged** — `VideosService.retry()` still infers which stage to resume from existing data (no transcript segments → re-run transcribe, etc.), which was already correct and well-tested. The audit trail is a new observability layer on top, not a replacement for that inference logic.
- **Verified against a real database, not just mocks** — beyond the unit tests (`packages/database/src/video-status.spec.ts` plus every updated caller's spec), a one-off script ran the full lifecycle (create → transitions → a `FAILED` with a message → query the ordered history → delete the video → confirm the cascade removed its events) against the actual dev Postgres.

## Composing multiple modules: the render-clip Feature Orchestrator

Everything above documents the pattern for *one* module and its adapter. It says nothing about
what happens when an adapter has to call **many** modules with real dependencies on each other —
which is exactly what `apps/worker/src/workers/render-clip.worker.ts` grew into: by the time
Composition Intelligence was wired in (the roadmap immediately before this one), it was a single
1,028-line async handler running 9 independent raw AI detectors (scene cuts, motion energy, camera
motion, facial emotion, gestures, face landmarks, OCR text, objects — each hand-wrapped in its own
try/catch that warns and falls back on failure) and ~20 pure derive/composite functions with real
dependencies on each other and on the raw signals (e.g. `editingRhythmFeatures` needs
`sceneFeatures` + `motionEnergyFeatures` + `audioFeatures`; `compositionFeatures` needs
`primarySubjectSamples`, which itself needs `faceLandmarks` + `activeSpeakerSamples` +
`objectTracks`). Every new signal meant hand-editing the same five places in that one file: the
detector call + try/catch, the derive call, `computeHighlightScore`'s object literal,
`prisma.clip.update`'s object literal, and the spec file's fixtures — easy to get one of right and
another wrong.

**Design principle carried over from every module pattern above**: reuse first, derive second,
extend third, new abstraction only when justified by more than one real use case. `apps/worker`'s
*other* AI-adjacent worker, `detect-clips.worker.ts`, has a fundamentally different shape — one
required linear step (`scoreClipCandidates()`), not many independent/optional signals — so there is
exactly **one** real consumer for a graph executor today. The executor therefore lives inside
`apps/worker`, not a new `packages/*`, but is written with zero render-clip-specific knowledge so
that extracting it later (if a second consumer ever needs one) is mechanical, not a rewrite.

- **`apps/worker/src/render-graph/executor.ts`** — the generic part. A `GraphNode<Ctx, Out>` has an
  `id`, a `deps: readonly NodeId[]` list, a `run(get, ctx)` function, and `optional`/`fallback` (the
  9 raw detectors are `optional: true` with a fallback, reproducing the "try/catch, warn, use a
  fallback" pattern uniformly instead of duplicating it per call site; the ~20 derive/composite
  nodes are `optional: false` — a "never throws" node throwing is a real bug and propagates
  uncaught, exactly matching their pre-graph unwrapped-call behavior). `runGraph()` computes
  execution order via **Kahn's algorithm with level-order batching**: nodes with satisfied
  dependencies form a "level," levels run in sequence, and (by default) nodes within a level are
  still awaited one at a time — `concurrency: 'level-parallel'` (`Promise.all` per level) exists and
  is unit-tested, but isn't the default anywhere it's wired up, since running the 9 independent
  detectors concurrently is a real future latency win that needs a capacity-planning answer (peak
  concurrent Python/MediaPipe/ffmpeg subprocess count per worker container) this executor doesn't
  make on its own. A malformed `deps` reference throws `GraphConfigError`; a genuine cycle throws
  `GraphCycleError` (both essentially free side effects of Kahn's algorithm on a hand-authored
  static array).
- **`apps/worker/src/render-graph/context.ts`** — `RenderGraphContext`, the ambient
  already-resolved data every node's `run` reads (`sourcePath`/`startTime`/`endTime`, `transcript`,
  `scores`, and two precomputed fields — `audioActivityWindows`/`speakerTurns` — that the pre-graph
  code computed redundantly up to 3 times each; computing them once here is a deliberate,
  explicitly-flagged behavior change, safe because both are pure/deterministic over the same
  arguments every time).
- **`apps/worker/src/render-graph/nodes/*.ts`** — the ~30 actual node declarations, grouped the same
  way the pre-graph file's own section comments already grouped them (`scene.ts`,
  `facial-gesture.ts`, `face-speaker.ts`, `ocr.ts`, `object.ts`, `composition.ts`,
  `audio-editing.ts`). Three representative shapes:
  ```ts
  // Detector node - zero deps, optional, matches the pre-graph fallback exactly.
  { id: 'sceneCuts', deps: [], optional: true, fallback: [],
    label: 'scene cut detection', dataLabel: 'scene data',
    run: async (get, ctx) => (await detectSceneCuts({ videoPath: ctx.sourcePath, ... }, sceneIntelligenceDeps)).cuts }

  // Simple derive node - one dep, always computed, unwrapped.
  { id: 'motionEnergyFeatures', deps: ['motionEnergy'], optional: false,
    run: (get, ctx) => deriveMotionEnergyFeatures(get('motionEnergy'), ctx.endTime - ctx.startTime) }

  // Multi-dependency composite node - reads across two "layers".
  { id: 'editingRhythmFeatures',
    deps: ['sceneCuts', 'motionEnergy', 'sceneFeatures', 'motionEnergyFeatures', 'audioFeatures'],
    optional: false, run: (get, ctx) => deriveEditingRhythmFeatures({ ...get(...) across all five }) }
  ```
- **`apps/worker/src/render-graph/sinks.ts`** — node ids don't match `FUSION_SIGNALS` keys 1:1
  (`sceneFeatures` → `scene`, `motionEnergyFeatures` → `sceneMotion`, `faceLandmarkFeatures` →
  `faceGeometry`, ...) and don't map 1:1 to Prisma columns either (`speakerScores` alone fans out to
  4 columns: `speakerConfidenceScores`/`speakerEngagementScores`/`speakerImportanceScores`/
  `speakerHighlightMoments`). Two separate mapping tables, not one shared rule, because the two
  target shapes have genuinely different cardinality: `FUSION_INPUT_MAP` is a plain
  `Partial<Record<NodeId, keyof FusionInput>>` (`toFusionInput()` loops it, skipping `null`/
  `undefined` values — the same loop handles both "always-present" fields like `audioFeatures` and
  "optional, null-becomes-undefined" fields like `cameraMotionFeatures` without a separate code
  path, since a never-null value always passes the `!= null` check). `CLIP_UPDATE_MAP` is
  `{ [K in NodeId]?: (result) => Partial<Prisma.ClipUpdateInput> }` — one small function per node,
  because `Prisma.JsonNull` vs. a plain array vs. an always-present object are three genuinely
  different rules depending on the column, and the fan-out case needs to return more than one field
  anyway.
- **Migration was incremental, not a rewrite** — the executor was built and tested in isolation
  against toy graphs first; `sceneCuts`/`sceneCutEvents` (the smallest real signal with both a
  zero-dep and a one-dep node, plus a real injected `Deps` object) migrated next as a proof of
  concept while every other line of `render-clip.worker.ts` stayed untouched; the remaining ~28
  nodes migrated group by group, in the same order as the file's own pre-existing section comments;
  `sinks.ts` (the highest silent-mapping-slip risk) migrated last, verified against the existing
  spec file's exact `toEqual`/`objectContaining` assertions on `prisma.clip.update`'s call args. The
  existing 43-test spec file (`render-clip.worker.spec.ts`) needed **zero test rewrites** through
  the entire migration — it mocks at the package level (`jest.mock('@speedora/scene-intelligence',
  ...)`), not the worker's internal control flow, so moving a call site into `nodes/scene.ts`
  doesn't change what's being mocked. `render-clip.worker.ts` shrank from 1,028 lines to 524.
- **New test surfaces this migration added, not replaced**: `executor.spec.ts` (toy graphs -
  ordering, cycle/config-error detection, the optional/fallback wrapper, sequential vs.
  level-parallel timing) and `sinks.spec.ts` (a hand-built `RenderGraphResult` fixture through
  `toFusionInput`/`toClipUpdateData`, zero BullMQ/Prisma/detector mocking at all) - 66 tests total
  across the three render-graph/render-clip spec files, up from 43.
- **What would trigger extracting `executor.ts` into a `packages/*` module**: a second real
  consumer with the same "many independent/optional steps with real dependencies on each other"
  shape - `detect-clips.worker.ts` growing more independent pre-scoring signals is the most likely
  candidate, not a hypothetical future refactor for its own sake.
- **Explicit non-goals** — turning on `concurrency: 'level-parallel'` against real detectors
  (needs the capacity-planning answer above, not an architecture decision); touching
  `detect-clips.worker.ts`; touching the outer try/catch/finally (real-failure handling for
  source download/render/upload, scratch-file cleanup) or the sibling-ranking pass, both of which
  stay outside the graph exactly as they were; `buildReframePlan`'s own face detection
  (`@speedora/reframe`'s `detectFaces`, a separate concern from the AI-signal graph, still
  imperative, its output threaded into `RenderGraphContext` as a fixed value).

## Checklist for adding a new stateless module

1. Define the input/output contract as a Zod schema in `packages/contracts/src/<module-name>.ts`, exporting both the schemas and their inferred types. Keep the input shape as narrow as the module actually needs — don't reuse a full DB-shaped type from `packages/shared` if the module only reads a few of its fields.
2. Create `packages/<module-name>` with a single exported function following `(input, deps?) => Promise<Output>`. Any external call the module needs (LLM, other API, subprocess) goes through `deps`, injected by the caller — never constructed from `process.env` or `__dirname` inside the module. This includes deployment-specific file paths/executable names (see the reframe example) — if the module would otherwise build a path from `__dirname` or read an env var directly, that value belongs in `deps` too.
3. Write the module's tests purely against JSON fixtures (plus a faked `deps`) — no Prisma/BullMQ/Sentry mocking. If you find yourself wanting to mock the database to test this file, the logic in it doesn't belong in this package.
4. Write (or extend) the adapter in `apps/api` or `apps/worker` that narrows DB/job data into the module's input contract, calls it, and persists/enqueues the output. Test the adapter by mocking the module itself, not by re-testing the module's internal logic.
5. If this module is a step in a longer job pipeline, make sure its DB status transitions fit the existing state machine (see `VideoStatus`/`PublishStatus` in `packages/shared`) rather than introducing a new ad-hoc boolean flag. For `Video.status` specifically, always go through `updateVideoStatus()`/`recordVideoStatusEvent()` (`@speedora/database`) - never a raw `prisma.video.update({ data: { status ... } })` - so the transition lands in the audit trail too (see "State machine + audit trail" above).
6. `pnpm typecheck && pnpm lint && pnpm build && pnpm test` must all stay green, including every existing test suite (regression guard) — not just the new one.

## Why this reduces collision risk

- A new stateless module never touches DB schema, so it's safe to build in parallel without migration conflicts.
- DB schema changes only ever happen in adapters — few, well-known files — making them easy to coordinate when two pieces of work overlap.
- An explicit state machine (see `VideoStatus`/`PublishStatus`) prevents the "scattered boolean flags" failure mode that's usually the hidden source of bugs as pipelines grow more steps.
