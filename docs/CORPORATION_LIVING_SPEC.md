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
src/corporation/accountability.ts
src/corporation/delegation.ts
src/corporation/model-selection.ts
src/corporation/skills.ts
src/corporation/plugins.ts
src/corporation/failure-routing.ts
src/corporation/learning-memory.ts

tests/corporation-kernel-v2.test.ts
tests/corporation-organization-qc-provider.test.ts
tests/corporation-communication.test.ts
tests/corporation-contract-model-skill-memory.test.ts
tests/corporation-portfolio-innovation-growth.test.ts
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
- tests for ratification, recruitment, executor ceilings, candidate comparison, organization, QC, provider resilience and communication routing;
- strict Accountability Contracts with responsibility, confirmation and consequence rules;
- corporate-chain delegation with atomic/emergency direct fast paths;
- model selection from official capability evidence;
- task-specific skill binding within official model capability ceilings;
- stable plugin registry for replaceable providers/executors/verifiers/memory;
- strict separation of build/diagnostics/repair/verification/QC duties;
- durable Failure Memory and Solution Memory with recurrence and do-not-repeat knowledge;
- multi-product/program/project portfolio with constrained capacity allocation;
- Scientific Research & Innovation pipeline with explicit falsification criteria;
- Innovation Radar and pluggable novelty-source intake;
- Venture Studio/Product Incubation organizational layer;
- Growth & Channel Development with marketing policy, contacts, campaigns and gated outreach;
- Corporate Intelligence as an external-signal function.

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


## 17. Strict responsibility contracts and separation of duties

Every organizational role is backed by a Role Contract and an Accountability Contract.

The Accountability Contract defines:

- exact responsibility scope;
- explicitly forbidden scope;
- expected outputs;
- mandatory confirmations/evidence;
- consequences of failure;
- escalation targets;
- domain standards;
- risk class.

Default constitutional rule:

```
Builder builds.
Diagnostics diagnoses.
Repair repairs.
Verifier verifies.
QC controls quality.
Security handles security.
```

A Builder that encounters an error does not turn into a repair agent. It emits a
failure record and returns control. A separate Diagnostics unit analyses the problem,
a separate Repair unit creates the fix, an independent Verifier checks it, and QC
closes the gate.

A failed Repair is also not allowed to recursively repair itself. It returns to
Diagnostics/Escalation.

This protects focus, makes responsibility attributable and prevents one agent from
silently becoming author, debugger, reviewer and certifier of its own work.

## 18. Delegation policy: corporate chain with bounded fast paths

Default material work follows the organizational chain:

```
Koordynator
  -> Department Head
     -> Director
        -> Manager
           -> Lead
              -> Agent
```

Koordynator does not normally micromanage the concrete Agent. It assigns corporate
ownership to the correct department and Role Contract; the hierarchy decomposes and
delegates the stage.

Two bounded exceptions exist:

1. DIRECT_ATOMIC: a small atomic task may go directly to an Agent only when the
   relevant Role Contract pre-authorises direct execution. Department Head remains
   accountable.

2. EMERGENCY_DIRECT: P0 containment/diagnostics may bypass intermediate management
   to reduce response latency. The action still produces receipts and escalation
   evidence.

This hybrid model avoids both extremes: central micromanagement by Koordynator and
slow ceremonial routing of every trivial operation through five layers.

## 19. Model selection from official properties

AI model eligibility is determined from officially described properties:

- official provider documentation;
- official model cards;
- official API metadata.

No model is eligible merely because another model claims that it is good at a task.

Internal verified benchmarks may rank models that are already officially eligible,
but they cannot invent unsupported capabilities.

Selection sequence:

```
task requirements
  -> official capability eligibility
  -> tool/context/structured-output constraints
  -> officially declared strengths
  -> verified internal benchmark evidence
  -> provider/cost/resilience strategy
  -> selected model
```

This keeps model assignment evidence-backed while still allowing the Corporation to
learn which eligible models perform better in its own workloads.

## 20. Skill adaptation is a constitutional Koordynator capability

One of Koordynator's constitutive capabilities is adapting model skills to the task.

Skills are modular manifests with:

- capability coverage;
- required toolsets;
- compatible model families;
- incompatible models;
- risk;
- provenance/evidence;
- version.

Koordynator selects the model first, then binds a minimal task-specific skill set.

A skill may specialise or structure a model's work, but it may never expand beyond
the model's officially supported capability ceiling.

