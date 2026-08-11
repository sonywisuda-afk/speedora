# Speaker Intelligence Roadmap

Everything about *who is speaking, how, and how important they are* — the layer this codebase
was missing to get materially closer to an Opus Clip-style speaker-aware pipeline. Organized in
three levels, per explicit user direction: **Level 1 (mandatory)** — the foundational detectors
almost everything else depends on; **Level 2 (quality)** — mostly already covered by the existing
Face/Audio/Gesture Intelligence work, described here in the roadmap's own vocabulary; **Level 3
(product differentiation)** — per-speaker scoring built on top of Level 1/2, expected to extend
(not replace) the existing Fusion Engine (`ai/fusion.md`).

**Status as of this doc's creation**: every Level 1/3 item and most Level 2 gaps got a **Zod
contract** in this pass (`packages/contracts/src/*`) — schemas only, following this codebase's
"contracts-first" precedent (`ocr` was a reserved `weights.ts` key before any module produced it;
see `ai/fusion.md`). **No new detector/subprocess/worker wiring was built** — that's real
engineering work (Python scripts, DB migrations, Fusion Engine wiring, real-binary verification)
deliberately left for a follow-up, scoped separately per item below. Two already-shipped but
previously uncontracted modules (Speaker Diarization, Vocal Emotion) were formalized into real
Zod schemas and wired to validate their subprocess output with `.parse()`, closing a gap where
they were the only two Python-subprocess-backed modules in this codebase using an unchecked `as`
cast instead of the established JSON-contract pattern.

