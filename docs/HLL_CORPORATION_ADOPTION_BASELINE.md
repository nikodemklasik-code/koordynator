# HLL Corporation Adoption Baseline

Status: HARDENING BASELINE / implementation gate  
Date: 2026-09-20

## 1. Purpose

Corporation v2 MUST NOT implement a simplified or incomplete local reinterpretation of HLL.

HLL is the constitutional semantic language for the whole Corporation. Koordynator is an executive client of that language, not an independent authority able to mint truth, confirmed relations, legal semantic state or execution authority.

This baseline records the hardened mechanisms already present across Harmonia Legal sources so that Corporation does not regress behind them.

## 2. Authoritative source snapshots inspected

### Harmonia-Legal-Platform

Repository: `nikodemklasik-code/Harmonia-Legal-Platform`

Production branch at inspection:

```
develop
a6f9c72bb0a49976f39d3128bb8e182ace98fe87
```

Relevant HLL reconciliation lineage:

```
work/hll-r25-reconcile-20260918
0870d97bae53c6868c407373a6354217fe4f27d4
```

This lineage is GREEN in `harmonia-legal-ci` and contains the production R25 HLL truth bridge.

### Harmonia-Legal K1/K2 write-barrier hardening

Repository: `nikodemklasik-code/Harmonia-Legal`

Branch:

```
claude/hll-write-barrier-fix
ee790c1a4b1a2e73bc6a6d40816af6e9d7ab7b9b
```

This branch contains two cardinal write-barrier fixes that are NOT present in the inspected Harmonia-Legal-Platform `develop` HLL engine.

The branch-wide CI is not green because the old repository static gate reports inherited Ruff debt. The K1/K2 mechanisms therefore MUST be transplanted as specifications/invariants and re-tested in the target runtime rather than treated as a blindly shippable branch.

## 3. HLL production-boundary hardening already present in Harmonia-Legal-Platform

Corporation MUST preserve these properties.

### HLL state is authoritative over confidence

Legacy confidence/evidence may support inference, but MUST NOT manufacture canonical truth.

```
confidence = 99
!=
CONFIRMED
```

Only an HLL-managed, validly bound CONFIRMED state may become the strongest factual classification.

Relevant lineage:

- `d2baee0` HLL-authoritative reasoning gate
- `74e7644` shared truth bridge authoritative for reasoning
- `0a540fb` runtime routed through shared truth boundary

### One shared truth boundary

Truth interpretation MUST NOT be reimplemented independently in multiple downstream modules.

The shared boundary validates HLL-managed facts and maps semantic state to downstream classifications.

Corporation equivalent:

```
one HLL authority / protocol
many consumers
zero local truth shortcuts
```

### Partial HLL state fails closed

If an object claims HLL governance but lacks its required bindings, it is invalid.

Examples:

- CONFIRMED without decision receipt -> BLOCK
- CONFIRMED without canonical record receipt -> BLOCK
- unknown HLL truth state -> BLOCK

### Canonical graph boundary is defensive

A downstream canonical graph MUST independently reject:

- HLL fact not CONFIRMED;
- HLL fact missing decision/write receipts.

Upstream correctness is not trusted merely because an upstream component said PASS.

### Semantic provenance is durable

HLL state is bound into provenance through:

- HLL version;
- Harmonia decision hashes;
- canonical record hashes;
- fact semantic hashes;
- aggregate semantic state hash.

A semantic change therefore becomes observable downstream.

### Fact ledgers are routed through HLL

R25 facts are enriched through HLL before becoming authoritative.

For textual facts:

```
SOURCE -> EVIDENCE -> exact verified QUOTE -> FACT_CANDIDATE
```

A missing/invalid source hash or unverifiable quote blocks ratification.

Contrary evidence creates a blocking unresolved condition rather than being silently averaged away.

### HLL CI gate is blocking

Constitutional and R25 integration tests are a blocking CI stage, not a best-effort report.

## 4. K1: ratified truth must be unrepresentable through public ingress

