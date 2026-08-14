# Clip Count & Duration Precision Engine — Phase 9 Audit

Status: **audit complete, no implementation, no schema change, no ranking/clip-generation logic
change.** This is the required Phase 0-equivalent deliverable for Phase 9 (per the Render Fidelity
& Composition Execution Engine's own original Recommendation section, `render-fidelity-matrix.md`)
— a full lifecycle audit of `Clip.durationSeconds`, its writers, its consumers, and the design
questions that must be answered before any implementation phase is approved. Scoped to
**duration** precision specifically, per the user's own detailed question list — clip **count**
precision (the original audit's bug #4, `selectShortlist()`'s hardcoded `targetSize`) is a
separate, largely-already-addressed concern (see `clip-ranking-engine.md`'s Phase 13.1/13.2) and
is explicitly out of this audit's scope; it is not re-audited here.

Every claim below is a direct citation of real, current code (file:line), not inference from a
doc or memory — several of this initiative's own earlier docs turned out to be stale when
re-checked against the live source, so nothing here is taken on faith.

## 1. Full lifecycle: every writer of `Clip.durationSeconds`

| # | Site | Value written | When |
|---|---|---|---|
| 1 | `apps/worker/src/workers/clip-persistence.ts:150`, `createCandidateClips()` | `candidate.endTime - candidate.startTime` | At initial candidate creation, both the original `detect-clips.worker.ts` flow and the "Generate More Clips" top-up flow (both call this shared helper — see its own module comment, "Extracted from detect-clips.worker.ts ... so generate-more-clips.worker.ts can reuse the exact same clip-creation ... logic") |
| 2 | `apps/api/src/clips/clips.service.ts:788`, `ClipsService.update()` | `endTime - startTime` (the input DTO's possibly-edited values) | On a manual trim from the Timeline Editor (`PATCH /clips/:id`) — **deliberately does not touch `outputUrl` or enqueue a render** (that file's own comment, line 759-763) |
| 3 | `apps/worker/src/scripts/backfill-clip-duration.ts:28` | `clip.endTime - clip.startTime` | One-off, idempotent backfill script (only touches rows where `durationSeconds IS NULL`) — not a live pipeline write site |

**No other write site exists.** In particular: `apps/worker/src/workers/render-clip.worker.ts`
— the ONLY place in this codebase that knows the clip's real, post-render, ffprobe-measurable
duration — **never writes `durationSeconds`** (confirmed by a direct grep of the whole file: the
only two `durationSeconds` occurrences there are unrelated thumbnail-config object literals,
`ANIMATED_THUMBNAIL_CONFIG`/`HOVER_PREVIEW_CONFIG`). `verifyRenderedDuration()` (Render Fidelity
Matrix bug fix #5) computes `actualDurationSeconds` via `getMediaDurationSeconds(finalOutputPath)`
— a real, ffprobe-measured value — but only to log a warn/info comparison; the value itself is
discarded immediately after, never returned, never persisted. Phase 8's own `probeVideoMetadata()`
call (ffprobe verification) ALSO computes a real `durationSeconds` as part of its
`ProbedVideoMetadata` return — also discarded, since Phase 8 explicitly excluded duration from its
own comparison scope.

**This is the exact gap Phase 9 exists to close**: a real, measured value is computed (twice,
independently) on every successful render and thrown away both times.

## 2. Full lifecycle: every consumer of `Clip.durationSeconds`

| Site | Purpose |
|---|---|
| `apps/api/src/clips/clips.service.ts:346-353`, `findAll()`/library listing | Query filter — `minDuration`/`maxDuration` (`gte`/`lte`) against this column, for the Clip Library's own duration-range filter UI |
| `apps/api/src/clips/clips.service.ts:1305`, `toDto()` | Direct pass-through into the API response every clip-list/clip-detail endpoint returns — this is what `apps/web` actually displays as a clip's "duration" |
| `packages/database/prisma/schema.prisma:1354-1356` | `@@index([durationSeconds])` — a real DB index exists for the filter query above, confirming this is treated as a genuine query column, not incidental metadata |

No `apps/worker` code reads `Clip.durationSeconds` (grepped; the 23 files matching
`durationSeconds` in `apps/worker/src` are exclusively either `Video.durationSeconds` — a
different, video-level field probed at import time, e.g. `build-video-report-input.ts:112` — or
unrelated config object literals like the thumbnail configs above). Export report generation
(`export-generate/*`) reads `Video.durationSeconds`, not `Clip.durationSeconds`.

**`Video.durationSeconds` and `Clip.durationSeconds` are two unrelated fields on two different
models** — worth stating explicitly since their names collide; this audit is exclusively about the
latter.

## 3. The 10 questions, answered

**Q1. Who first populates `Clip.durationSeconds`?**
`clip-persistence.ts`'s `createCandidateClips()`, at the same `prisma.clip.create()` call that
sets `startTime`/`endTime` — both the initial detect-clips flow and the Generate More Clips flow
funnel through this one shared function (§1, row 1).

**Q2. Is the value requested, candidate, or actual media duration?**
**Candidate/requested duration** — `candidate.endTime - candidate.startTime`, the LLM-selected
clip window, computed before any rendering has happened. It has never meant "actual media
duration" at any point in this codebase's history.

**Q3. Who reads it?**
The Clip Library's duration-range filter and every API response's `durationSeconds` field (§2) —
in practice, whatever a user sees labeled "duration" anywhere in the product today is this
requested/candidate value, not a measurement of the delivered file.

**Q4. When is the value allowed to change?**
Today: only via a manual trim (`ClipsService.update()`, write site #2) — and that call explicitly,
by design, does not care whether the clip has already been rendered.

**Q5. What happens if render is reprocessed?**
Two genuinely different cases, both directly confirmed in code:
- **A stale/duplicate job re-running the same already-successful render** (BullMQ stalled-job
  recovery — `render-clip.worker.ts`'s own comment at line 1411-1413 confirms this is "observed
  for real"): short-circuited immediately by the idempotency check `if (existingClip.outputUrl) {
  ... return early }` (line 1414-1417) — no re-render, no re-verification, `durationSeconds`
  untouched.
- **An explicit user-triggered re-render** (`ClipsService.render()`, `clips.service.ts:864-888`):
  snapshots the pre-render state into a new `ClipVersion` row, THEN explicitly clears
  `outputUrl: null` in the same transaction, before enqueueing a fresh `RENDER_CLIP` job. This
  deliberately re-opens the exact same optimistic-concurrency window write site #1 in
  `render-clip.worker.ts` already depends on (see Q9/Q10) — a genuine re-render is designed to
  look, to the worker, identical to a first-time render.

**Q6. How do reaction hold, cut removal, intro/outro, and crossfade affect the final value?**
Fully computed today (Phases 3-8), but **never fed back into `Clip.durationSeconds`**:
`RenderPlan.timeline.effectiveDurationSeconds` (Phase 3) already accounts for cuts removed +
reaction-hold time added (not intro/outro, which happen after `RenderPlan` is built). The REAL
final number — after every pass including intro/outro — is what `verifyRenderedDuration()` and
Phase 8's `probeVideoMetadata()` both independently measure and both discard (§1). No
crossfade-specific duration delta exists as its own tracked value — crossfade shrinks the total by
a small, per-junction amount already baked into whichever of the above measurements runs last.

**Q7. Should `Clip.durationSeconds` become the actual delivered duration after a successful
render?**
**Not unconditionally — this is the central design tension this audit surfaces, not resolves.**
`ClipsService.update()`'s own comment (§1, row 2) documents a deliberate, existing product
decision: a manual trim on an ALREADY-rendered clip updates `durationSeconds` to the NEW requested
window while `outputUrl` keeps serving the OLD file, until the user explicitly re-renders. If
Phase 9 makes `durationSeconds` always mean "the delivered file's real duration," that manual-trim
write site would need to stop writing `durationSeconds` at all (or the field's meaning becomes
ambiguous depending on whether a render happened more recently than the last edit — a real bug
class waiting to happen). Two honest options, not decided here:
  - **(a)** Keep `durationSeconds` as "current best-known duration for whatever `outputUrl` is
    serving" — the manual-trim write site stops touching it; only a real render (success only)
    ever updates it, keeping its meaning stable at the cost of `ClipsService.update()`'s own
    write site losing a responsibility it has always had.
  - **(b)** Introduce a distinct field (e.g. `deliveredDurationSeconds`), leaving today's
    `durationSeconds` exactly as-is ("requested/candidate window," unchanged meaning, zero
    existing-consumer risk) and adding the real, post-render value alongside it. Larger surface
    (schema addition, a second field for every future consumer to reason about) but zero
    ambiguity and zero behavior change to the two existing consumers (§2).

**Q8. How should a verification mismatch be handled?**
Phase 8's `RenderVerificationResult` already deliberately excludes duration from its own
comparison (`render-verification.ts`'s own module comment: *"duration isn't part of OutputProfile's
shape... already covered by the existing, separate verifyRenderedDuration()"*). Reconciling
`Clip.durationSeconds` doesn't need a pass/fail verdict the way Phase 8's codec/dimension checks
do — there is no "expected" duration with a fixed, pre-computable value the way `OutputProfile`
declares width/height/fps ahead of execution; the real duration is only ever known after the fact,
from `verifyRenderedDuration()`'s own already-existing `actualDurationSeconds`/`getMediaDurationSeconds()`
value (or Phase 8's own already-computed `probe.durationSeconds` — the SAME value, computed at a
nearly-identical point in the pipeline, currently computed twice and discarded twice). A genuine
open question for the design phase: should reconciliation reuse Phase 8's already-fetched probe
result (zero new ffprobe calls) rather than re-invoking `verifyRenderedDuration()`'s own separate
probe — they run at different points in `render-clip.worker.ts` today and would need to be
consolidated or explicitly justified as staying separate.

**Q9. Should the update be atomic with `Clip.status` changes?**
**Yes — and the exact mechanism to reuse already exists and is already proven.**
`render-clip.worker.ts:2517-2562`'s existing completion transaction already does precisely this
for `outputUrl`/`outputWidth`/`outputHeight`/`outputAspectRatio` (real, post-render, measured
values — the identical shape a real `durationSeconds` value would have): one `prisma.$transaction`
containing `tx.clip.update({ where: { id: clipId, outputUrl: null }, data: toClipUpdateData(...) })`
followed by the conditional `Video.status -> RENDERED` flip when every sibling clip is done. Adding
a real `durationSeconds` value to that SAME `toClipUpdateData()` call site would inherit this
atomicity for free — no new transaction, no new write site, no new race surface.

**Q10. Can retry worker cause a race or stale duration?**
**No — the existing `outputUrl: null` optimistic-concurrency claim (§1's row-1 write-site comment,
`render-clip.worker.ts:2497-2502`) already solves this class of problem generally, not just for
`outputUrl`.** That `where` clause is explicitly documented as a claim, not a filter: only the
first of two racing/retried executions to reach the transaction can ever match a row; the loser's
update matches zero rows (Prisma `P2025`), caught as benign (`render-clip.worker.ts:2568-2578`). A
`durationSeconds` write folded into the SAME `tx.clip.update()` call is protected by the identical
claim, with no additional design needed. The only way an already-rendered clip's completion
transaction runs again is the explicit, user-triggered `ClipsService.render()` re-render path
(Q5), which deliberately clears `outputUrl` first specifically so this exact claim mechanism
treats it as a legitimate first-time completion — by design, not by accident.

## 4. Existing infrastructure Phase 9 can reuse outright (no new mechanism needed)

- The optimistic-concurrency `outputUrl: null` claim (Q9/Q10) — reuse, don't reinvent.
- `toClipUpdateData()`'s existing "write real post-render measured facts" pattern, already proven
  for `outputWidth`/`outputHeight`/`outputAspectRatio` — a real `durationSeconds` value is a
  fourth field of the exact same character, not a new category of write.
- A real, already-computed duration value exists at TWO points in the current pipeline
  (`verifyRenderedDuration()`'s `actualDurationSeconds`, Phase 8's `probe.durationSeconds`) — no
  new ffprobe call is needed; the design phase's job is choosing which one to keep (or unifying
  them) rather than adding a third.
- The `ClipVersion` history table (`clips.service.ts:864-888`) already snapshots pre-render
  `startTime`/`endTime`/`outputUrl`/etc. on every re-render — whether a delivered-duration history
  belongs there too is worth asking in the design phase, not decided here.

## 5. Explicit non-goals of this audit (per your instruction)

- No schema/migration change.
- No change to ranking, candidate generation, or clip-count/shortlist logic (bug #4 territory —
  separate, already-addressed elsewhere).
- No change to `ClipsService.update()`'s manual-trim behavior, `render-clip.worker.ts`'s
  completion transaction, or any production code at all.
- No decision made on Q7's (a) vs. (b) fork, or on Q8's "reuse Phase 8's probe vs. keep
  `verifyRenderedDuration()` separate" question — both are surfaced for your decision, not
  resolved here.

## 6. What a Phase 9 design turn would need to decide before implementation

1. Q7's fork: overload existing `durationSeconds` (reinterpreting its meaning, touching the
   manual-trim write site) vs. add a new, distinct field.
2. Q8's fork: consolidate around one real duration measurement (Phase 8's probe, already computed
   at that point in the pipeline) vs. keep `verifyRenderedDuration()`'s own separate measurement
   as the source of truth, vs. run both and reconcile.
3. Whether a failed/skipped duration measurement (e.g. ffprobe itself unavailable) should leave
   `durationSeconds` at its prior (requested-window) value, or write nothing / write a distinct
   null-equivalent - i.e., the write's own failure semantics, mirroring
   `verifyRenderedDuration()`'s existing "unverifiable -> warn, continue" non-fatal posture.
4. Whether `ClipVersion` should also capture a delivered-duration history field.

None of these are answered here — this document is the dependency map and evidence base the next,
separate design/approval turn would work from.

---

# Phase 9 Design (design only — no code, no schema, no migration applied)

Resolves the open forks §6 above left unresolved, per your own direction. Still produces no code
change, no migration, no schema change — this section proposes a schema diff and an implementation
plan for a **separate, later, explicitly-approved phase** to execute.

## D1. Naming: `renderedDurationSeconds`

Adopted, per your own preference — explicit, and consistent with this initiative's own
`RenderManifest`/"rendered output" vocabulary (Phases 4-8 all use "rendered"/"executed" to mean
"what genuinely happened," as opposed to "planned"/"requested"). No existing field or convention
collision. Sits naturally alongside `outputWidth`/`outputHeight`/`outputAspectRatio` — three
existing fields of the exact same character (real, post-render, measured facts) already written by
the same completion transaction this field would join (§D3).

## D2. Lifecycle semantics

Extending your own sketch, with the two ambiguities you explicitly left open now resolved (with
reasoning, not just asserted):

```
candidate created (clip-persistence.ts:150)
  └── durationSeconds = requested duration (endTime - startTime)
      renderedDurationSeconds = null   (Prisma column default, no explicit write needed)

manual trim, clip NEVER rendered (ClipsService.update(), outputUrl already null)
  └── durationSeconds = new requested duration
      renderedDurationSeconds = null   (unchanged - nothing to preserve)

manual trim, clip ALREADY rendered (ClipsService.update(), outputUrl still set)
  └── durationSeconds = new requested duration
      renderedDurationSeconds = UNCHANGED, left exactly as it was

render triggered - first render or explicit re-render (ClipsService.render())
  └── outputUrl cleared to null (existing behavior, unchanged)
      renderedDurationSeconds ALSO cleared to null, in the SAME transaction   <- NEW requirement

render success (render-clip.worker.ts's existing completion transaction)
  └── outputUrl = <new key>
      renderedDurationSeconds = <canonical actual duration>   <- NEW write, same transaction

render success, but the canonical duration measurement itself failed/was unavailable
  └── outputUrl = <new key>   (still written - a measurement failure never blocks the job)
      renderedDurationSeconds = null   (no misleading fallback value synthesized)

render fails entirely (job throws before the completion transaction runs)
  └── outputUrl and renderedDurationSeconds both stay whatever they already were
      (null for a first attempt; unchanged from the prior successful render, if this was
      a failed RE-render attempt - see D2's own re-render-clears-both step above, which means
      a failed re-render actually leaves BOTH null, not "reverted to the old render" - see
      the retry/idempotency note in D6 for why this is the correct, not merely acceptable, behavior)
```

**The resolved ambiguity (your own "atau tetap sesuai lifecycle yang diputuskan")**: a manual trim
on an already-rendered clip leaves `renderedDurationSeconds` **untouched**, not cleared and not
recalculated. Reasoning: `renderedDurationSeconds`'s own invariant is "the real duration of
whatever `outputUrl` currently serves, or null if nothing is currently being served" — it is
coupled to `outputUrl`'s lifecycle, not to `durationSeconds`'s. A trim edit doesn't touch
`outputUrl` (§1, confirmed existing behavior, deliberately unchanged), so it has no reason to touch
`renderedDurationSeconds` either. This keeps the field's meaning stable and single-purpose, and
requires zero change to `ClipsService.update()`'s own write payload.

**The new requirement this surfaces**: `ClipsService.render()` (the re-render trigger) must clear
`renderedDurationSeconds: null` in the SAME transaction where it already clears `outputUrl: null`
(`clips.service.ts:883-887`) — otherwise there is a real window (render in progress, or a failed
re-render) where `outputUrl` is null (nothing downloadable) but `renderedDurationSeconds` still
shows a stale number describing a file that no longer exists at that URL. This is the one other
production code site (besides the completion transaction itself) this design requires touching.

## D3. Atomic persistence — reuses the existing transaction, no new mechanism

Confirms your own instruction is directly implementable exactly as stated. The completion
transaction (`render-clip.worker.ts:2517-2562`) already does:

```ts
await tx.clip.update({
  where: { id: clipId, outputUrl: null },   // <- existing optimistic-concurrency claim, reused as-is
  data: toClipUpdateData(graphResult, {
    outputUrl: outputKey,
    outputSizeBytes,
    outputWidth: outputSize.width,
    outputHeight: outputSize.height,
    outputAspectRatio: aspectRatioLabel,
    // ... existing fields unchanged ...
  }),
});
```

Phase 9's only change here is one additional key in that same `extra` object:
`renderedDurationSeconds: canonicalDuration ?? null` — computed earlier in the job (§D4) and simply
threaded through as a local variable, exactly like `outputSize`/`aspectRatioLabel` already are. No
new transaction, no new query, no new concurrency primitive.

## D4. Canonical source of truth — collapsing two probes into one

**Confirmed real technical debt, exactly as you flagged.** Today's actual call sequence:

```
verifyRenderedDuration()          <- line 2207, calls getMediaDurationSeconds(finalOutputPath)
                                       internally, discards the result after one warn/info log
  ...
compileRenderPlan() (Phase 4)     <- line 2238
buildRenderManifest() (Phase 7)   <- ~line 2309
probeVideoMetadata()              <- Phase 8, its OWN separate call, discards durationSeconds
compareRenderManifestToProbe()    <- Phase 8
  ...
tx.clip.update(...)               <- line 2518, the completion transaction
```

Two independent ffprobe subprocess invocations against the identical file, ~300 lines apart,
computing the same fact twice, using neither for persistence. The design:

1. **Hoist Phase 8's `probeVideoMetadata(finalOutputPath)` call to run ONCE**, at (or before)
   `verifyRenderedDuration()`'s current position (line 2207) - the earliest point
   `finalOutputPath` is stable and fully written.
2. **`verifyRenderedDuration()`'s signature changes** from internally calling
   `getMediaDurationSeconds()` to accepting an already-probed `actualDurationSeconds: number`
   parameter. Its own "expected duration" reconstruction (`requestedDurationSeconds -
   removedSeconds + reactionHoldDurationSeconds + introDuration + outroDuration`) is UNCHANGED -
   only where the ACTUAL side comes from changes. This is a real code change for the
   implementation phase, not performed here - flagged precisely so that phase doesn't discover it
   mid-implementation.
3. **Phase 8's own `probeVideoMetadata()` call site is deleted** - it consumes the SAME hoisted
   probe result instead of fetching its own.
4. **The completion transaction (§D3) reads `probe.durationSeconds` directly** - the same value,
   threaded one hop further than it reaches today.

Net effect: one ffprobe subprocess call per render (same as today's Phase 8 already does), not
two; `verifyRenderedDuration()`'s own log, Phase 8's `RENDER_VERIFICATION_RESOLVED` log, and the
new DB write are all reading the identical, single measurement - not three independently-probed
numbers that could, in principle, disagree with each other from run-to-run ffprobe non-determinism
(unlikely in practice, but a real class of confusion this consolidation eliminates by construction).

## D5. Integration point with RenderManifest / ffprobe verification - deliberately NOT widened

**Recommendation: do not add a duration field to either `RenderManifest` or
`RenderVerificationResult`.** Both contracts are already shipped (Phases 7/8) with duration
explicitly and deliberately excluded, for reasons that still hold (`OutputProfile` has no duration
concept to declare an "expected" value against - see Phase 8's own module comment). Widening either
contract would reopen an already-tested, already-committed schema for a feature (DB persistence)
that doesn't actually need it - the consolidated probe result (D4) reaches the DB write directly,
with no need to round-trip through either contract. `Clip.renderedDurationSeconds` and
`RenderManifest`/`RenderVerificationResult` remain three independent consumers of the ONE
canonical probe, not layered on top of each other.

(Alternative considered and rejected for now: adding `actualDurationSeconds` to `RenderManifest`
purely for observability symmetry with its other fields. Rejected because it has no consumer -
same "no speculative fields" discipline this whole initiative has followed since Phase 1 - and can
be added later, additively, if a real need appears, without blocking Phase 9's own DB-persistence
goal.)

## D6. Retry / idempotency behavior

Directly inherits the audit's own Q9/Q10 findings, extended by D2's new re-render-clears-both
requirement:

- **Stale/duplicate job re-running an already-completed render**: unaffected by Phase 9 - the
  existing `if (existingClip.outputUrl) { return early }` guard (line 1414) fires before any of
  this new logic would ever run.
- **Genuine re-render** (`ClipsService.render()`): now clears both `outputUrl` and
  `renderedDurationSeconds` to null up front (D2). The completion transaction's own
  `where: { outputUrl: null }` claim (D3) means the SAME race-safety that already protects
  `outputUrl` automatically protects `renderedDurationSeconds` too - a second, racing execution's
  update simply matches zero rows, exactly as it does today for every other field in that same
  write.
- **A re-render that fails before completion**: both fields stay null (D2's own table) - this
  correctly reflects "nothing is currently being delivered," rather than misleadingly reverting to
  describe the PREVIOUS render's now-superseded file. This is a deliberate, small behavior change
  from today (today, a failed re-render simply leaves `outputUrl` null with no
  `renderedDurationSeconds` concept to worry about yet) - flagged explicitly as new-field-only
  behavior, not a change to any existing field's semantics.

## D7. Full writer/consumer impact

**Writers (after Phase 9):**

| Site | Change |
|---|---|
| `clip-persistence.ts` (`createCandidateClips`) | None - new clips start with `renderedDurationSeconds` at its column default (`null`) |
| `ClipsService.update()` (manual trim) | None - confirmed by D2 to correctly need no change |
| `ClipsService.render()` (re-render trigger) | **New**: add `renderedDurationSeconds: null` to its existing `outputUrl: null` clear (§D2/§D6) |
| `render-clip.worker.ts` completion transaction | **New**: add `renderedDurationSeconds: probe.durationSeconds ?? null` to `toClipUpdateData()`'s extra fields (§D3) |
| `verifyRenderedDuration()` | **Changed**: accepts the hoisted probe's `actualDurationSeconds` instead of self-probing (§D4) |
| `backfill-clip-duration.ts` | Not applicable to this field - see D8 for the analogous new-field question |

**Consumers (after Phase 9, none built in this phase):**

| Site | Consideration |
|---|---|
| Clip Library duration filter (`clips.service.ts:346-353`) | **Recommend: leave unchanged**, still filtering on `durationSeconds`. Filtering on `renderedDurationSeconds` would silently exclude every not-yet-rendered clip from a duration-range search, changing existing filter semantics as a side effect of an unrelated field addition - out of scope for this phase either way. |
| `toDto()` / API responses (`clips.service.ts:1305`) | Not touched in this phase. A future, separate phase could expose `renderedDurationSeconds` alongside `durationSeconds` for `apps/web` to prefer once rendered - the "UI fidelity pass" the original Phase 0 audit named as its own separate item. |

## D8. Migration / backfill strategy

**Schema change is purely additive** - one new nullable `Float?` column, no default beyond
Prisma's own implicit `NULL`, no data transformation required for the migration itself to be safe.

**Backfill of existing already-rendered clips** (`outputUrl IS NOT NULL AND
renderedDurationSeconds IS NULL` after the migration lands) is a genuine, separate decision:

- **Recommended default: no backfill.** Existing rendered clips simply read `null` for
  `renderedDurationSeconds` until their next re-render. This matches this codebase's own repeated
  precedent for exactly this shape of field (`outputWidth`/`outputHeight`/`outputAspectRatio` from
  the Output Resolution/Quality audit carry the same "populated going forward only" posture for
  pre-existing rows, and `durationSeconds` itself needed a ONE-TIME backfill script specifically
  because it was cheap/local, computed from already-in-the-row `startTime`/`endTime` - no
  I/O required). Backfilling `renderedDurationSeconds` is NOT cheap the same way: it requires
  downloading each existing rendered clip from object storage and running ffprobe against it, at
  real per-clip I/O and compute cost, for however many already-rendered clips exist in production.
- **Optional follow-up**, if historical completeness is later wanted: a dedicated script
  mirroring `backfill-clip-duration.ts`'s own shape (idempotent, only touches
  `renderedDurationSeconds IS NULL AND outputUrl IS NOT NULL` rows), run out-of-band, rate-limited
  against object storage/ffprobe load - explicitly NOT part of this phase's own acceptance
  criteria (D9).

## D9. Proposed schema diff (NOT applied)

```prisma
model Clip {
  // ... existing fields unchanged ...
  durationSeconds             Float?
  // Phase 9 (Clip Count & Duration Precision Engine, docs/ai/clip-duration-precision-engine.md) -
  // the REAL, post-render, ffprobe-measured duration of whatever outputUrl currently serves.
  // Deliberately distinct from durationSeconds (the requested/candidate window, unchanged by this
  // phase) - see that doc's own D2 for the full lifecycle semantics this field follows. null
  // until the first successful render, and again whenever outputUrl is cleared for a re-render.
  renderedDurationSeconds     Float?
  // ... existing fields unchanged ...

  @@index([videoId])
  @@index([viralityScore])
  @@index([durationSeconds])
  // No new index proposed - unlike durationSeconds, this field has no proposed query/filter
  // consumer yet (D7); add one if/when a real consumer needs it, not speculatively.
}
```

One migration file, additive only, no data migration step, no changes to `startTime`/`endTime`/
`durationSeconds`/any other existing column.

## D10. Acceptance criteria (for the later implementation phase — not built here)

1. `renderedDurationSeconds` exists on `Clip`, nullable, additive migration only.
2. A new clip (candidate creation, both the original and Generate-More-Clips flows) has
   `renderedDurationSeconds: null` and unchanged `durationSeconds` behavior.
3. A manual trim (`ClipsService.update()`) never writes `renderedDurationSeconds`, on both a
   never-rendered and an already-rendered clip - `durationSeconds` updates exactly as it does
   today, `renderedDurationSeconds` is provably untouched (regression test against the CURRENT
   `ClipsService.update()` behavior, not just the new field).
4. `ClipsService.render()` clears both `outputUrl` and `renderedDurationSeconds` to `null` in the
   same transaction, for both a first-ever render and a genuine re-render.
5. Exactly one `probeVideoMetadata()` call happens per successful render (real-ffmpeg proof, not
   a mocked call-count assertion alone) - `verifyRenderedDuration()`'s own tolerance check and the
   DB write both observably consume the identical measured value.
6. On a successful render, the completion transaction writes `renderedDurationSeconds` equal to
   the canonical probe's `durationSeconds`, atomically with `outputUrl` and every existing field
   that transaction already writes - verified via the SAME `where: { outputUrl: null }` race-proof
   pattern already tested for `outputUrl` itself (a duplicate/retried job execution must not double
   -write or corrupt the value).
7. If the canonical probe fails, `outputUrl` is still written (job still succeeds) and
   `renderedDurationSeconds` is left `null` - never a fabricated fallback number.
8. A duration-only regression suite proves `RENDER_VERIFICATION_RESOLVED`'s own log content and
   `verifyRenderedDuration()`'s own log content are unaffected in shape (still fire, still contain
   the same fields), only their internal probe-sourcing changed.
9. No change to the Clip Library duration filter's existing query behavior (still filters on
   `durationSeconds`, confirmed via existing filter tests still passing unmodified).
10. `pnpm verify` (format/lint/typecheck/build/test) green across `packages/database`,
    `apps/worker`, `apps/api`.

None of D1-D10 has been implemented. This remains a design proposal awaiting your review and a
separate, explicit decision on whether to proceed to migration + implementation.
