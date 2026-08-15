# Render Fidelity & Composition Execution Engine — Production Rollout Runbook

Phase 6 (Rollout, per `docs/ai/render-fidelity-matrix.md`'s roadmap) — **documentation only, no
new code**. Covers how `RENDER_EXECUTION_COMPILER_ENABLED` (Phase 5, `apps/worker/src/
execute-render-plan.ts`) can eventually be turned on in production, and what cannot be done today
without further implementation work. This runbook does not itself perform a rollout, enable the
flag anywhere, or build any rollout mechanism — it is the reference a future rollout would follow.

## 0. Rollout sequence

Written before Phase 6 first shipped, this runbook originally jumped straight to §2's instance-
based canary — implicitly assuming a real production deployment already existed to canary against.
It was later discovered (2026-08-14) that Speedora has **no real production deployment at all
yet** — still local-development only — which made §2 inapplicable as a *first* step (there is
nothing live to verify topology against, let alone canary on). The real gate sequence, reflecting
what's actually true today:

```
LOCAL EQUIVALENCE GATE
        ↓ PASS
Production deployment
        ↓
Production smoke test
        ↓
Canary / full rollout
```

- **LOCAL EQUIVALENCE GATE** — `apps/worker/src/workers/render-clip.worker.local-comparison.ts`
  (docs/ai/render-fidelity-local-equivalence-gate.md), a real end-to-end proof that the compiled
  executor (flag on) matches the legacy inline path (flag off) for the SAME job, run entirely
  locally against real ffmpeg — the pre-production substitute for a canary this initiative built
  precisely because a live deployment didn't exist to canary against. **Status: PASSED**
  (2026-08-15) — 5/5 scenarios, 10/10 real renders, every field identical between branches,
  including the full 5-execution-pass sequence. One orthogonal, non-blocking finding from that
  work (a bounded, non-growing `concatBrandSegment()` fps-drift artifact) is documented separately,
  not a gate failure — see that doc's own "known, accepted" section.
- **Production deployment** — does not exist yet. Everything from here down in this runbook is
  still describing a FUTURE state, not a current one.
- **Production smoke test** — once a real deployment exists, re-run the SAME local-comparison
  harness's underlying technique against real production data/config before touching live traffic
  at all (a manual, deliberate step - the harness itself stays local-only by design, see its own
  file header for why; "smoke test" here means re-validating equivalence isn't assumed to transfer
  automatically from local fixtures to whatever real deployment config/source-video mix turns out
  to exist, not literally running the Jest file against production).
- **Canary / full rollout** — §2 (instance-based) or §3 (single-instance, all-or-nothing) below,
  once the smoke test above has passed. Strategy B (§4, percentage-based) remains explicitly
  deferred/not implemented — no real justification to build it before a live deployment's actual
  topology is known (see that section's own reasoning).

The rest of this runbook (§1 onward) is unchanged in substance from when it was originally
written — it describes the canary mechanism itself, not this gate sequence around it.

## 1. Current state

- `RENDER_EXECUTION_COMPILER_ENABLED` exists (`.env.example`, read by `apps/worker/src/
  execute-render-plan.ts`'s `isRenderExecutionCompilerEnabled()`).
- Default is `false` everywhere. Anything other than the literal string `'true'` is treated as
  off — this is the safe default and remains true in every environment until someone
  deliberately sets it.
- **No percentage-based or traffic-fraction rollout mechanism exists today.** The flag is a
  single, process-wide boolean: every render a given worker process handles either all goes
  through the compiled-plan executor, or none of it does. There is no per-clip, per-user, or
  per-percentage switch anywhere in this codebase, for this flag or any other — see §4.

## 2. Instance-based canary procedure (Strategy A — zero new code)

This is the only traffic-fraction option available **without further implementation work**, and
it depends entirely on the real deployment's topology, which this runbook does not assume.

**Prerequisites — verify before attempting this:**

- Confirm how many independent `render-clip` worker instances/processes the deployment actually
  runs. `docs/deployment.md`'s Fase 3 topology (`docker-compose.oracle-worker-render.yml`)
  describes `render-clip` as its own dedicated worker role, but describes running it as a single
  instance — it does not itself establish or guarantee multiple replicas. **Do not assume
  multiple instances exist; check the live deployment (`GET /workers/health`, per
  `docs/deployment.md`'s "Health Endpoint" section) before proceeding.**
- If the check shows only one `render-clip` worker instance, stop here — see §3.

**Procedure, once ≥2 independent `render-clip` instances are confirmed:**

1. Pick one instance as the canary. Leave the rest as the control group.
2. On the canary instance's own env (whichever `.env`/`.env.production`/compose-level override
   applies to that one process — see `docs/deployment.md`'s "Env var sourcing" section):
   ```
   RENDER_EXECUTION_COMPILER_ENABLED=true
   ```
3. On every other `render-clip` instance, leave (or explicitly set):
   ```
   RENDER_EXECUTION_COMPILER_ENABLED=false
   ```
4. Restart only the canary instance for the env change to take effect (a plain env-var read,
   lazy per Node process — no code deploy required, see `execute-render-plan.ts`'s own
   `isRenderExecutionCompilerEnabled()` comment).
5. All instances continue consuming the same shared `render-clip` BullMQ queue — BullMQ's own
   round-robin distribution across consumers naturally sends only a fraction of jobs (roughly
   `1 / instance_count`, not a precisely tunable percentage) to the canary instance. This is not
   a controllable percentage — it is whatever fraction that one instance's own share of the
   queue happens to be.
6. **Observe** (see §5) before touching any other instance.
7. **Roll back** by setting the canary instance's own `RENDER_EXECUTION_COMPILER_ENABLED` back to
   `false` and restarting it — see §6.

This procedure adds no new code, no new env var beyond the one Phase 5 already shipped, and no
new infrastructure — it is a direct reuse of the per-instance env-layering Fase 3's deployment
topology already established for an unrelated purpose (queue specialization).

## 3. Single-instance limitation

If the deployment runs exactly one `render-clip` worker instance (or the instance count could not
be verified), **traffic-fraction canarying is not possible** with anything that exists today. The
only available choice is all-or-nothing:

- `RENDER_EXECUTION_COMPILER_ENABLED=false` on the one instance — the existing inline path
  handles 100% of renders (today's default, in every environment).
- `RENDER_EXECUTION_COMPILER_ENABLED=true` on the one instance — the compiled-plan executor
  handles 100% of renders, with no gradual ramp and no control group to compare against in the
  same environment.

Do not attempt to fake a canary on a single instance by flipping the flag for only part of a
deployment's uptime (e.g., "on for an hour, then off") — this produces a time-based split, not a
traffic-based one, and confounds any observed difference with whatever else changed over that
same window (load, source video mix, time of day). If only one instance exists and a real canary
is required, that is precisely the gap Strategy B (§4) would need to close — not something to
work around informally.

## 4. Future percentage rollout (Strategy B — NOT IMPLEMENTED)

Described here for reference only. **Nothing in this section exists in the codebase.** Building
it is explicitly out of scope for Phase 6 and would need its own, separately approved
implementation phase.

**Concept**: a new env var, e.g. `RENDER_EXECUTION_COMPILER_ROLLOUT_PERCENT` (0–100, default 0),
read alongside the existing boolean flag:

- `0` — 0% of renders use the compiled executor (today's exact default behavior).
- `10` / `25` / `50` — approximately that fraction of renders use it, regardless of how many
  worker instances exist (a genuine per-job split, not per-instance).
- `100` — every render uses it, equivalent to today's `RENDER_EXECUTION_COMPILER_ENABLED=true`.

**Why NOT `Math.random()`**: a random per-attempt decision would let the SAME clip land on
different execution paths across BullMQ retry attempts (a render that fails and retries could be
compiled-executed once and inline-executed the next), which would make a failure impossible to
attribute to either path cleanly. The eventual implementation would need a **deterministic
hash of a stable render identifier** — `clipId` is the natural candidate, since it's already the
one identifier present on every attempt of the same job — so a given clip is consistently
assigned to the same path across every retry of that same render.

**Not implemented in Phase 6, deliberately**: no new env var, no hashing function, no rollout
utility module, no new tests, no new branching in `render-clip.worker.ts` or
`execute-render-plan.ts` exist for this today. A future phase that builds it would need its own
planning/approval cycle, matching how every other genuinely new mechanism in this initiative has
been scoped (see `docs/ai/render-fidelity-matrix.md`'s Phase 1–5 history).

## 5. Rollout safety

- **Never assume deployment topology.** This runbook does not claim production has, or doesn't
  have, multiple `render-clip` instances — that must be verified against the real, live
  deployment (`GET /workers/health`) at the time of an actual rollout, not inferred from what
  `docker-compose.oracle-worker-render.yml` merely describes as possible.
- **Verify worker count before choosing a strategy.** Strategy A (§2) only applies once ≥2
  instances are confirmed live; otherwise §3 is the only option.
- **Do not enable the compiler globally** (`RENDER_EXECUTION_COMPILER_ENABLED=true` across every
  instance at once) **without real-output evidence** from a canary or an equivalent controlled
  comparison first. Phase 4/5's own test suites (`execute-render-plan.spec.ts`,
  `execute-render-plan.integration.spec.ts` against real ffmpeg, `render-plan-compiler.spec.ts`,
  `render-clip.worker.spec.ts`) prove the compiled path is *equivalent* to the inline path under
  every scenario those tests construct — they are not a substitute for observing real production
  traffic, which can contain source video shapes/edge cases no synthetic fixture reproduces.
- Watch, at minimum, during any canary window:
  - `GET /alerts`'s `queue-failure-rate:render-clip` condition (`docs/alerting.md`) — a
    system-wide signal that would catch a canary-caused regression, diluted across all
    `render-clip` jobs (canary + control) but still present.
  - `GET /queues`'s `avgProcessingTimeMs` for the `render-clip` queue (`docs/monitoring.md`) — a
    real duration regression on the canary instance would show up here, blended with the control
    group's own numbers.
  - The structured logs Phases 4/5 already emit on every render — `RENDER_EXECUTION_COMPILER_ACTIVE`,
    `RENDER_PLAN_RESOLVED`, `RENDER_EXECUTION_PLAN_COMPILED` — searchable/countable per instance,
    letting an operator confirm which renders actually went through the compiled path and inspect
    their compiled pass lists directly.
  - `GET /clips/:id/render-fidelity` (Path B, docs/ai/render-fidelity-local-equivalence-gate.md) -
    added AFTER this runbook was first written, this is a real per-clip queryable alternative to
    grepping logs: `renderManifest.execution.passes` shows exactly which passes a specific canary
    render actually took, and `renderVerification` shows whether that render's own ffprobe
    reconciliation passed - both persisted (`Clip.renderPlan`/`renderManifest`/`renderVerification`),
    not just logged, so they're inspectable well after the render finished, not only in real time.

## 6. Rollback

- **Instance-based canary (§2)**: set the canary instance's own `RENDER_EXECUTION_COMPILER_ENABLED`
  back to `false` and restart only that instance. Every other instance was never touched.
- **Single-instance, already flipped to `true` (§3)**: set `RENDER_EXECUTION_COMPILER_ENABLED=false`
  and restart the one instance.
- In both cases, this is an env var change plus a process restart — never a code revert or
  redeploy of a different image/commit, since the flag is read lazily at call time
  (`isRenderExecutionCompilerEnabled()`'s own comment). Follow whatever restart/redeploy
  mechanism the actual deployment uses (`docker compose restart <service>`, a platform-specific
  rolling restart, etc.) — this runbook does not prescribe one, since that is a property of the
  real deployment, not of this flag.
- In-flight jobs are unaffected by the restart itself — BullMQ jobs live in Redis, not in the
  worker process, so a job already `active` on the instance being restarted returns to `waiting`
  and is picked up by another consumer (same behavior `docs/deployment.md`'s own worker-topology
  rollback procedures already document).
