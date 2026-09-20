# Corporation Living Specification

**Canonical repository:** `nikodemklasik-code/koordynator`  
**Implementation branch:** `feature/corporation-kernel-v2`  
**Pull request:** #73  
**Status:** active implementation, migration beside legacy runtime  
**Internal language:** HLL  
**Constitutional authority:** Harmonia  
**Executive brain:** Koordynator  
**Product:** Harmonia Legal Platform is one Corporation product, not the Constitution.

> This file is the durable architectural memory for the Corporation build.
> Every material architectural change to Corporation v2 should update this file
> in the same change set.

## 1. What we are building

We are implementing the **whole Corporation architecture**, not one isolated feature.

The implementation is staged so the existing Koordynator remains operational while
a clean Corporation/Brain kernel is proven beside it.

The target system includes:

- Harmonia constitutional boundary;
- HLL as the internal language for truth, provenance, ratification and quality;
- Koordynator as the executive Brain;
- complete task portfolio;
- departments;
- dynamic Role Contracts;
- Recruitment for missing capabilities;
- capability/executor registry;
- execution DAG;
- candidate generation;
- independent verification;
- best-verified candidate comparison;
- self-improvement and self-healing;
- security and authorisation boundaries;
- adapters to Hermes, OpenCode, Playwright, GitHub, OmniRoute, Vault and existing runtime;
- Control API;
- Corporation UI;
- durable receipts and audit history.

## 2. Canonical hierarchy

```
OWNER / HUMAN WILL
        |
        v
HARMONIA
Constitution / admissibility / mandate / truth boundaries
        |
        v
HLL
Internal Corporation language:
truth + provenance + evidence + conflict + ratification + allowedBrainActions
        |
        v
KOORDYNATOR / BRAIN
Portfolio + planning + prioritisation + delegation + Recruitment + success control
        |
        v
CORPORATION
Departments + Role Contracts + Tasks + Execution + Verification + Products
        |
        +-- Internal Development
        +-- Product
        +-- Security
        +-- Operations
        +-- HR / Recruitment
        +-- Product departments
                |
                v
        HARMONIA LEGAL PLATFORM
        Corporation product
```

## 3. Terminology that must not drift

### Harmonia
The constitutional order. Harmonia determines admissibility, truth boundaries,
ratification and which Brain actions are allowed. Harmonia is not a department.

### HLL
HLL already exists in Harmonia Legal. It is the **internal language of the Corporation**.
Koordynator must not create a second HLL implementation.

Corporate tasks, recruitment, role contracts, delegation, security findings,
self-improvement incidents and execution results are represented through HLL.

### Koordynator / Brain
The executive decision-maker inside the constitutional mandate. It owns the full
portfolio and decides how work should reach a concrete success condition.

### Corporation
The organizational and execution system operated by Koordynator.

### Harmonia Legal Platform
A product built by the Corporation. It is not Harmonia-the-Constitution.

## 4. Non-negotiable invariants

1. An unratified proposition cannot silently become canonical corporate truth.
2. Koordynator may execute only actions present in `allowedBrainActions`.
3. External/privileged effects require the relevant authorisation in addition to HLL permission.
4. Missing capability creates a Recruitment need, not an improvised prompt-agent.
5. A recruited Role Contract becomes active only if a real healthy executor can satisfy its capability/effect/tool ceiling.
6. Dynamic organizational roles must not be forced into the legacy five-value `TaskRole` enum.
7. Code self-repair must eventually use isolated ephemeral git worktrees, never the operator's dirty worktree.
8. A repair is not successful until the relevant independent verification passes.
9. Candidate selection means best **verified** candidate among available candidates, not first working answer.
10. No automatic secret scraping, paid fallback activation, OAuth consent, billing change, destructive action, production deployment or protected merge.
11. All material autonomous actions produce durable evidence/receipts.
12. The legacy runtime stays available until the v2 path proves parity plus the new gates.

## 5. Current v2 implementation

Current modules on `feature/corporation-kernel-v2`:

```
src/corporation/domain.ts
src/corporation/ports.ts
src/corporation/hll.ts
src/corporation/file-store.ts
src/corporation/capability-registry.ts
src/corporation/planner.ts
src/corporation/comparator.ts
src/corporation/kernel.ts

tests/corporation-kernel-v2.test.ts
docs/CORPORATION_KERNEL_V2.md
docs/CORPORATION_LIVING_SPEC.md
docs/CORPORATION_RECOVERY_MANIFEST.json
```

Implemented:

- Corporation v2 domain independent from legacy TaskRole;
- HLL port boundary;
- durable Corporation snapshot;
- durable event log;
- constitutional task gating;
- dynamic capability registry;
- capability gap detection;
- HLL-backed Recruitment;
- HR Role Contract activation;
- executor ceiling enforcement;
- deterministic baseline planning;
- HLL-backed delegation;
- best-verified candidate comparator;
- Pareto filtering;
- hard correctness/security thresholds;
- tests for ratification, recruitment, executor ceilings and candidate comparison.