If skills cannot cover the task within that ceiling, Koordynator must select another
model, split the work, use another provider strategy, or create Recruitment. It must
not pretend that a prompt created a capability the underlying model does not have.

## 21. Plugin architecture over a durable core

Corporation v2 uses a durable constitutional core with replaceable plugins.

Stable core owns:

- Harmonia/HLL boundary;
- canonical corporate state;
- organization;
- Role Contracts;
- accountability;
- portfolio;
- task/stage identity;
- knowledge/provenance;
- communication graph;
- QC policy;
- authorisation;
- error/solution memory;
- audit/event history.

Replaceable plugins may provide:

- executors;
- AI providers/models;
- skill sources;
- verifiers;
- transports;
- authentication;
- storage implementations;
- UI extensions.

A plugin declares version, kind, capabilities, required kernel API, external
dependency and risk. The core does not make an external provider constitutionally
indispensable.

## 22. Failure Memory and Solution Memory

Corporate learning is split into two linked memories.

### Failure Memory

Failure Memory answers:

- what failed?
- where did it fail?
- under what environment/model/skill/provider context?
- what was the symptom?
- what was the root cause, if established?
- which attempts already failed?
- what must not be repeated?
- how often has this problem recurred?
- what evidence supports the record?

Failure records have durable fingerprints and recurrence counts. Repeated failures
are recognised as recurrence rather than rediscovered from zero.

### Solution Memory

Solution Memory answers:

- which verified solution addressed a given failure fingerprint?
- in which contexts does it apply?
- what prerequisites are required?
- which strategies, skills and model families were used?
- what independent verification exists?
- what are its contraindications?
- success/failure/regression history;
- observed money/token/latency cost;
- current version;
- whether it has been promoted into a reusable skill.

A solution is not remembered merely because it once produced PASS. Its reliability
changes as more verification evidence accumulates.

### Navigation

Before new diagnosis or candidate generation, Koordynator queries Failure Memory and
Solution Memory.

```
new failure
  -> fingerprint / error code / semantic match
  -> matching historical failures
  -> do-not-repeat knowledge
  -> historically verified candidate solutions
  -> current environment compatibility check
  -> candidate generation / comparison
```

Historical memory accelerates reasoning but never overrides current HLL, security,
QC or environment evidence.

The durable implementation starts in
`src/corporation/learning-memory.ts`.

## 23. Error ownership and escalation

Errors are first-class corporate objects, not text buried in logs.

A work failure records task, stage, originating unit, role, error code, summary,
evidence and whether it is security-relevant.

Default routing:

```
BUILD failure
  -> Diagnostics
  -> Repair
  -> Independent Verification
  -> QC

SECURITY-relevant failure
  -> Security
  -> Diagnostics
  -> Repair
  -> Independent Verification
  -> QC

REPAIR failure
  -> Diagnostics
  -> Escalation if required
  -> Independent Verification
  -> QC

VERIFICATION/QC failure
  -> Diagnostics / Escalation
  (control function does not mutate the artifact it controls)
```

This is the basis for learning, recurrence detection and reliable autonomous error
management.


## 24. HLL as prevention, diagnosis, verification and falsification

HLL is not only the language in which the Corporation records final truth. It is the
epistemic control layer used before, during and after material work.

Its corporate use covers four distinct functions:

1. **Prevention** - detect unsupported assumptions, provenance gaps, contradictions,
   mandate violations and invalid transitions before they enter canonical state.
2. **Diagnosis** - represent what failed, what is known, what is uncertain and which
   hypotheses could explain the failure.
3. **Verification** - determine whether evidence is sufficient to support a claim,
   handoff, execution result or quality conclusion.
4. **Falsification** - record evidence against a hypothesis and reject propositions
   that do not survive their stated falsification criteria.

This means HLL surrounds execution rather than merely signing the end result:

```
proposition
  -> HLL prevention
  -> execution / experiment
  -> HLL diagnosis when needed
  -> verification / falsification evidence
  -> HLL ratification or rejection
```

Koordynator manages work; HLL protects the epistemic quality of what Koordynator is
allowed to treat as true.

## 25. Multi-project Corporation and product formation

Corporation v2 is designed to operate multiple products, programs and projects at
the same time.

The portfolio model separates:

- **Product** - durable value proposition/customer problem;
- **Program** - coordinated strategic body of work;
- **Project** - bounded objective with departments, milestones, risk, capacity and
  success definition.

The portfolio scheduler must reason across the entire Corporation rather than one
task at a time:

