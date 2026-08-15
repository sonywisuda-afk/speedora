# Render Quality Judge — Phase C1 ("Render QA," data only)

> **Status: Phase C1 shipped, flag-gated (`RENDER_QUALITY_JUDGE_ENABLED`, default off, gates future
> API exposure only).** The third phase of the user's 30-section "Speedora Editorial Operating
> System" mission, building on Phase A (`docs/ai/editorial-director.md`) and Phase B
> (`docs/ai/edit-plan-director.md`), both merged. Phase D (real-video benchmark/human evaluation) —
> see `docs/ai/phase-d-benchmark.md` — has its automated-benchmark half shipped and run for real
> once; the actual blind human evaluation session hasn't happened. Phase C2 (real Visual/Audio/
> Caption quality detectors, auto-reject/re-render) is a deliberately deferred, separately-scoped
> follow-up — see §6.

## 1. What the mission asked for, and why this phase stops short of it

The mission's Section 17 asked for a full **Quality Judge**: score every rendered clip across
Editorial/Narrative/Visual/Audio/Technical/Caption quality, then **auto-reject and safely fall back
to a re-render** when a clip scores too low. A 3-way parallel audit (pre-render validation hooks,
post-render quality measurement infrastructure, retry/re-render mechanics) found that full ask isn't
safely buildable in one pass:

- **Auto-reject + re-render mechanics are entirely absent**, and the surrounding architecture has no
  headroom for them: `RENDER_CLIP_JOB_TIMEOUT_MS` (45 minutes) is explicitly sized for exactly one
  render pass + one trim pass; `renderClip()` (`apps/worker/src/ffmpeg.ts`) is a monolithic,
  non-reusable ffmpeg call; and no `Clip` status/verdict column exists anywhere to represent a
  gate/reject decision.
- **Most of the mission's named Quality Judge inputs need real new detection work, not
  orchestration**:
  - VisualQuality has only a weak, indirect proxy — `EditorialDecision.categories.visualEngagement`
    measures how much the Visual Emphasis Engine *acted on* a clip (average
    `editingSuggestions[].score`), not the picture's actual quality (framing/exposure/sharpness/
    composition).
  - AudioQuality has only a weak, indirect proxy — `speakerClarity` measures conversational
    turn-taking overlap, not perceptual audio quality. Per-segment `rmsDb` is explicitly documented
    elsewhere in this codebase as "not comparable across recordings."
  - CaptionQuality has **no signal at all**, compounded by a confirmed total absence of any
    transcript-to-audio alignment mechanism anywhere in this codebase — no ASR confidence field
    exists on `TranscriptWordInput`, and Lip Sync Verification checks mouth-movement-vs-audio-energy
    *timing*, not text accuracy.
- **What genuinely is free today**: `editorialDecision`/`editPlan` are already in scope, unmodified,
  right before every `renderClip()` call site; post-render, `probeVideoMetadata()` +
  `compareRenderManifestToProbe()`'s `RenderVerificationResult` + `Clip.durationSeconds` vs
  `renderedDurationSeconds` already give real, measured TechnicalQuality (resolution/fps/codec/
  bitrate/mismatch/duration-drift) with zero new computation.

Per the mission's own rule — don't add new detectors unless an audit proves a capability gap
orchestration can't close — and confirmed with the user via `AskUserQuestion`: **Phase C1 scopes to
an additive, observational `FinalClipQualityAssessment` built entirely from already-computed data**,
explicitly labeling proxy-based dimensions as proxies and CaptionQuality as an honest gap rather than
a fabricated signal. No gating, no auto-reject, no re-render. This mirrors the "data first" precedent
both Phase A's `EditorialDecision` and the separate Visual Emphasis Engine's own C1 phase already
established.

## 2. The honesty mechanism: `basis`

Every one of the 6 dimensions reports a `basis` alongside its score, so a consumer can never
mistake a weak proxy for a real measurement:

| `basis` | Meaning |
|---|---|
| `'measured'` | Composed directly from a real, already-computed value that measures what its name claims. |
| `'proxy'` | Composed from a real value that measures something ADJACENT, not the dimension itself. Weighted at half trust in the composite (see §4). |
| `'unavailable'` | No signal exists at all. `score` is `null`. Excluded from the composite entirely — never coerced to a fabricated middling score. |

## 3. The 6 dimensions, as shipped

| Dimension | Source | Basis |
|---|---|---|
| `editorialQuality` | `EditorialDecision.editorialScore` directly | `measured` (or `unavailable` when `EditorialDecision` was never computed) |
| `narrativeQuality` | Average of `categories.narrativeCompleteness`/`.contextCompleteness`/`.emotionalPayoff` | `measured` (or `unavailable`) |
| `technicalQuality` | `probeVideoMetadata()`'s stream-presence booleans + `RenderVerificationResult.passed` + `durationSeconds` vs `renderedDurationSeconds` drift | `measured` (or `unavailable` when the ffprobe probe itself failed entirely) |
| `visualQuality` | `categories.visualEngagement`, penalized when a `visualInstability` negative signal fired | `proxy` (or `unavailable`) — measures how much the editor acted on the clip, not picture quality |
| `audioQuality` | `categories.speakerClarity` | `proxy` (or `unavailable`) — measures turn-taking overlap, not perceptual audio quality; `null` for monologue clips |
| `captionQuality` | Nothing — no detector exists | Always `unavailable`, `score: null` |

