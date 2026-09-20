# Corporation Architecture — Harmonia Constitution + HLL + Koordynator

Status: architecture contract for `feature/corporate-orchestrator`

## 1. Canonical hierarchy

```
OWNER / HUMAN WILL
        │
        ▼
HARMONIA CONSTITUTION
constitutional order, admissibility, mandate, truth boundaries
        │
        ▼
HLL
the Corporation's internal language for truth, provenance, conflict,
ratification, decision evidence and allowed Brain actions
        │
        ▼
KOORDYNATOR / BRAIN
executive planning, prioritisation, delegation, recruitment,
department creation, execution strategy and success control
        │
        ▼
CORPORATION
departments, role contracts, recruitment, task portfolio,
execution plans, verification, products
        │
        ├── Internal Development
        ├── Product
        ├── Security
        ├── Operations
        ├── HR / Recruitment
        └── Product departments
                 │
                 ▼
        Harmonia Legal Platform
        (product, not the Constitution)
```

## 2. HLL already exists in Harmonia Legal

Koordynator MUST NOT create a second HLL implementation.

The Corporation consumes the authoritative HLL/Harmonia engine through a narrow
`CorporateHllPort`. HLL is the internal corporate language used to keep claims,
decisions and execution evidence traceable and to prevent unratified propositions
from silently becoming canonical truth.

The adapter boundary exists in Koordynator only because the Corporation needs to
speak HLL. Syntax, semantics, ratification rules and constitutional logic remain
owned by Harmonia/HLL.

## 3. What HLL means inside the Corporation

Every material corporate object is represented as or backed by an HLL statement:

- task proposition,
- department charter,
- role contract,
- recruitment request,
- delegation decision,
- security finding,
- self-improvement incident,
- execution result,
- product decision.

An HLL statement carries at minimum:

```
subject
proposition
payload
provenance
evidence_refs
requested_brain_actions
fingerprint
```

The HLL engine returns a decision carrying:

```
truth_state
verdict
reasons
allowed_brain_actions
required_authorisations
canonical_record
canonical_fingerprint
```

Koordynator may plan or execute only actions present in
`allowed_brain_actions` for a ratified statement.

## 4. Separation of powers

### Harmonia Constitution

Harmonia is the constitutional order. It answers questions such as:

- is the proposition admissible?
- what truth state may it have?
- is provenance sufficient?
- is there an unresolved conflict?
- what Brain actions are constitutionally permitted?
- what requires external authorisation?
- may the canonical state be written?

Harmonia does **not** micromanage execution strategy.

### HLL

HLL is the language used internally by all departments and the Brain.

HLL is not a department, agent or product feature. It is the common semantic
protocol by which the Corporation keeps quality and truth coherent.

### Koordynator / Brain

Koordynator is the executive authority within the constitutional mandate.

It owns the complete task portfolio and decides:

- what must be done,
- in what order,
- dependencies,
- priority,
- departments,
- roles,
- recruitment,
- execution phases,
- verification strategy,
- when the success definition has actually been met.

It cannot promote its own unsupported assumption to canonical truth and cannot
expand its own constitutional authority.

### Product governance

Business/product judgement is separate from constitutional truth.

Product departments decide:

- customer value,
- law-firm usefulness,
- roadmap fit,
- duplication,
- product cost/benefit,
- sequencing of product features.

Those judgements are expressed in HLL so their provenance and status remain
traceable, but they are not confused with the Constitution itself.

## 5. Corporate operating loop

```
INPUT / GOAL / INCIDENT / OPPORTUNITY
        │
        ▼
HLL STATEMENT + PROVENANCE
        │
        ▼
HARMONIA / HLL ASSESS + RATIFY
        │
        ├── BLOCK / CONTESTED / UNKNOWN
        │       └── revise, gather evidence, or escalate
        │
        ▼
allowed_brain_actions
        │
        ▼
KOORDYNATOR PLAN
        │
        ├── department selection
        ├── role selection
        ├── dependency graph
        ├── success definition
        └── verification plan
        │
        ▼
CAPABILITY GAP?
    │         │
   no        yes
    │         ▼
    │    RECRUITMENT
    │         │
    │         ▼
    │    HR drafts Role Contract in HLL
    │         │
    │         ▼
    │    HLL ratification + capability ceiling
    │         │
    └─────────┴──► DELEGATION
                     │
                     ▼
                  EXECUTION
                     │
                     ▼
                  RECEIPTS
                     │
                     ▼
             HLL execution statement
                     │
                     ▼
             VERIFY / SUCCESS / REPLAN
```

## 6. Recruitment

A missing role is a capability gap, not a reason for a random prompt.

Koordynator opens a Recruitment object. HR creates a persistent Role Contract.

A Role Contract defines:

- mission,
- department,
- required capabilities,
- allowed tools,
- mapped execution role,
- decision rights,
- success measures,
- risk,
- lifecycle/version,
- recruitment provenance.

The role contract must remain within the existing capability ceiling unless the
Owner explicitly authorises privilege expansion.

Recruitment itself is represented and ratified through HLL.

## 7. Departments

Departments are durable responsibility boundaries, not fixed hard-coded agents.

Initial departments:

- Internal Development
- Product
- Security
- Operations
- HR / Recruitment

Product-specific departments may be created as needed.

A department charter is also an HLL-backed corporate statement. Koordynator may
create a new department only when the constitutional decision allows
`corporation.create-department`.

## 8. Self-improvement integration

The Self-Improvement Supervisor is a sensor and safe local repair mechanism.

Its incidents and opportunities feed the corporate portfolio:

```
SELF-IMPROVEMENT INCIDENT
        ▼
HLL SELF_IMPROVEMENT statement
        ▼
Koordynator portfolio
        ▼
Internal Development / Security / Operations
        ▼
plan → roles → execute → verify
```

Safe deterministic runtime repairs may still be automatic when already
constitutionally allowed. Code changes, privilege expansion, external effects,
billing and secrets remain separately gated.

## 9. Canonical write barrier

No department and no worker may directly convert its own claim into canonical
corporate truth.

```
observation
   ▼
HLL statement
   ▼
Harmonia/HLL decision
   ▼
Koordynator decision
   ▼
canonical write barrier
   ▼
corporate canonical state
```

A task may exist as PROPOSED before ratification, but unratified data must not be
treated as factual support for later decisions.

## 10. External effects

Internal executive discretion and external authority remain separate.

Internal action:

```
action ∈ allowed_brain_actions
→ Koordynator may act
```

External action:

```
action ∈ allowed_brain_actions
AND valid external authorisation
→ external execution may start
```

External effects include, among others:

- sending messages or filings,
- creating third-party accounts,
- OAuth consent,
- API-key generation,
- billing/card changes,
- deployment,
- destructive changes,
- privileged merge/release,
- actions toward courts, customers or other third parties.

## 11. Product identity

`Harmonia` and `Harmonia Legal Platform` are not synonyms.

- **Harmonia** = constitutional order.
- **HLL** = the internal language used by the Constitution, Brain and Corporation.
- **Koordynator / Brain** = executive orchestration.
- **Corporation** = organizational system.
- **Harmonia Legal Platform** = a product created and maintained by the Corporation.

This distinction is architectural, not cosmetic.
