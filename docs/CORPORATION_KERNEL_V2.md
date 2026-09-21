# Corporation Kernel v2

This branch starts a clean orchestration kernel beside the legacy runtime.

It does **not** rewrite Chat, GitHub, OmniRoute, Hermes, Vault, Providers, Releases,
or the existing Control UI. Those systems become adapters.

## Constitutional model

```
Owner
  ↓
Harmonia Constitution
  ↓
HLL — internal language for truth, provenance, ratification and allowed Brain actions
  ↓
Corporation Kernel / Koordynator
  ↓
Departments → Role Contracts → Executors → Evidence
```

HLL is not reimplemented here. The kernel only depends on the `HllPort`.

## New kernel modules

- `domain.ts` — Corporation domain contracts without legacy TaskRole coupling
- `ports.ts` — HLL, state, events, executors and candidate boundaries
- `hll.ts` — HLL statement construction and hard action gate
- `file-store.ts` — durable snapshot and append-style event persistence
- `capability-registry.ts` — resolves roles through capabilities/effects/tools, not provider names
- `planner.ts` — deterministic inspectable baseline planner
- `comparator.ts` — hard correctness/security gates + Pareto front + best verified candidate
- `kernel.ts` — portfolio, HLL gating, recruitment, role activation and planning

## Non-negotiable invariants

1. Unratified propositions do not become executable corporate truth.
2. Koordynator may use only actions present in `allowedBrainActions`.
3. Recruitment is caused by a real capability gap.
4. A new Role Contract cannot become active unless a healthy executor can satisfy its capability/effect/tool ceiling.
5. Dynamic roles are not forced into the old five-value `TaskRole` enum.
6. External or privileged effects remain independently authorisation-gated.
7. A solution is not eligible for selection merely because it looks good. It must be verified and pass hard correctness/security thresholds.
8. Legacy runtime remains untouched while the kernel is proven.

## Migration order

1. Prove the pure kernel and contracts.
2. Add production adapter to the authoritative HLL in Harmonia Legal.
3. Add executor adapters for Hermes/OpenCode/Playwright/audit/release.
4. Replace same-worktree code execution with ephemeral git worktrees.
5. Feed Self-Improvement incidents into the corporate portfolio.
6. Add Candidate Generator + independent verifier + Comparator loop.
7. Expose Corporation API.
8. Add Corporation UI.
9. Route selected Tasks through v2.
10. Retire legacy orchestration only after equivalent and new gates pass.

## Current implementation boundary

This first slice intentionally stops before execution side effects. It plans, recruits,
ratifies and compares, but does not yet mutate a repository or call an external system.

That allows the new constitutional/domain model to be tested without risking the
operator's current dirty working tree.