```
many products
  -> many programs
  -> many projects
  -> dependencies
  -> shared department capacity
  -> portfolio priority
  -> allocation / deferral
```

New products may emerge while existing products continue operating. Product
formation is therefore a continuous corporate capability, not a one-time setup
activity.

The initial implementation is in `src/corporation/portfolio.ts`.

## 26. Scientific Research, Innovation and novelty absorption

The Corporation includes dedicated functions for:

- Scientific Research & Innovation;
- Innovation & Technology Radar;
- Venture Studio & Product Incubation;
- Corporate Intelligence.

The scientific path is explicitly falsifiable:

```
signal
  -> hypothesis
  -> falsification criteria
  -> experiment
  -> evidence for / against
  -> supported / falsified / inconclusive
  -> HLL
```

Innovation is not accepted because it is new or fashionable. It is absorbed only
after evidence and experiment establish that it is relevant enough to become
corporate knowledge, a process improvement, a skill, a project or a product
candidate.

The Innovation Radar accepts novelty signals from science, patents, standards,
regulation, provider documentation, model/software releases, repositories,
conferences, markets, competitors, communities, customers and internal experiments.

The pluggable novelty source layer is
`src/corporation/novelty-sources.ts`.

A source connector is replaceable. The Corporation tracks coverage, cost class,
external dependence and trust class. The novelty pipeline must not depend on one
commercial feed.

## 27. Venture Studio and product incubation

Verified opportunities may be transferred into Venture Studio.

Venture Studio is responsible for:

- idea portfolios;
- product hypotheses;
- prototypes;
- business-model experiments;
- evidence gathering;
- product candidate formation;
- handoff into Product when validation is sufficient.

A new product therefore follows a traceable path rather than appearing as an
unstructured side project:

```
novelty / customer problem / research result
  -> opportunity
  -> experiment
  -> Venture Studio
  -> QC / Legal / Finance as required
  -> Product candidate
  -> Product ownership
  -> Production / Growth
```

## 28. Real marketing and growth operations

Marketing and Growth are operating functions, not presentation-only dashboards.

The target system supports:

- durable marketing policy;
- market/channel research;
- contact discovery and evidence;
- channel opportunities;
- outreach campaigns;
- message artifacts;
- partnership sourcing;
- sales-channel experiments;
- funnel measurement;
- learning from campaign results.

External actions remain constitutionally separate from planning.

For example:

```
research contact
  -> verify relevance / legal basis
  -> campaign draft
  -> Legal review when required
  -> QC review
  -> Finance review when required
  -> external authorisation
  -> SEND_EMAIL / SEND_MESSAGE / follow-up
  -> receipt
  -> channel metrics
  -> Growth / Sales / Product learning
```

The first domain implementation is
`src/corporation/growth-operations.ts`.

The module deliberately blocks externally effective outreach when the required
authorisation is absent. Later email/contact connectors remain plugins rather than
core dependencies.

## 29. Source of novelty

The Corporation has a standing **Novelty Intake** function rather than relying on a
human remembering to check what changed.

Novelty sources may include:

- scientific publications;
- patents;
- standards;
- regulation;
- official provider/model documentation;
- software/model releases;
- repositories;
- conferences;
- market/competitor signals;
- communities;
- customer evidence;
- internal experiments.

Connectors ingest and deduplicate signals. Innovation Radar performs relevance and
novelty triage. Scientific Research performs testing/falsification where needed.
HLL determines what may become corporate truth.

This is the external absorption loop:

```
world
  -> source connectors
  -> novelty intake
  -> Corporate Intelligence / Innovation Radar
  -> Scientific Research if needed
  -> HLL
  -> Strategy / Venture Studio / Product / Internal Development
  -> execution
  -> measured outcome
  -> corporate learning memory
```

No single external source is trusted as the truth layer.


## 30. Hardening freeze: evidence beats flags

Corporation v2 is under a **hardening freeze** before real autonomous executors are
connected.

The governing safety rule is:

```
string / boolean / enum != proof
```

The following are not sufficient on their own:

```
approved = true
verified = true
truthState = RATIFIED
externalAuthorisationRef = "..."
independentGroup = "..."
material = false
priority = P0
```

Material authority now moves toward an evidence chain:

```
INPUT
  -> deterministic policy / HLL statement
  -> statement-bound DecisionReceipt
  -> exact-scope Approval / Capability Lease Receipt
  -> isolated execution
  -> ExecutionReceipt
  -> trusted independent VerificationReceipt
  -> QC Decision
  -> canonical or external effect
```