The inspected Platform `develop` engine still permits public `add_proposition` / `replace_proposition` paths to receive a proposition containing `truth_state=CONFIRMED`.

The K1 hardening in `Harmonia-Legal@ee790c1` fixes this by:

1. defining ratified truth states explicitly;
2. rejecting them on every public proposition ingress path;
3. making CONFIRMED mintable only through a privileged writer path;
4. keeping the privileged promotion API inaccessible to ordinary callers.

Corporation invariant:

```
public object construction
CANNOT represent canonical ratified truth
```

There MUST be no public constructor, DTO, API request, plugin message or normal storage mutation that can place an object directly into a ratified canonical state.

## 5. K2: truth eligibility must be revalidated at the write barrier

Eligibility cannot be checked only during an earlier `ratify()` call.

Between assessment and commit:

- evidence may change;
- provenance may be revoked;
- time may expire;
- contradictions may appear;
- dependencies may become stale;
- policy/ontology/version may change.

K2 therefore requires three defenses:

1. an ineligible assessment can never surface candidate CONFIRMED;
2. decision construction refuses CONFIRMED unless `eligible_for_fact`;
3. CanonicalWriter re-runs the full eligibility predicate immediately before minting canonical CONFIRMED.

Corporation invariant:

```
old valid decision
!=
automatic current write permission
```

Every material canonical promotion is a fresh boundary check.

## 6. VERA machine-level invariants that HLL Corporation must reuse

Harmonia-Legal-Platform already contains a Rust VERA core whose negative matrix closes classes of authority and execution bugs. Corporation MUST reuse these ideas instead of recreating weaker string permissions.

### Capability authority

A capability is bound to:

- subject/actor;
- issuer;
- scope;
- rights;
- optional exact object;
- policy;
- not-before;
- expiry;
- trusted issuance time;
- revocation state.

Authorization rechecks actor, scope, right, object, expiry and revocation.

Caller-supplied time is not authoritative.

### Schema authority

The authority computes/validates schema hashes.

Caller-supplied schema identity is insufficient.

Wrong schema hash -> DENY.

### Object authority

A module cannot fabricate an ObjectRef and thereby create authority over an object the canonical store never ingested.

### Trust classes

Lower-trust modules MUST NOT hold high-authority rights such as:

- WriteCanonical;
- Promote;
- ExecuteEffect.

A manifest cannot self-promote its trust class.

### Explicit network policy

A module without a valid network policy is rejected.

Network authority is therefore structural, not prompt-based.

### Effect permits

External/material effects use permits that bind:

- actor;
- scope;
- effect kind;
- adapter;
- exact payload object;
- optional target hash;
- policy;
- expiry.

A permit is single-use.

The following MUST fail:

- permit replay;
- payload substitution after permit issue;
- adapter substitution after permit issue;
- target rebinding;
- expired permit;
- capability revoked after permit but before consume.

The capability is rechecked at consumption time.

### Receipt authority

A receipt ID is valid only when issued by the receipt authority.

The following MUST fail:

- forged PASS receipt;
- stale receipt bound to an old object version;
- duplicate receipt IDs used to fake verifier cardinality;
- self-check where separation of duties is required.

### Atomic versioning

Canonical writes use compare-and-swap semantics.

A stale writer fails atomically.

### Append-only audit

Audit is append-only and hash-chain verified.

Mutation/tampering is detectable.

### Dependency invalidation

When a source version changes, exact impact propagates through typed dependency edges.

The previous version remains historically addressable.

### Human approval is not truth

A human approval is a procedural act.

It MUST NOT substitute for:

- a truth proof;
- an independent verification receipt;
- a semantic ratification predicate.

### Module failure is not a legal/semantic negative result

```
FAILED / NOT_EVALUATED
!=
FALSE / REJECTED / LEGAL_FAIL
```

An infrastructure or model failure cannot be translated into a semantic conclusion.

## 7. Corporation-wide HLL target

HLL MUST be extended over the full Corporation graph, including at minimum:

