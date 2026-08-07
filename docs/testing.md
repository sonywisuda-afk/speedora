# Testing conventions

## Module tests vs. adapter tests

Every JSON-contract stateless module (`coding-standards.md`) gets tested at two separate levels,
deliberately not blended:

- **Module tests** (`packages/<name>/src/*.spec.ts`) — plain fixtures in, asserted output out. No
  DB mock, no queue mock, no `jest.mock()` of any kind for modules with zero external dependencies
  (`packages/editing-rhythm`, `packages/emoji-suggester`, `packages/fusion-engine`'s own scoring
  math). For modules with an injected `deps` (subprocess, LLM client), the test fakes `deps`
  directly (e.g. `deps.execFile`, `deps.openai`) — never `jest.mock()`s the underlying module the
  dependency wraps. This is the concrete payoff of dependency injection here: testability without
  mocking machinery.
- **Adapter tests** (`apps/worker/src/workers/*.worker.spec.ts`) — mock the *module* itself (e.g.
  `jest.mock('@speedora/facial-intelligence', ...)`), assert only orchestration: was the module
  called with the right narrowed input, was the result persisted in the right shape, did a
  detector failure get caught without failing the job, did the right queue get enqueued next.
  Pure/synchronous derive functions (`deriveEditingRhythmFeatures`, `computeSpeakingRate`,
  cutlist's merge functions) are deliberately **left real** (`jest.requireActual`) even inside
  adapter tests — they're pure enough that re-mocking them would just hide a real integration bug.

This split means a module's own logic never needs re-testing from inside a worker spec file, and a
worker spec never needs to re-derive a module's internal math to build its expected fixtures — it
computes real values by hand (or runs the real function once to get them) and pins them.

## Stale-fixture risk when adding a new Fusion Engine signal

Every `render-clip.worker.spec.ts` test that asserts an exact `prisma.clip.update()` payload (not
`expect.objectContaining`) must be updated whenever a new Fusion Engine signal/feature is added,
even in tests that don't otherwise touch that signal — the `highlightBreakdown` array and the
persisted `data` object both grow a new key/entries for *every* signal, including weight-0 ones,
on every render. This has caused real, repeatedly-recurring stale-test failures across the AI
Fusion roadmap (most recently: 6 tests broke when the `editingRhythm` signal was wired in, because
several exact-equality fixtures weren't updated at the same time as the feature). When adding a
new signal, grep `render-clip.worker.spec.ts` for every exact `data: {...}` / `highlightBreakdown:
[...]` block, not just the tests that were written to exercise the new signal directly.

## "Verified against real Postgres" pattern

Every new Prisma migration/column in this project has been verified with a real round-trip against
a dev Postgres instance (create → read → clear to `Prisma.JsonNull` where applicable → cascade-
delete) via a one-off script, run once and then deleted — not just written and assumed correct.
This is separate from and in addition to the unit test suite; unit tests mock Prisma, this
verification step doesn't.

## Cross-feature E2E verification (Stabilization Pass, Area 3 — 2026-07-19)

Every Sprint 6A-6K feature has unit tests, but all of them mock Prisma — until this pass, nothing
proved the full chain (Upload → Processing → Publish → Snapshot → Overview → Trend → Campaign →
Followers → Heatmap → Insight → Prediction → Tracked Link → Conversion) was coherent as one system
against a real database. `pnpm --filter @speedora/worker verify:cross-feature`
(`apps/worker/src/scripts/cross-feature-e2e/`) is a rerunnable tool (kept, not a delete-after-use
script, following the same precedent as `generate-dataset-report.ts`/`run-fusion-v3-pipeline.ts`)
that drives the real chain end-to-end via real HTTP calls to a running `apps/api` plus real worker
logic, against the dev Postgres/Redis, then cascade-deletes everything it created.

Verified for real, twice consecutively (second run proves cleanup leaves the DB exactly as it found
it — no leftover-data collisions): all 6 explicitly-required failure scenarios — worker-failed-then-
retry (real stage-inferred `VideosService.retry`), a platform that structurally doesn't support a
metric (Threads has no `fetchFollowerCount` at all — real, unmodified gating, not simulated), an
account that hasn't reconnected (TikTok's `syncStats` substituted to throw, proving the real
per-record isolation in `sync-publish-stats.worker.ts`), a bot click (real `isBotUserAgent` +
redirect, excluded from `clickCount`), publish without a campaign, and a campaign with zero
publishes (graceful empty analytics, not an error).

Two deliberate scope cuts, same "frozen AI pipeline" honesty this codebase already applies
elsewhere: no real ffmpeg/ASR render or OAuth (clips/social accounts are seeded directly via Prisma
at the point those pipelines would have finished, matching the Product Experience mandate's "AI
pipeline frozen" posture), and no real BullMQ queue dispatch for the Snapshot/Followers phases —
this dev environment already had a separate, real `apps/worker dev` process consuming the exact same
queues, and racing it would have let its unsubstituted `platformRegistry` silently win the job
instead of this script's fake one. `direct-sync.ts` reproduces
`sync-publish-stats.worker.ts`/`sync-follower-count.worker.ts`'s query-plus-per-record-loop bodies
exactly, calling the same real shared dependencies, so the per-record isolation logic under test
still runs for real — only BullMQ's own dispatch plumbing is bypassed.

## Known, honestly-documented verification gaps

Every module that shells out to `ffmpeg` (stderr parsing: `astats`, `showinfo`, `blackdetect`,
`signalstats`/`metadata=print`) or to a Python subprocess (MediaPipe, pyannote, transformers,
OpenCV, Tesseract) has, at various points in this project's history, only been testable against
**hand-written fixtures** — the development sandbox has not always had real `ffmpeg`/Python/model
binaries available. This is called out explicitly in each module's own documentation
(`ai/vision.md`, `ai/audio.md`, `ai/ocr.md`) rather than silently assumed correct. Where a real
end-to-end run *has* happened (many modules have, once real binaries/API keys became available in
a session — real TTS-generated test audio for diarization/vocal-emotion, a real Pexels/Pixabay/
Unsplash API key for B-roll, a real Playwright browser session for the OCR Review UI), that's noted
in the relevant doc as a verified path, not assumed from the unverified ones. Treat "unit tests
pass" and "verified against the real external system" as two separate claims — this codebase does
not conflate them, and neither should changes to it.

## Full-monorepo verification

Because `packages/shared` types (and, more subtly, `packages/contracts` Zod schemas feeding
`packages/fusion-engine`) are consumed transitively by every app, always run the **full** monorepo
build and test suite (`pnpm -r build`, `pnpm -r test`) after a shared-type change — not just the
app you meant to touch. See `coding-standards.md`'s TS2742 and `apps/web` exhaustive-map gotchas,
both of which are specifically the kind of failure that only shows up in a package/app you didn't
directly edit.

## `pnpm verify` — run before every push

**Run `pnpm verify` before pushing a branch.** It runs, in order, `format:check` → `lint` →
`typecheck` → `build` → `test` across the whole repo — the same checks CI's 4 workflows run,
composed from the existing root `format:check`/`lint`/`typecheck`/`build`/`test` scripts (no new
logic). Cheapest checks first, so a trivial formatting/lint mistake fails fast instead of waiting
through a full build first.

This exists because AI Intelligence v4's Phase 0-1 PR (#52) needed 3 separate follow-up commits
after CI caught things a local `pnpm --filter <package> build/test` pass had missed entirely: a
package using `process.env` without declaring `@types/node` (worked locally only via node_modules
hoisting, broke every CI workflow's shared "Build packages" step), and two rounds of
`prettier`/`eslint` formatting CI's repo-wide `format:check`/per-package `lint` steps caught that a
scoped local run didn't. Phase 2's PR (#53) ran `pnpm verify`'s equivalent manually before pushing
and went fully green on the first try — no follow-up commits.

`pnpm verify` does **not** replace CI (still the real gate; branch protection requires the 4 status
checks regardless), and it isn't wired into a git hook — it's a manual step to run before pushing,
the same way you'd run tests before committing.
