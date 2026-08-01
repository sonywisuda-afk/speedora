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

### If this PR touches a `schema.prisma` enum (or any `packages/shared` enum)

See `docs/coding-standards.md`'s "Enum mapping rules" for the full rationale — this checklist is
the short version to run through before requesting review:

- [ ] `packages/shared`'s mirrored enum updated with the same new/changed member(s)
- [ ] Every `as unknown as` / `as never` mapper at the Prisma ↔ shared boundary updated (its own
      `assertNever` should already have failed `tsc --noEmit` if you missed one — don't silence
      that error with a cast)
- [ ] Every `Record<Enum, ...>` icon/label/color/tone/badge registry has a matching entry (the
      compiler should already have failed the build if you missed one — don't switch it to
      `Record<string, ...>` or `Partial<...>` to make the error go away)
- [ ] A registry fed by API data (not the frontend's own `Object.values(Enum)` iteration) has a
      runtime-safe getter (`isKnownX`/`getX`) covering the new member, not a direct index
- [ ] `pnpm typecheck` passes across `apps/api`, `apps/worker`, and `apps/web`
- [ ] `pnpm lint` and `pnpm build` pass
- [ ] A test proves the new member's mapping (round-trip through the mapper) and, if a runtime
      getter changed, that an unrecognized value still falls back safely instead of throwing