- Department
- Position
- RoleContract
- AccountabilityContract
- Agent
- Model
- Provider
- Skill
- Capability
- CapabilityLease
- Task
- Stage
- Project
- Program
- Product
- PortfolioDecision
- Evidence
- Observation
- Hypothesis
- Antithesis
- Experiment
- Error
- Incident
- CandidateSolution
- Decision
- Approval
- Communication
- Budget/Cost commitment
- ExecutionIntent
- EffectPermit
- Execution
- Result
- VerificationReceipt
- QCDecision
- FailureMemory
- SolutionMemory
- InnovationSignal
- ExternalAction

These are not merely JSON records passed to an HLL gate. They must be semantically typed nodes/relations whose legal transitions are defined by HLL contracts.

## 8. Language and implementation diversity

The semantic protocol MUST be language-neutral.

No one implementation language is allowed to become the only enforcement layer for a critical invariant.

Target separation:

```
HLL semantic authority / canonical protocol
    -> language-neutral schemas + canonical hashes

TypeScript Koordynator
    -> executive planning/orchestration client
    -> CANNOT mint truth

Rust VERA/effect authority
    -> capability/effect/store/promotion enforcement
    -> CANNOT invent semantic truth

Python HLL reference/conformance engine
    -> epistemology/ontology/grammar reference behavior
    -> CANNOT bypass effect authority

independent verifier implementation(s)
    -> cross-language conformance and adversarial checks
```

Critical HIGH/CRITICAL transitions require at least one verification path that does not share the same implementation lineage as the producer.

Diversity is for independent failure modes, not decorative polyglot code.

## 9. Required HLL conformance suites before real executors

Corporation MUST NOT connect full autonomous write/email/browser/deploy executors until all of the following are green:

### HLL constitutional suite

- parser candidate-only;
- default BLOCK relation registry;
- grounding by fact class;
- provenance validity;
- temporal validity;
- contradiction/error blocking;
- version consistency;
- dependency cycle blocking;
- Brain cannot assign truth;
- truth != permission_to_act.

### K1/K2 adversarial suite

- public add CONFIRMED -> DENY;
- public replace CONFIRMED -> DENY;
- ineligible assessment never returns candidate CONFIRMED;
- forged signed CONFIRMED decision on ineligible subject -> writer DENY;
- eligibility revoked between decision and commit -> writer DENY;
- canonical ledger remains untouched after failed promotion.

### VERA negative matrix parity

At minimum preserve N01-N25 semantics:

- Unknown != False;
- caller hash ignored;
- wrong schema hash deny;
- cross-scope deny;
- fabricated capability deny;
- revoked capability deny;
- revoke-after-permit deny at consume;
- forged receipt deny;
- old-version receipt deny;
- duplicate receipt cardinality deny;
- proposer-as-checker deny;
- manifest spoof deny;
- low-trust canonical/effect rights deny;
- fabricated object deny;
- missing network policy deny;
- invocation replay cannot rebind;
- stale CAS atomic fail;
- typed dependency invalidation;
- audit tamper detection;
- permit replay deny;
- payload rebinding deny;
- adapter rebinding deny;
- caller time ignored;
- human approval != truth;
- module failure != semantic result.

## 10. Migration rule for Corporation

Do NOT copy the current Platform HLL engine verbatim into Koordynator.

The current Platform `develop` truth bridge is valuable and green, but its inspected `store.py`, `engine.py` and `epistemology.py` still lack K1/K2.

Corporation implementation order:

```
1. freeze semantic protocol
2. import HLL constitutional + production-boundary invariants
3. add K1/K2
4. align with VERA capability/effect authority
5. build cross-language conformance fixtures
6. represent Corporation objects/relations in HLL
7. run adversarial suites
8. only then connect real executors
```

Any implementation that does not meet this baseline remains `NOT_CONFORMANT` and may not become the Corporation truth/effect authority.


## 11. Blind Execution & Dynamic HLL Synthesis

HLL stage semantics are computed locally from execution evidence after the stage,
rather than disclosed to the executor before execution.

