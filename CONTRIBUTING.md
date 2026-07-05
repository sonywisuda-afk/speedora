# Contributing

This is a private, proprietary project (see [`LICENSE`](./LICENSE)). Contributions are only accepted from people explicitly invited to the repository; by submitting a change you agree it becomes the property of the copyright holder under the terms of that license.

## Getting started

Follow [`README.md`](./README.md) to install dependencies, set up `.env`, and start the local Postgres/Redis + dev servers. Read [`CLAUDE.md`](./CLAUDE.md) for the architecture overview and design decisions before making structural changes. If you're adding a new analysis/calculation module (scoring, detection, transforms), read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first — it documents the DB-backed-orchestration + JSON-contract-module pattern and the checklist for adding one.

## Branching & commits

- Branch off `master`: `feature/<short-description>`, `fix/<short-description>`, `chore/<short-description>`.
- Write commit messages in imperative mood, summarizing the *why* over the *what* (e.g. "Fix clip render timeout on long videos", not "Update render-clip.worker.ts").
- Keep commits scoped to one logical change; avoid bundling unrelated fixes.

## Before opening a PR

Run these from the repo root and make sure they pass:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Format any changed files with `pnpm format` — CI (once set up) will reject unformatted code.

## Code conventions

- All packages are TypeScript. Shared types/DTOs/enums (job payloads, status enums, etc.) live in `packages/shared` and must be imported, not duplicated, in `apps/web`, `apps/api`, and `apps/worker`.
- `apps/web` and `apps/api` only talk to each other over HTTP — no direct cross-imports.
- `apps/worker` only consumes BullMQ jobs; it never serves HTTP.
- New BullMQ job types go in `packages/shared` (`QueueName` enum + typed job/result interfaces) before being used in `apps/api` (producer) or `apps/worker` (consumer).
- Database schema changes go through migrations, not manual edits or auto-sync.

## Pull requests

- Describe what changed and why, and link any related issue/context.
- Include a short test plan (what you ran, what you verified manually).
- Prefer small, reviewable PRs over large multi-feature ones.