## 6. Self-improvement target architecture

Self-Improvement is not the Brain. It becomes a sensing and repair subsystem feeding
the Corporation.

```
OBSERVE
  |
  v
INCIDENT / OPPORTUNITY
  |
  v
HLL statement + evidence
  |
  v
CORPORATE TASK
  |
  v
ROOT CAUSE ANALYSIS
  |
  v
CANDIDATE GENERATION
  |---- candidate A
  |---- candidate B
  |---- candidate C
  |
  v
ISOLATED EXECUTION
  |
  v
INDEPENDENT VERIFICATION
  |
  v
COMPARATOR / PARETO
  |
  v
BEST VERIFIED CANDIDATE
  |
  v
CANARY / REGRESSION WINDOW
  |
  +---- FAIL -> rollback + next candidate
  |
  v
PROMOTE
  |
  v
LEARN / SKILL VERSION
```

The existing Self-Improvement Supervisor is useful source material for:

- incidents;
- repair leases;
- bounded retry;
- receipts;
- pause/resume;
- safe onboarding;
- provider opportunities.

It is not the final autonomous reasoning architecture.

## 7. Current major bottlenecks

### A. Production HLL bridge
The v2 kernel has `HllPort`, but it still needs the production adapter to the
authoritative HLL already present in Harmonia Legal.

### B. Execution isolation
Legacy `TaskExecutionRunner` works in the current project worktree and uses
`git add -A`. It must not become the autonomous code-repair executor.

Target: ephemeral worktree per candidate.

### C. Executor adapters
The Corporation needs capability-based adapters for real workers rather than
hard-coded organizational roles.

Initial adapters:

- Hermes;
- OpenCode;
- Playwright;
- independent Auditor;
- release/deploy executor;
- Git/GitHub;
- OmniRoute;
- Vault.

### D. Candidate Generator
Comparator exists, but the kernel still needs a generator capable of producing
multiple materially different repair/implementation strategies.

### E. Independent Verifier
Verification must be independent from the candidate creator and must produce
machine-readable evidence.

### F. Self-Improvement ingestion
Incidents need to become HLL-backed Corporate Tasks automatically.

### G. Control API and Corporation UI
The current kernel is intentionally side-effect-light and UI-independent.

## 8. Migration plan

### Phase 1 - Pure kernel
Status: **STARTED / CI GREEN**

- domain;
- HLL port;
- state/events;
- capabilities;
- recruitment;
- planner;
- comparator.

### Phase 2 - Truth integration

- production adapter to Harmonia Legal HLL;
- canonical write barrier;
- cache for already-ratified stable statements;
- fast/normal/constitutional HLL paths.

### Phase 3 - Execution substrate

- ephemeral worktree manager;
- execution leases;
- executor registry adapters;
- independent verifier;
- rollback receipts.

### Phase 4 - Autonomous problem solving

- incident ingestion;
- root-cause model;
- candidate generator;
- parallel candidate execution where safe;
- comparator;
- canary/regression observation;
- skill/playbook promotion.

### Phase 5 - Corporate organization

- department creation;
- department charters through HLL;
- HR Recruitment workflow;
- reusable Role Contract catalogue;
- multi-department task DAG;
- portfolio priority/dependency scheduler.

### Phase 6 - Product integration

- Control API;
- Corporation screen;
- Tasks migration bridge;
- Providers/Self-Improvement integration;
- Chat/Corporation command surface.

### Phase 7 - Legacy retirement

Legacy orchestration may be removed only after:

- functional parity;
- all legacy verification remains green;
- v2 constitutional tests pass;
- worktree isolation passes;
- rollback tests pass;
- external authorisation gates pass;
- selected live workflows run through v2 successfully.

## 9. Recovery / reconstruction

If implementation context is lost:

1. Open repository `nikodemklasik-code/koordynator`.
2. Inspect branch `feature/corporation-kernel-v2`.
3. Read this file first.
4. Read `docs/CORPORATION_KERNEL_V2.md`.
5. Read `docs/CORPORATION_RECOVERY_MANIFEST.json`.
6. Inspect all files under `src/corporation/`.
7. Run the Corporation v2 tests.
8. Check PR #73 and its CI.
9. Continue from the first unfinished migration phase.
10. Do not reconstruct HLL inside Koordynator; connect to the authoritative HLL in Harmonia Legal.

## 10. Definition of architectural success

The Corporation architecture is considered operational when an input goal can travel
through this entire chain without manual glue:

```
goal / incident / opportunity
  -> HLL proposition
  -> ratification
  -> portfolio task
  -> dependency analysis
  -> role resolution
  -> Recruitment if required
  -> execution DAG
  -> candidate generation
  -> isolated execution
  -> independent verification
  -> best verified candidate
  -> authorisation gate where required
  -> delivery
  -> post-delivery observation
  -> HLL execution result
  -> durable SUCCESS receipt
```

That, not the existence of individual classes or UI panels, is the target.