The executor receives only a **BlindStageAssignment**:

- exact task/stage identity;
- its own short-lived capability lease;
- direct stage inputs;
- an ordered list of deterministic micro-operations;
- the instruction and input fingerprints needed to bind the trace;
- an opaque commitment identifier/fingerprint.

It MUST NOT receive:

- `HLL_global`;
- the hidden expected local HLL fragment;
- the commitment nonce;
- semantic targets that are not required to perform the micro-operation;
- future-stage knowledge.

Authority-side state contains a private, pre-execution commitment:

```
PrivateStageCommitment {
  taskId
  stageId
  executorId
  capabilityLeaseId
  expectedFragment
  commitmentNonce
  commitmentFingerprint
}
```

The expected fragment is committed before execution. The nonce prevents the public
commitment fingerprint from becoming a useful low-entropy oracle for guessing the
hidden target.

The executor performs the stage and a trusted trace writer records an ordered,
hash-chained execution trace. Each trace event binds:

- task;
- stage;
- element;
- operation;
- executor;
- capability lease;
- instruction fingerprint;
- input fingerprint;
- output fingerprint;
- effect fingerprints;
- evidence fingerprints;
- previous trace-event fingerprint.

After execution:

```
HLL_computed_K = f_HLL(BlindStageAssignment, Trace_K)
```

The computed fragment is normalised to semantic content and compared against the
authority-side committed fragment:

```
semantic(HLL_computed_K) == semantic(HLL_expected_K)
```

Only an exact semantic match produces a PASS validation receipt.

A PASS validation receipt may unlock the next stage by minting a new
`CapabilityLeaseReceipt`. A FAIL cannot mint the next lease.

The initial reference implementation lives in:

```
src/corporation/hll-stage-protocol.ts
tests/corporation-hll-blind-stage.test.ts
```

### Composition into the global graph

The executor does not see the global graph.

The constitutional flow is:

```
HLL_global(t)
  + private StageCommitment_K
  -> BlindStageAssignment_K
  -> execution
  -> Trace_K
  -> HLL_computed_K
  -> Harmonia validation
  -> PASS only
  -> canonical local-fragment promotion
  -> HLL_global(t+1)
  -> CapabilityLease_(K+1)
```

Thus local HLL is **derived from what happened**, not supplied by the worker as a
declaration.

### Determinism boundary

Exact hidden-fragment equality is permitted only for stages whose semantic result
can genuinely be precommitted and deterministically reconstructed.

Creative/generative/model-dependent work MUST NOT be falsely labelled deterministic.
Such work produces a candidate artifact/fragment and enters independent verification,
falsification and QC. It cannot obtain PASS merely because an LLM output looks
similar to an expected answer.

### Security boundary

Blind execution materially reduces target-shaping and prompt-injection surface, but
the architecture MUST NOT claim that the risk is mathematically zero.

Predefinition alone does not make a trace unforgeable.

For material stages the trace writer must be outside the worker's authority and
bound to:

- capability lease;
- executor identity;
- ordered sequence;
- previous-event digest;
- actual artifact/effect evidence;
- trusted time where relevant.

Application-level hash chaining is tamper-evident, not hardware attestation. Higher
risk levels may require independent OS/runtime observation, signed receipts,
sandbox-level effect interception, or hardware-backed attestation.

The invariant is therefore:

```
worker declaration != execution truth
trusted trace + artifacts + deterministic synthesis + HLL validation = admissible evidence
```

## 12. Stage knowledge minimisation

Knowledge is provided by least-knowledge principle.

Each stage receives only the knowledge necessary to perform its contract. Knowledge
packages are stage-scoped and capability-scoped.

A later stage may receive ratified outputs of an earlier stage, but not the hidden
commitment used to judge that earlier stage.

No stage is entitled to the global HLL merely because it participates in the same
project.

Knowledge visibility is therefore a capability in its own right and must eventually
be enforced by the same authority/effect substrate as filesystem, network, secret,
external-send and canonical-write rights.
