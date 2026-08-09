# OCR Intelligence

On-screen text detection for the Fusion Engine's `ocr` signal (weighted 10% — the only newly-added
signal in the AI Fusion roadmap that shipped with a *real* non-zero weight from the start, not 0).
Package: `packages/ocr-intelligence`. Roadmap: OCR-1 (raw detection) → OCR-2 (tracking +
classification, wires the Fusion Engine signal) → OCR-2.5 (evaluation tooling) → OCR-3 (object
detector, deferred) → OCR-4 (scene understanding, deferred).

## OCR-1 — text detection + bounding boxes

`apps/worker/scripts/detect_ocr_text.py` — Tesseract via `pytesseract.image_to_data()`, grouped by
line (Tesseract's own block/paragraph/line numbering), ~1 sample/sec. `OCR_MIN_CONFIDENCE=30`
(Tesseract's own 0–100 scale) filters noise. `Clip.ocrText` (`Json`, always an array — one frame
can have multiple simultaneous text regions, unlike every other per-sample detector in this
pipeline which reports at most one measurement per sample). No `ocrFeatures` yet at this stage.

`nearObject` (an object-detector-dependent field from the original 12-feature OCR spec) was
explicitly deferred to OCR-3 rather than approximated — this codebase has no general object
detector (only a face detector), and the user chose to skip it rather than ship a weak proxy.

## OCR-2 — tracking + rule-based classification

Pure TypeScript derivation over OCR-1's raw samples, no new subprocess. Greedy lowest-cost-first
per-frame assignment (Levenshtein text similarity + IoU), simpler than Face Intelligence's Kalman+
Hungarian tracker (Batch 4) because text doesn't move with real physics and has a genuine
multi-object-per-frame association problem that face tracking doesn't. `MAX_MISS_SAMPLES=1`
tolerates one dropped sample (brief occlusion) before ending a track.

Per-track features: `motionScore`, `persistenceScore` (fraction of the **whole clip's** samples,
not just the track's own lifespan — a deliberately "how persistent across the whole clip" reading),
`appearsFrames`, `durationSeconds`, `nearFace` (cross-references `FaceLandmarkSample` bounding
boxes via a narrow adapter-level type, no package dependency from `ocr-intelligence` to
`facial-intelligence`), `language` (always `null` currently — Tesseract is configured English-only),
`regexFlags` (`isPriceLike`/`isNameLike`, pattern heuristics not NER).

**Classification ("HybridRuleEngine")** scores all six categories (subtitle/slide/caption/logo/
price/name) via a multiplicative gate (position × size × motion modifier), not an average — an
average let small-but-centered elements score too highly as "logo" just for being small. Argmax
becomes `category`, the winning score becomes `categoryConfidence`.

Storage is three layers: `Clip.ocrText` (raw, OCR-1) → `Clip.ocrTracks` (tracked + classified, all
features kept for future ML training data, OCR-2) → `Clip.ocrFeatures` (per-category aggregate
rates — `subtitleCoverageRate`, `logoPresenceRate`, `priceMentionRate`, etc. — the only one the
Fusion Engine actually consumes).

## OCR-2.5 — calibration & evaluation tooling

Not a new AI signal — a way to measure whether OCR-2's rule engine is actually good, before
deciding whether OCR-3's object detector is worth building. `evaluateOcrClassification()`
(`packages/ocr-intelligence`, pure/sync) computes a confusion matrix, per-category precision/
recall/F1 (`null`, not `0`, when a category was never predicted or never actually occurred), and
confidence calibration (10 buckets, `averageConfidence` vs. `accuracy` per bucket — a
well-calibrated classifier has these roughly equal). `ocrLabeledTrackSchema`
(`packages/contracts`) defines the ground-truth format a human annotator needs to produce.
`apps/worker/src/scripts/evaluate-ocr-classification.ts` is a real runnable CLI
(`pnpm evaluate:ocr <file.json>`), no Prisma/BullMQ dependency (the eval function itself is pure).

No real labeled dataset exists yet — this ships the measurement tool and the ground-truth format,
not evaluation results. See the OCR Review UI below for the annotation workflow that's meant to
produce that dataset.

## OCR Review UI

`apps/web`'s `/videos/:id/ocr-review` — see `frontend.md` for the UI details. Purpose: let a human
annotate `ocrTracks` (predicted category vs. actual category) fast enough to eventually accumulate
the 100–300-video / 3,000–10,000-region dataset OCR-2.5's tooling is built to evaluate. Export
format matches `ocrLabeledTrackSchema` exactly, feeding straight into `pnpm evaluate:ocr`.

## OCR Highlight (Visual Emphasis Engine Phase C5)

Until this phase, every consumer of `ocrTracks` was scoring/analytics-only (the Fusion Engine, Phase
C1's `ocr_highlight` suggestion timeline). Phase C5 (`docs/ai/visual-emphasis-engine.md`) is the
first to actually draw something on screen from it — a burned-in highlight box (ASS `\p1` vector
rectangle, reusing the existing `subtitles=` filter pipeline, real ffmpeg+libass verified) around a
qualifying `price`/`name` track. Flag-gated behind `VISUAL_EMPHASIS_OCR_HIGHLIGHT_ENABLED`, off by
default. See that doc's "Phase C5 architecture (as shipped)" section for the coordinate-transform
design (a static crop-window snapshot at the highlight's own start, not continuous pan/zoom
tracking) and its documented drift limitation.

## Deferred

- **OCR-3** — integrate a general object detector (`nearObject`, `objectClass`, text-object
  spatial relations). Blocked on: no object detector currently in the codebase, and a decision
  that the rule engine's measured quality (via OCR-2.5, once real data exists) actually warrants
  it.
- **OCR-4** — full scene understanding combining face + object + OCR signals.
