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
src/corporation/organization.ts
src/corporation/knowledge.ts
src/corporation/quality-control.ts
src/corporation/provider-fabric.ts
src/corporation/communication.ts

tests/corporation-kernel-v2.test.ts
tests/corporation-organization-qc-provider.test.ts
tests/corporation-communication.test.ts
docs/CORPORATION_KERNEL_V2.md
docs/CORPORATION_LIVING_SPEC.md
docs/CORPORATION_COMMUNICATION_MAP.md
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
- full corporate department catalogue and management hierarchy;
- stage-scoped knowledge ledger and handoff packages;
- sovereign multi-path Quality Control gates;
- Provider Fabric with single/fallback/ensemble/role-split/cross-check strategies;
- interdepartmental communication dependency graph;
- cross-cutting QC/Security/Legal/Finance/Risk observers;
- tests for ratification, recruitment, executor ceilings, candidate comparison, organization, QC, provider resilience and communication routing.

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


## 11. Full corporate operating model

Corporation v2 is not limited to engineering. The target organizational model is a
full corporate ecosystem with dedicated department screens and a durable hierarchy.

Initial constitutional department catalogue:

- CEO Office;
- Strategy & Portfolio;
- Product;
- Marketing;
- Sales & Business Development;
- Legal;
- HR & Recruitment;
- Finance;
- Production & Engineering;
- Testing & Verification;
- Quality Control;
- Security;
- Operations & Reliability;
- Internal Development;
- Research & Intelligence;
- Data & Analytics;
- Customer Success & Support;
- Procurement & Vendor Management;
- Compliance & Risk.

The catalogue is extensible. A new department is created only for a durable
responsibility boundary and remains subject to HLL/constitutional ratification.

Each department has its own screen and organizational tree:

```
CEO / Department Head
        |
        v
Director(s)
        |
        v
Manager(s)
        |
        v
Team Lead(s)
        |
        v
Agent(s)
```

Organizational rank is separate from execution provider. A Director, Manager, Lead
or Agent is a corporate position backed by a Role Contract; the actual executor can
be Hermes, OpenCode, another model/provider, a deterministic tool, a human or a
future local worker.

## 12. Quality Control as a cross-corporate control function

Quality Control is a dedicated independent department and a cross-cutting gate.

QC is not above Harmonia Constitution, but operational departments cannot override
a failed mandatory QC gate.

For material work, QC evaluates stage evidence and closure using multiple
independent verification paths.

A mandatory gate must not depend only on one paid or external verification source.

The default sovereignty rule is:

```
PASS requires:
- enough passing paths;
- enough independent verification groups;
- at least one non-metered passing path;
- at least one non-external/sovereign passing path.
```

Depending on risk, deterministic tests/static analysis/rule engines may also be
mandatory.

A paid provider may improve confidence, but if the only successful verification
requires a paid external provider, the result is INCONCLUSIVE rather than PASS.

## 13. Stage-scoped knowledge

Every material execution stage owns a knowledge package containing:

- inputs;
- assumptions;
- evidence;
- HLL decisions;
- risks;
- unresolved questions;
- outputs;
- acceptance criteria;
- handoff notes;
- provenance/evidence references.

The next stage receives a structured handoff rather than relying on prompt memory.
Material evidence, decisions and outputs should be ratified before a strict handoff.
Unresolved questions, missing evidence or unratified material knowledge can block
the handoff.

## 14. Provider Fabric: models, combos, tools and skills

Providers are replaceable capability suppliers, not architectural dependencies.

The Provider Fabric inventories capabilities, toolsets, skills, tool-calling,
structured output, vision, context, background execution, cost, health, rate limits,
external dependency and risk.

It may create SINGLE, FALLBACK_CHAIN, ENSEMBLE, ROLE_SPLIT and CROSS_CHECK
strategies. Cross-checking counts as independent only when provider-family diversity
is real.

Cost classes:

```
LOCAL
FREE
INCLUDED_CREDITS
SUBSCRIPTION
PAID_API
```

Paid providers can improve quality or capability, but a mandatory corporate closure
must have a non-paid or sovereign closure path.

## 15. Corporate sovereignty / external dependency policy

The Corporation must degrade gracefully when external services disappear.

Core functions remaining under corporate control include canonical state, HLL-facing
corporate records, portfolio, organization, Recruitment, Role Contracts, QC records,
stage knowledge, local/deterministic verification baseline, event history and
rollback metadata.

For every externally dependent critical process, architecture must define at least
one local deterministic substitute, local model/tool substitute, free independent
provider substitute, replay/static/rule substitute, explicit human/manual closure
path, or a safe BLOCKED state.

External unavailability never becomes fabricated PASS.

## 16. Interdepartmental communication and dependency graph

Departments do not communicate through unconstrained free-form chat. Material
communication travels through declared dependency edges.

Every dependency defines:

- sender department;
- receiver department;
- dependency kind;
- allowed message kinds;
- whether it blocks downstream execution;
- whether a Stage Knowledge Package is mandatory;
- whether HLL ratification is mandatory;
- whether QC has visibility;
- escalation department where applicable.

Dependency kinds:

```
BLOCKING     next stage cannot proceed without closure
CONTROL      mandatory review/control relationship
SERVICE      one department supplies capability/evidence to another
ADVISORY     informs a decision without blocking it
FEEDBACK     returns evidence/results without creating a circular blocking gate
INFORMATION  traceable non-blocking flow
```

Primary operating chains include:

```
CEO
  -> Strategy
  -> Product
  -> Production
  -> Testing
  -> QC
  -> Operations
```

Supporting evidence loops:

```
Product <-> Research
Product <-> Data
Sales -> Product
Customer Success -> Product
Operations -> Data -> Strategy
```

Commercial chain:

```
Product -> Marketing -> Sales
                         |
                         +-> Legal
                         +-> Finance
```

Vendor chain:

```
Procurement
   +-> Legal
   +-> Security
   +-> Finance
```

Engineering/control chain:

```
Product -> Production -> Testing -> QC
              |             |
              +-> Security  +-> evidence back to Production
              |
              +-> Operations after verified handoff
```

Self-development chain:

```
Internal Development
   +-> Testing
   +-> Security
   +-> QC
```

Critical escalation:

```
QC --------------------+
Security --------------+--> CEO Office
Finance ---------------+
Compliance & Risk -----+
```

Testing feedback to Production is deliberately FEEDBACK rather than a reverse
BLOCKING edge. This prevents deadlocked circular gates while preserving mandatory
evidence.

Material HANDOFF messages require a Stage Knowledge Package. CONTROL/BLOCKING
communication requires HLL-ratified state before routing.

Cross-cutting observers:

- QC observes material handoffs, quality gates, approvals and material decisions;
- Security observes high-risk and incident communication;
- Legal observes legally material external effects;
- Finance observes spend/vendor commitments;
- Compliance & Risk observes material risk/control decisions.

Each department screen must expose:

- inbound dependencies;
- outbound dependencies;
- active blocking messages;
- pending acknowledgements;
- cross-cutting observers;
- escalations;
- Stage Knowledge Packages received/sent;
- communication history for the relevant task/stage.

The source model is `src/corporation/communication.ts`. No cross-department material
flow should be executable unless its dependency is declared or a new dependency has
been constitutionally introduced.
