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
- **`packages/<module-name>`** (e.g. `packages/clip-scoring`) — the stateless module itself: one exported function, `(input, deps?) => Promise<Output>`. External side effects the module genuinely needs (an LLM call, for example) are passed in via a `deps` parameter rather than constructed from `process.env` inside the module, so tests can inject a fake without any module-level mocking.
- **The adapter** — lives where the orchestration already lives (an `apps/worker/src/workers/*.worker.ts` file, or an `apps/api` service). Responsible for: reading DB/job data, narrowing it down to the module's own (deliberately minimal) input contract, calling the module, and persisting/enqueuing the result.

## Worked example: clip scoring

- Contract: [`packages/contracts/src/clip-scoring.ts`](./packages/contracts/src/clip-scoring.ts)
- Module: [`packages/clip-scoring/src/score-clip-candidates.ts`](./packages/clip-scoring/src/score-clip-candidates.ts) — takes transcript segments, returns scored/sanitized clip candidates. Calls OpenAI (injected via `deps.openai`), does its own filtering/sanitization/Smart-Start-End snapping. No Prisma, no BullMQ, no Sentry.
- Adapter: [`apps/worker/src/workers/detect-clips.worker.ts`](./apps/worker/src/workers/detect-clips.worker.ts) — narrows `TranscriptSegment[]` (which also carries `speaker`/`emotion` the module never needs) down to the module's input shape, calls `scoreClipCandidates`, then persists `Clip` rows, updates `Video.status`, and enqueues `render-clip` jobs.
- Tests: [`packages/clip-scoring/src/score-clip-candidates.spec.ts`](./packages/clip-scoring/src/score-clip-candidates.spec.ts) tests the module purely with JSON fixtures and a faked OpenAI client — no DB/queue mocking at all. [`apps/worker/src/workers/detect-clips.worker.spec.ts`](./apps/worker/src/workers/detect-clips.worker.spec.ts) mocks the module directly and tests only the orchestration (persistence, status transitions, enqueue, Sentry).

Use this pair of files as the template for the next module.

## Checklist for adding a new stateless module

1. Define the input/output contract as a Zod schema in `packages/contracts/src/<module-name>.ts`, exporting both the schemas and their inferred types. Keep the input shape as narrow as the module actually needs — don't reuse a full DB-shaped type from `packages/shared` if the module only reads a few of its fields.
2. Create `packages/<module-name>` with a single exported function following `(input, deps?) => Promise<Output>`. Any external call the module needs (LLM, other API) goes through `deps`, injected by the caller — never constructed from `process.env` inside the module.
3. Write the module's tests purely against JSON fixtures (plus a faked `deps`) — no Prisma/BullMQ/Sentry mocking. If you find yourself wanting to mock the database to test this file, the logic in it doesn't belong in this package.
4. Write (or extend) the adapter in `apps/api` or `apps/worker` that narrows DB/job data into the module's input contract, calls it, and persists/enqueues the output. Test the adapter by mocking the module itself, not by re-testing the module's internal logic.
5. If this module is a step in a longer job pipeline, make sure its DB status transitions fit the existing state machine (see `VideoStatus`/`PublishStatus` in `packages/shared`) rather than introducing a new ad-hoc boolean flag.
6. `pnpm typecheck && pnpm lint && pnpm build && pnpm test` must all stay green, including every existing test suite (regression guard) — not just the new one.

## Why this reduces collision risk

- A new stateless module never touches DB schema, so it's safe to build in parallel without migration conflicts.
- DB schema changes only ever happen in adapters — few, well-known files — making them easy to coordinate when two pieces of work overlap.
- An explicit state machine (see `VideoStatus`/`PublishStatus`) prevents the "scattered boolean flags" failure mode that's usually the hidden source of bugs as pipelines grow more steps.