## 4. Composition

`composeQualityAssessment()` (`packages/render-quality-judge/src/compose-quality-assessment.ts`):

- `compositeScore` — weighted average over every non-`unavailable` dimension. `measured` weight = 1,
  `proxy` weight = 0.5 (`packages/render-quality-judge/src/weights.ts`) — a proxy counts as real
  evidence, but at half the trust of a real measurement, never treated as equivalent.
- `confidence` — coverage, discounted the same way (sum of covered dimensions' weights / 6). A clip
  covered entirely by proxies reads as meaningfully LESS certain than one covered by real
  measurements, not merely "some coverage exists" either way.

Every numeric field is a documented HEURISTIC (ADR D4, `docs/coding-standards.md`'s "scale
honesty") — no production engagement data exists yet to validate whether this composite even
correlates with anything worth acting on (the same 0-usable-samples blocker every other phase in
this roadmap already documents).

## 5. Wiring

`assessClipQuality()` (`packages/render-quality-judge`) is computed in
`apps/worker/src/workers/render-clip.worker.ts`, right after `renderVerification` resolves
(`compareRenderManifestToProbe()`) and before the completion transaction — the first point where
`editorialDecision` (hoisted pre-render), `probeResult`, `renderVerification`, and both duration
values are all simultaneously in scope. No new upstream computation needed. Folded into the existing
`extra` object passed to `toClipUpdateData()`, same pattern as `editorialDecision`/`editPlan`.

**New additive `Clip.qualityAssessment` column** (`Json?`), always computed and persisted regardless
of `RENDER_QUALITY_JUDGE_ENABLED` (ADR D8: that flag gates future API exposure only, same posture as
`editorialDecision`). `assessClipQuality()` itself never returns `null` — `qualityAssessment` is
`null` only when a `Clip` row predates this phase's migration.

Same TS2742 pitfall hit a third time (`docs/coding-standards.md`'s own documented Prisma
declaration-emit pitfall) — fixed with the established pattern: destructure `qualityAssessment` out
of `VideosService.mapVideoWithClips`'s spread, narrow through a new `toSharedQualityAssessment()` in
`transcript-segment.util.ts`, mirror `FinalClipQualityAssessment`/`QualityDimensionScore`/etc. into
`packages/shared/src/types/video.ts` (not imported from `@speedora/contracts` — `packages/shared`
has zero cross-package dependencies). Verified against a real `nest build`, not just
`tsc --noEmit`, per that doc's own explicit warning.

## 6. Explicit non-goals for this phase (Phase C2 candidates, not started)

- **Auto-reject and re-render/fallback** — needs a `Clip` status/verdict column and a second render
  budget the current 45-minute job timeout doesn't have. Deliberately deferred pending real data on
  whether this phase's composite score even correlates with anything worth acting on.
- **Real VisualQuality detection** (sharpness/exposure/composition on actual rendered pixels),
  **real AudioQuality detection** (noise floor/clipping/loudness normalization), **real
  CaptionQuality detection** (readability/sync, blocked further on a transcript-to-audio alignment
  mechanism that doesn't exist anywhere in this codebase) — all genuinely new detector work,
  confirmed out of scope for this phase by the audit that opened this document, per the mission's
  own no-new-detectors-without-a-proven-gap rule applied selectively (the gap is proven, but
  building three new detectors against zero real calibration data is a separate, larger decision).
- **Gate C real-footage calibration** of `weights.ts`'s specific penalty/weight values — still
  blocked on real footage, same as every prior phase's own heuristic weights.

## 7. Test coverage

- `packages/render-quality-judge` — 25 unit tests across 8 spec files: each derive function's
  measured/proxy/unavailable transitions, `composeQualityAssessment`'s weighting math (measured-only,
  proxy-discounted, all-unavailable edge case, dimensions preserved on the result), and
  `assessClipQuality`'s full 6-dimension composition for both a fully-populated and a
  `EditorialDecision`-absent input.
- `apps/worker/src/workers/render-clip.worker.spec.ts` — a new "Render Quality Judge Phase C1"
  wiring block (4 tests) proving `qualityAssessment` is computed and persisted regardless of
  `RENDER_QUALITY_JUDGE_ENABLED`, degrades gracefully when `EditorialDecision` or the ffprobe probe
  is unavailable, and that `technicalQuality` stays measured even when `EditorialDecision` is null
  (the two are independent inputs). Plus the existing 5 full-object-equality tests updated for the
  new field (mechanical, non-behavioral).
- `apps/api/src/videos/videos.service.spec.ts` — the two full-object-equality tests needing the new
  `qualityAssessment: null` field, same mechanical update as Phase A/B.
