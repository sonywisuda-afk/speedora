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

### Shared sub-schemas

`packages/contracts/src/transcript-word.ts` holds the one `TranscriptWordInput` shape used by clip-scoring, cutlist, subtitles, and reframe — extracted once a second module needed the exact same shape, rather than each contract file defining its own copy (the same "extract at 2nd/3rd duplication" convention the rest of this codebase already follows).

Use these as templates for the next module — pick the clip-scoring shape if the module makes one external call and produces one JSON result; pick the cutlist shape if it's a small library of independent pure functions; pick the reframe shape if the module needs both, plus deployment-specific file/executable paths.

## State machine + audit trail for long-running jobs

The `Video` pipeline (`UPLOADING`/`IMPORTING` → `UPLOADED` → `TRANSCRIBED` → `CLIPS_DETECTED` → `RENDERED`, or `FAILED` at any step) already had an explicit `VideoStatus` enum as its state - the missing piece was a durable history of *transitions*, not just the current value, and a single choke point that writes it.

- **`VideoStatusEvent`** (`packages/database/prisma/schema.prisma`) — one row per transition: `videoId`, `toStatus`, `errorMessage` (set only for `FAILED`), `createdAt`. There's no `fromStatus` column - transitions for one video are always sequential (never processed by two workers concurrently for the same video), so the previous status is just the prior row's `toStatus` when queried `ORDER BY createdAt`, and storing it again would be redundant.
- **`@speedora/database`'s `updateVideoStatus()`/`recordVideoStatusEvent()`** (`packages/database/src/video-status.ts`) are the *only* sanctioned way to change `Video.status`. `updateVideoStatus(prisma, videoId, status, { data?, errorMessage? })` updates the row and inserts the event atomically via `$transaction`; `recordVideoStatusEvent()` is the bare event-insert half, for callers (`VideosService.upload()`/`.importFromYoutube()`) that need to compose it into their own transaction because the `Video` row is being `create()`'d for the first time in that same transaction.
- **Every existing call site was migrated to go through these** — `VideosService` (upload/import/retry) and all four workers (`transcribe`, `detect-clips`, `import-youtube`, `render-clip`) no longer call `prisma.video.update({ data: { status ... } })` directly. `FAILED` transitions now also capture `error instanceof Error ? error.message : String(error)` into the event row, so a failure can be diagnosed from a DB query alone, without needing Sentry access.
- **This is deliberately infrastructure, not a JSON-contract module** — `video-status.ts` takes a real `PrismaClient` and writes to the DB directly; it doesn't belong in `packages/contracts`/a stateless module package, because its entire job *is* being the DB-access choke point the rest of this document tells other modules to stay away from.
- **Retry behavior itself was intentionally left unchanged** — `VideosService.retry()` still infers which stage to resume from existing data (no transcript segments → re-run transcribe, etc.), which was already correct and well-tested. The audit trail is a new observability layer on top, not a replacement for that inference logic.
- **Verified against a real database, not just mocks** — beyond the unit tests (`packages/database/src/video-status.spec.ts` plus every updated caller's spec), a one-off script ran the full lifecycle (create → transitions → a `FAILED` with a message → query the ordered history → delete the video → confirm the cascade removed its events) against the actual dev Postgres.

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
