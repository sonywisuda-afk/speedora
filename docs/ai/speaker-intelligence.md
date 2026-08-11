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
Phase C, PR #109 Phase D, PR #110 Phase E)**: **Phase 0** hardened production Diarization
dependencies (a real `apps/worker` Docker image gap silently affecting Diarization, Vocal Emotion,
AND Facial Emotion, found and fixed with real HuggingFace-token end-to-end verification), added
structured `DiarizationError` failure categories, diarization metrics, and a
`DIARIZATION_DEPENDENCY_MISSING` alert. **Phase C** implemented Level 3's Conversation Type
Classification row below for real (new `@speedora/conversation-intelligence`,
`classifyConversationType()`/`deriveConversationDynamics()`, zero new detectors — reuses
`deriveDiarizationFeatures()` per-clip), wired into the render graph as
`Clip.conversationDynamics`/`Clip.conversationType`, exposed at `GET /clips/:id/intelligence` behind
`CONVERSATION_INTELLIGENCE_ENABLED`. **Phase D** (PR #109, stacked on Phase C, shipped separately -
originally opened as #106, recreated after GitHub auto-closed it when its base branch was deleted)
consumed Phase C's output as a new `conversationEngagement` dimension in the SEPARATE,
already-shipped Clip Ranking Engine (see `docs/ai/clip-ranking-engine.md`, Phase 14) - NOT the same
thing as this doc's own Level 3 "Speaker-Centric Clip Ranking" row below, which still refers to a
genuinely different, still-unbuilt feature (ranking *moments within* a clip via
`rankedSpeakerMomentSchema`, distinct from ranking *clips against each other*). See
`docs/ai/clip-ranking-engine.md`'s "Speaker Intelligence Phase D architecture" section for that
phase's own full design. **Phase E** (PR #110, same "recreated after auto-close" history as Phase
D) gave a genuine speaker CHANGE (from `ctx.speakerTurns`/Phase C's own
`deriveDiarizationFeatures()`/`deriveConversationDynamics()`, no new detector) a way to trigger the
SEPARATE, already-shipped Visual Emphasis Engine's Focus Shift mechanism (Phase C3, see
`docs/ai/visual-emphasis-engine.md`) - a new, independently-flagged trigger SOURCE for an existing
technique, not a new reframing system; the visual-track-based trigger
(`fromPrimarySubjectSamples()`) is completely untouched, and `@speedora/reframe`'s `buildCropPath()`
itself was not modified at all. Explicit false-positive control (hold-duration gate, an adaptive
confidence threshold that reuses Phase C's own `interactionIntensity` as the damper, and a cooldown)
was the phase's central design concern, per the user's own explicit warning that a podcast/interview
can switch speaker several times a second and must not trigger a reframe on every switch. See
`docs/ai/visual-emphasis-engine.md`'s "Speaker Intelligence Phase E" section for the full design.
Phase D and Phase E are independent siblings, both stacked directly on Phase C, not on each other.
Neither touched Fusion Engine v2's `weights.ts`, the other phase's own formula, caption logic, or
added an LLM call. Remaining Level 1/2/3 items below are still contracts-only except where
phase-noted (Conversation Type Classification, phase-noted above).

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
| Conversation Type Classification | `conversation-intelligence.ts` (monologue/interview/discussion/debate/presentation/podcast) — **shipped, Phase C** (`@speedora/conversation-intelligence`'s `classifyConversationType()`); `conversationEngagement` (derived from this classification + `deriveConversationDynamics()`) also feeds Clip Ranking Engine's Stage D composite as of Phase D, see `docs/ai/clip-ranking-engine.md` |
| Adaptive Highlight Scoring / "Fusion Signal" | `speaker-scoring.ts` — `speakerFusionFeaturesSchema`, the shape a future `speaker` `FUSION_SIGNALS` entry would consume (mirrors how `editingRhythm`'s composite features are consumed today) — **deliberately NOT wired into `fusion.ts`/`weights.ts` yet**, see below |
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

### Why "Adaptive Highlight Scoring" wasn't wired into the Fusion Engine

`editingRhythm`/`ocr`/`gesture`/`faceGeometry` were wired into `fusion.ts`'s `FUSION_SIGNALS` at
weight 0 *because their detectors already existed* — wiring made real (if uncalibrated) data
visible in `contributions`. Nothing in this Speaker Intelligence pass has an implementation yet,
so adding a `speaker` signal to `FUSION_SIGNALS` now would be inert scaffolding with zero real
inputs, not "collect now, calibrate later" the way the existing weight-0 signals are.
Wire `speakerFusionFeaturesSchema` in once Level 1 detectors (VAD, Active Speaker Detection,
Speaker-Face Association) actually exist and produce real per-clip data.

### Multi Speaker Tracking (current/previous/next, conversation flow, turn-taking)

Deliberately **not** a separate schema. `speakerTimelineEntrySchema`'s ordered `entries` array and
`speakerTransitionSchema`'s `transitions` list already answer "who's speaking right now / before /
next" for any queried timestamp — adding dedicated current/previous/next fields would just
duplicate what a lookup against those two arrays already gives a caller.

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