**Update (2026-08-11) — a later, phased follow-up initiative shipped real engineering on top of
this doc's own "schemas only" status, per an explicit audit-first brief (PR #104 Phase 0, PR #105
Phase C, PR #106 Phase D, PR #107 Phase E, PR TBD Phase F)**: **Phase 0** hardened production Diarization
dependencies (a real `apps/worker` Docker image gap silently affecting Diarization, Vocal Emotion,
AND Facial Emotion, found and fixed with real HuggingFace-token end-to-end verification), added
structured `DiarizationError` failure categories, diarization metrics, and a
`DIARIZATION_DEPENDENCY_MISSING` alert. **Phase C** implemented Level 3's Conversation Type
Classification row below for real (new `@speedora/conversation-intelligence`,
`classifyConversationType()`/`deriveConversationDynamics()`, zero new detectors — reuses
`deriveDiarizationFeatures()` per-clip), wired into the render graph as
`Clip.conversationDynamics`/`Clip.conversationType`, exposed at `GET /clips/:id/intelligence` behind
`CONVERSATION_INTELLIGENCE_ENABLED`. **Phase D** (PR #106, stacked on Phase C, shipped separately)
consumed Phase C's output as a new `conversationEngagement` dimension in the SEPARATE,
already-shipped Clip Ranking Engine (see `docs/ai/clip-ranking-engine.md`, Phase 14) - NOT the same
thing as this doc's own Level 3 "Speaker-Centric Clip Ranking" row below, which still refers to a
genuinely different, still-unbuilt feature (ranking *moments within* a clip via
`rankedSpeakerMomentSchema`, distinct from ranking *clips against each other*). See
`docs/ai/clip-ranking-engine.md`'s "Speaker Intelligence Phase D architecture" section for that
phase's own full design. **Phase E** ("speaker_focus_shift", this PR) gave a genuine speaker CHANGE
(from `ctx.speakerTurns`/Phase C's own `deriveDiarizationFeatures()`/`deriveConversationDynamics()`,
no new detector) a way to trigger the SEPARATE, already-shipped Visual Emphasis Engine's Focus Shift
mechanism (Phase C3, see `docs/ai/visual-emphasis-engine.md`) - a new, independently-flagged trigger
SOURCE for an existing technique, not a new reframing system; the visual-track-based trigger
(`fromPrimarySubjectSamples()`) is completely untouched, and `@speedora/reframe`'s `buildCropPath()`
itself was not modified at all. Explicit false-positive control (hold-duration gate, an adaptive
confidence threshold that reuses Phase C's own `interactionIntensity` as the damper, and a cooldown)
was the phase's central design concern, per the user's own explicit warning that a podcast/interview
can switch speaker several times a second and must not trigger a reframe on every switch. See
`docs/ai/visual-emphasis-engine.md`'s "Speaker Intelligence Phase E" section for the full design.
Phase D and Phase E are independent siblings, both stacked directly on Phase C, not on each other.
**Phase F** ("Cross-module Fusion") consolidates Phase C's Conversation Dynamics, the EXISTING
`@speedora/speaker-scoring` Level 3 scoring (already wired into Fusion Engine v2's own `speaker`
FUSION_SIGNALS key, confirmed genuinely orthogonal to Phase C by reading every one of its derive
functions), and Phase E's `speaker_focus_shift` suggestions into one structured, 3-branch
`FinalSpeakerIntelligence` read-model (`@speedora/speaker-fusion`) - deliberately NOT a single
composite score (no naive "sum everything" fusion) and deliberately NOT a Fusion Engine v2
extension (`weights.ts` untouched - a genuinely separate, standalone composite, per an explicit
user decision after a real architectural fork was surfaced: Fusion Engine v2's `speakerFusionFeaturesSchema`
comment already documents it once dropped a `conversationType` field specifically because no
deriving function existed - Phase C now provides one, but re-adding it is an explicit, separately-
scoped FOLLOW-UP, not done as a side effect of this phase). The double-counting risk the user
named as the central concern (a single speaker-transition event scored 3x independently) is closed
structurally: `visual.speakerFocusShift` is diagnostic-only, never combined with `conversation`'s
own `interactionIntensity`-derived fields, since Phase E's suggestions are themselves a filtered
subset of Phase C's own dynamics (`fromSpeakerTransitions()` calls `deriveConversationDynamics()`
internally). Depends on BOTH Phase C (`conversationIntelligence` render-graph node) and Phase E (the
`speaker_focus_shift` `EDITING_TECHNIQUES` value), so it's stacked on Phase E's own branch, not a
third sibling of Phase C. See `docs/ai/speaker-intelligence.md`'s own "Phase F architecture" section
below for the full design, including the 7 adversarial scenarios verified. Neither Phase D, E, nor
F touched Fusion Engine v2's `weights.ts`, another phase's own formula, caption logic, or added an
LLM call. Remaining Level 1/2/3 items below are still contracts-only except where phase-noted
(Conversation Type Classification, phase-noted above).

**Concrete, scoped follow-up (not done in this phase, per explicit user direction to keep it an
explicit decision rather than a side effect)**: extend `@speedora/contracts`' own
`speakerFusionFeaturesSchema` (in `speaker-scoring.ts`) with a `conversationType`-derived field,
re-adding what that schema's own comment says was deliberately dropped before ("no deriving
function ever implemented" - Phase C now provides one), and update
`@speedora/speaker-scoring`'s `deriveSpeakerFusionFeatures()` to populate it from the same
`ConversationDynamics`/`ConversationTypeResult` Phase F already consumes. Weight stays 0 (no
`highlightScore` behavior change) - the only real design question this follow-up would need to
resolve is whether the new field should be `conversationType: ConversationType | null` alone or
also carry a normalized `interactionIntensity`, and whether merging Phase C's signal into the SAME
`speaker` FUSION_SIGNALS bucket (vs. reserving a new, separate key) is the right call given
`speaker` and `conversation` are the genuinely orthogonal families Phase F's own design confirmed.

## Level 1 — Mandatory

| Item | Status | Where | Contract added |
|---|---|---|---|
| **Voice Activity Detection (VAD)** | Missing | — | `voice-activity.ts` (new) |
| **Speaker Diarization** | Done (turns) / partial (aggregates) | `apps/worker/src/diarization.ts` (pyannote), `docs/ai/audio.md` | `speaker-diarization.ts` — formalized the existing `SpeakerTurn` shape + added count/segments/duration/turn/switch/overlap/silence/metadata schemas that don't exist anywhere yet |
| **Face Detection & Tracking** | Done | `packages/reframe` (detection), `packages/facial-intelligence` Batch 4 (Kalman+Hungarian tracking, `trackId`) | — |
| **Active Speaker Detection** | Partial | `reframe`'s "largest bounding box" heuristic + `faceLandmarkFeaturesSchema.speakerAudioSyncRate` (a clip-wide proxy) | `active-speaker.ts` (new) — a real per-instant, potentially multi-face decision |
| **Face–Voice Association** | Missing (as an explicit link) | `speakerAudioSyncRate` correlates mouth movement with audio in aggregate, but never names *which diarization speaker* a face track belongs to | `active-speaker.ts` — `speakerFaceAssociationSchema` |
| **Lip Sync Verification** | Partial (proxy only) | same `speakerAudioSyncRate` | `active-speaker.ts` — `lipSyncVerificationSchema` (per-track, adds delay/offset) |
| **Speaker Timeline** | Partial | `TranscriptSegment.speaker` (per-Whisper-segment label only, no face fusion) | `speaker-timeline.ts` (new) — fuses diarization + active-speaker into one structure |

## Level 2 — Quality

Mostly already shipped under Face/Audio/Gesture Intelligence; the gaps are formalized here.

| Item | Status | Where |
|---|---|---|
| Speaking Rate | Done | `audio-intelligence.ts` (`averageSpeakingRateWordsPerSecond`) |
| Pause Analysis | Partial | `faceLandmarkFeaturesSchema.pauseCount` (mouth-based proxy only); audio-based pause (from real silence, not mouth movement) added in `speaking-style.ts` |
| Voice Energy | Done | `audio-intelligence.ts` (`averageRmsDb`/`peakDb`) |
| Emotion Recognition | Done, two systems with a real design tension | Facial: `dominantAffect` (deliberately *safe*, non-diagnostic labels). Vocal: `apps/worker/src/vocalEmotion.ts`, discrete `happy/angry/sad/neutral` — **see "Emotion While Speaking" below** |
| Eye Contact | Done | `faceLandmarkFeaturesSchema.eyeContactRate` |
| Head Pose | Done | `faceLandmarkFeaturesSchema` (`averageAbsoluteYaw/Pitch`, raw `rotation`) |
| Gesture Analysis | Done | `packages/gesture-intelligence` |
| Speaker Transition Detection | Partial | `faceLandmarkFeaturesSchema.speakerChangeCount` (visual track changes only); a diarization+visual combined version added in `speaker-timeline.ts` |
| Speaker Quality Score / Visibility | Missing (as a named rollup) | Built entirely from existing `sharpness`/`brightness`/`occlusionRate`/`sizeScore`/`eyeContactRate` | `speaker-quality.ts` (new) |
| Speaking Style Analysis | Partial | Speaking rate/energy done; pitch variation **not implemented anywhere** (`ai/audio.md`'s "Pitch/F0 — not implemented", needs Librosa) | `speaking-style.ts` (new; `pitchVariation` reserved, always null) |

## Level 3 — Product Differentiation

None of these exist yet. All are deterministic composites over Level 1/2 features (same
"heuristic, not a trained model, unvalidated until calibrated" honesty as the Fusion Engine
itself — see `ai/fusion.md`'s `editingRhythm` weight-calibration precedent). Contracts only.

| Item | Contract added |
|---|---|
| Speaker Confidence | `speaker-scoring.ts` — `speakerConfidenceScoreSchema` |
| Speaker Importance Scoring | `speaker-scoring.ts` — `speakerImportanceScoreSchema` (role is an **explicit input**, not inferred — no detector can tell host/guest/audience apart) |
| Speaker Engagement Scoring | `speaker-scoring.ts` — `speakerEngagementScoreSchema` |
| Speaker Attention | `speaker-scoring.ts` — `speakerAttentionScoreSchema` |
| Speaker Highlight Score | `speaker-scoring.ts` — `speakerHighlightMomentSchema` (per-speaker-moment analog of `fusion.ts`'s clip-level `highlightScore`) |
| Speaker-Centric Clip Ranking | `speaker-scoring.ts` — `rankedSpeakerMomentSchema` (ranks *moments*, distinct from `fusion.ts`'s `rankedClipSchema`, which ranks rendered clips) |
| Conversation Type Classification | `conversation-intelligence.ts` (monologue/interview/discussion/debate/presentation/podcast) |
| Adaptive Highlight Scoring / "Fusion Signal" | `speaker-scoring.ts` — `speakerFusionFeaturesSchema` — **status correction (2026-08-11, found during the Phase F audit): this doc's own "deliberately NOT wired in yet" claim below is stale.** `speaker` IS a real `FUSION_SIGNALS` key in `weights.ts` today (weight 0, same "collect first, calibrate later" treatment as `gesture`/`faceGeometry`), fed by `@speedora/speaker-scoring`'s `deriveSpeakerFusionFeatures()` with real per-clip data - this must have been wired in by a later pass than this doc tracked. See Phase F's own architecture section below for what it does NOT do with this fact (deliberately doesn't extend it further in this phase) |
| Multi-camera Speaker Fusion | **No contract added** — this product has no multi-camera ingestion anywhere in its architecture (`apps/worker` processes one source video per `Video` row). Inventing a schema for an input shape the pipeline can't produce would be pure speculation. Out of scope until multi-camera ingestion exists at the product level. |

## Design notes / open decisions

### "Emotion While Speaking" — a real tension, not resolved here

Facial Intelligence's `dominantAffect` deliberately avoids discrete emotion labels
(`positive_affect`/`high_energy`/... never "happy"/"sad"/"angry") per explicit prior user
instruction ("jangan langsung mengklaim 'sedih' atau 'marah'" — see `facial-intelligence.ts`'s
`AFFECT_LABELS` comment). Vocal Emotion Detection (`vocal-emotion.ts`, formalized in this pass)
already ships the opposite choice — a public model's raw 4-class discrete taxonomy
(`neutral`/`happy`/`angry`/`sad`). That choice predates this roadmap and was left as-is (only
formalized into a contract, not redesigned) — but the two modules now visibly disagree on how
confidently to name an emotion. Reconciling this (e.g. by also softening vocal emotion's output,
or by explicitly documenting why voice tone gets a different bar than facial expression) is an
open decision, not something this pass resolved unilaterally.

### Why "Adaptive Highlight Scoring" wasn't wired into the Fusion Engine (historical - now stale, see above)

`editingRhythm`/`ocr`/`gesture`/`faceGeometry` were wired into `fusion.ts`'s `FUSION_SIGNALS` at
weight 0 *because their detectors already existed* — wiring made real (if uncalibrated) data
visible in `contributions`. Nothing in this Speaker Intelligence pass has an implementation yet,
so adding a `speaker` signal to `FUSION_SIGNALS` now would be inert scaffolding with zero real
inputs, not "collect now, calibrate later" the way the existing weight-0 signals are.
Wire `speakerFusionFeaturesSchema` in once Level 1 detectors (VAD, Active Speaker Detection,
Speaker-Face Association) actually exist and produce real per-clip data.

**This has since happened** (found during the Phase F audit, 2026-08-11, not tracked by a doc
update at the time it shipped): Level 1 detectors now exist
(`@speedora/active-speaker-intelligence`), and `speaker` is a real, populated `FUSION_SIGNALS` key
in `weights.ts` today, same weight-0 "collect first, calibrate later" status as `gesture`/
`faceGeometry`. This section is kept for historical context, not as current status - see the table
row above and Phase F's own architecture section for what's current.

### Multi Speaker Tracking (current/previous/next, conversation flow, turn-taking)

Deliberately **not** a separate schema. `speakerTimelineEntrySchema`'s ordered `entries` array and
`speakerTransitionSchema`'s `transitions` list already answer "who's speaking right now / before /
next" for any queried timestamp — adding dedicated current/previous/next fields would just
duplicate what a lookup against those two arrays already gives a caller.

## Phase F architecture (as shipped) — "Cross-module Fusion"

The user's own target diagram: Diarization branches into 3 signal families (Conversation Dynamics
[Phase C], Speaker signals [existing `@speedora/speaker-scoring`], Speaker-aware visual signals
[Phase E]) → Phase F Fusion → final intelligence. Five explicit principles governed the design,
each closed structurally, not just by convention:

1. **Don't touch upstream signals.** Phase F consumes Phase C/E's already-computed outputs
   directly - `deriveConversationDynamics()`, `deriveSpeakerFusionFeatures()`, and
   `fromSpeakerTransitions()` are all called ZERO times by this phase; it only reads their prior
   results.
2. **Don't silently change Fusion Engine v2.** `packages/fusion-engine/src/weights.ts` is
   byte-for-byte unchanged. A real architectural fork here (Fusion Engine v2 already has a
   `speaker` FUSION_SIGNALS key, and its own feature schema comment documents dropping a
   `conversationType` field before specifically because no deriver existed - Phase C now provides
   one) was surfaced via `AskUserQuestion` rather than resolved unilaterally; the user chose
   "standalone composite now, extend Fusion Engine v2 as an explicit follow-up later" - see the
   concrete, scoped follow-up noted above.
3. **Avoid double-counting.** The user's own example chain (speaker transition → conversation
   dynamics → visual focus shift → fusion) is real: `@speedora/visual-emphasis`'s
   `fromSpeakerTransitions()` (Phase E) calls Phase C's `deriveDiarizationFeatures()`/
   `deriveConversationDynamics()` internally, so its `speaker_focus_shift` suggestions are a
   FILTERED SUBSET of `conversation`'s own signal, not independent evidence. Closed structurally,
   not by filtering: `composeFinalSpeakerIntelligence()` computes `conversation` and `speaker`
   with zero reference to `speakerFocusShiftScores` at all - `visual` is a separate branch,
   explicitly documented as diagnostic-only, never summed with anything. A dedicated unit test
   (`structural independence (no double-counting by construction)`) proves `conversation`/`speaker`
   stay byte-identical regardless of how many visual suggestions are present.
4. **Confidence stays composable.** Every branch preserves its own source's null-semantics
   independently: `conversation`/`speaker` are `null` at the OBJECT level only when their upstream
   input was entirely unavailable (pre-migration row, or no `speakerTimeline` data), while
   individual fields within a present object stay `null` per their own established meaning (e.g.
   `backAndForthScore: null` for fewer than 2 turns) - never collapsed into a fabricated 0 or a
   single flattened confidence number.
5. **Test adversarial scenarios, prove no overreaction.** All 7 scenarios from the brief are
   covered in `packages/speaker-fusion`'s own test suite: single-speaker monologue (conversation
   honest, visual stays 0, speaker not penalized), rapid back-and-forth (conversation honestly
   reports high activity while visual correctly stays 0 - Phase E's own gates already rejected
   every transition), long interview answer (low density, one real accepted response), two
   speakers + strong visual event (a high-confidence visual signal does NOT inflate
   conversation/speaker), speaker transition + silence (a long `responseLatency` is reported
   honestly, not zeroed), and speaker transition + face change / existing focus_shift (both
   verified at the `render-clip.worker.spec.ts` integration level - a mixed `editingSuggestions`
   array containing both a plain `focus_shift` AND a `speaker_focus_shift` suggestion results in
   `visual.speakerFocusShift.count` reflecting ONLY the speaker-sourced one, proving the
   render-graph node's own filtering keeps the two technique sources from ever conflating).

**What was deliberately NOT chased**: per the user's own explicit instruction ("Jangan mengejar
'lebih banyak signal'"), Phase F adds no new detector, no new derived metric, and no new scoring
formula - it is purely a reshape/consolidation of 3 already-computed signal families. The one
new judgment call is `visual`'s diagnostic-only status (a design decision, not a missing feature).

**`packages/contracts/src/speaker-fusion.ts`** (new) - `finalSpeakerIntelligenceSchema` (3 branches:
`conversation`/`speaker`/`visual`) and `composeFinalSpeakerIntelligenceInputSchema` (narrow,
already-computed inputs only, per `ARCHITECTURE.md`'s checklist).

**`packages/speaker-fusion`** (new package) - `composeFinalSpeakerIntelligence()`, a pure,
synchronous reshape function, plus `isSpeakerFusionEnabled()` (`SPEAKER_FUSION_ENABLED`, gates
`GET /clips/:id/intelligence` exposure only, same "computation always runs" convention as every
other v4 pure-derive node).

**`apps/worker/src/render-graph/nodes/speaker-fusion.ts`** (new node) - `finalSpeakerIntelligenceNode`,
`deps: ['conversationIntelligence', 'speakerFusionFeatures', 'editingSuggestions']`,
`optional: false`. Filters `editingSuggestions` to `technique === 'speaker_focus_shift'` right at
this orchestration seam - the concrete mechanism behind scenario 6/7 above. `Clip.finalSpeakerIntelligence`
(new `Json?` column, migration `20260811170000`) - same null-semantics as `conversationDynamics`:
null can ONLY mean a pre-migration row.

**API exposure**: `ClipIntelligenceDto.finalSpeakerIntelligence`, `ClipsService.getIntelligence()`,
and the shared `Clip` DTO (`toDto()`, `VideosService`'s clip mapping) all follow the exact same
exposure-flag/null-semantics pattern as `conversationDynamics`/`conversationType`.

**Verification**: `packages/speaker-fusion` 1/1 (18/18 - null-semantics, structural independence,
all 7 adversarial scenarios, determinism, non-mutation, schema conformance).
`packages/contracts` 23/23 (183/183). `packages/shared` 11/11 (84/84). `apps/worker` 57/57
(757/757, +1 new integration test proving the technique filtering at the render-graph seam).
`apps/api` 84/84 (1296/1296, +6 new: 3 `getIntelligence` flag/null tests + 3
`toSharedFinalSpeakerIntelligence` mapper tests). `typecheck`/`lint`/`format` all green across
every touched package.

## What's next (not done in this pass)

This pass is schemas only. Turning any Level 1 item into a real signal needs, per item, the same
work every existing module here already went through (`ARCHITECTURE.md`'s module checklist):

1. A detector (VAD: a standard energy/model-based approach over the existing full-track audio
   extraction; Active Speaker Detection / Face-Voice Association / Lip Sync: pure TypeScript
   aggregation over already-collected face-landmark + audio + diarization data, no new subprocess).
2. A `deriveXFeatures()` pure function producing the `*Features` shape already defined here.
3. Adapter wiring in `apps/worker/src/workers/render-clip.worker.ts` (or `transcribe.worker.ts` for
   the video-wide ones), a `Clip`/`Video` column, and "never fails the job" error handling matching
   every sibling detector.
4. Real-binary verification (this codebase's existing detectors have never been run against real
   ffmpeg/Python/model binaries in this sandbox — see `testing.md`'s known gap; any new detector
   inherits the same obligation before being trusted in production).
5. Fusion Engine wiring at weight 0, then the same calibration path `editingRhythm` is on today
   (see `ai/fusion.md` and `apps/worker/src/scripts/check-calibration-coverage.ts`).