Current implemented hardening includes:

- statement fingerprint + decision fingerprint binding;
- authority ID/epoch and receipt expiry;
- exact payload/scope approval receipts;
- immutable Recruitment capability/effect/tool/decision-right ceiling;
- risk derived from real effects instead of trusting draft declarations;
- QC critical correctness/security/integrity/privacy/compliance failure blocking;
- verifier trust-root, independent-group and provider-lineage validation;
- candidate comparison from artifact/metrics-bound VerificationReceipts;
- materiality/high-risk/external-effect classification derived by policy;
- P0 emergency receipt requirement;
- exact provider/model claim binding for model selection;
- skill digest, publisher, trust root, permission, review and revocation checks;
- Solution Memory learning only from trusted independent VerificationReceipts;
- recipient-specific outreach approval and privacy/contact gates;
- append-only hash-chained CAS journal;
- atomic Corporation state + event commits when transactional store is wired;
- tamper-evident capability leases;
- ephemeral git worktree isolation substrate;
- adversarial safety-invariant tests.

## 31. Autonomous execution remains gated

Green domain tests do not authorise real side effects.

The following remain blocked from full Corporation v2 autonomy until their runtime
boundaries are complete:

- production HLL adapter;
- real executor adapters;
- hard process/network sandbox;
- no-secret execution environment;
- independent verifier runtime;
- rollback/promotion executor;
- browser send, email send, deploy and protected merge.

The worktree manager provides filesystem/git isolation for candidate branches, but
it is not by itself a complete process/network sandbox.

This distinction is deliberate: an isolated directory is not magical containment,
despite the recurring human temptation to rename a folder "sandbox" and consider
physics defeated.

## 32. Drift controls required before production autonomy

The production runtime must continuously detect:

- HLL/policy authority epoch drift;
- stale Decision/Approval receipts;
- provider capability and lineage drift;
- model evidence drift;
- Role Contract privilege drift;
- skill content/version/trust drift and revocation;
- verifier trust-root drift;
- learning-memory poisoning/regression;
- cross-project knowledge leakage;
- runtime state versus canonical journal divergence.

Any unresolved material drift produces BLOCKED/INCONCLUSIVE rather than PASS.


## 33. Blind stages as evidence producers, not truth authorities

Material execution stages do not receive the full corporate HLL graph.

Each stage receives only:

- direct input;
- bounded micro-operations required by its contract;
- the current stage capability lease;
- stage-scoped knowledge necessary to act;
- an opaque reference/fingerprint to the authoritative stage contract.

The stage executor produces trace, artifacts, effects and evidence.

It does **not** produce authoritative HLL truth and does not decide whether the
stage is semantically ratified.

```
BlindStage_K
  -> trusted Trace_K
  -> ExecutionEvidenceBundle_K
  -> authoritative HLL Engine
  -> computed semantic state
  -> Harmonia admissibility / falsification / ratification
  -> only then may authority mint the next lease
```

The product/project purpose and GOAL determine what the work is for. Harmonia/HLL
defines the legal semantic space. Koordynator/Brain chooses among permitted
strategies. The executor operates inside its much narrower task/role/capability
scope.

A deterministic micro-operation may have a hidden expected value used to verify the
operation itself, but digest equality is execution evidence, not an alternative HLL
truth engine.

The current transport implementation is
`src/corporation/blind-stage-execution.ts`.



## Deterministic multi-agent group-chat turns

Group-agent discussion MUST NOT use race scheduling or "first response wins".

For every group chat, the active participant set is frozen for the current round
and ordered deterministically by canonical alphabetic key:

```
NFKC(displayName).lowercase()
then participantId as tie-breaker
then UTF-8 byte order
```

The speaking sequence is cyclic:

```
A -> B -> C -> ... -> Z -> A -> B -> ...
```

Only the participant whose turn is current may publish the accepted turn.
A faster provider/model cannot jump the queue.

Membership changes are staged and become effective only at the next round boundary.
This prevents a late join from reordering an in-progress round.

Every accepted turn produces a hash-bound `GroupChatTurnReceipt` containing:

- conversation id;
- round;
- global turn number;
- participant id/name;
- frozen participant-snapshot hash;
- message fingerprint;
- previous turn receipt hash.

The queue therefore provides deterministic order and tamper-evident turn history.
It does not decide semantic truth; HLL remains the semantic authority.

Implementation:

```
src/corporation/group-chat-queue.ts
tests/corporation-group-chat-queue.test.ts
```
