# HLL Corporation Semantic Map

Status: IMPLEMENTATION CONTRACT v1  
Date: 2026-09-20

## Purpose

This map prevents Corporation from inventing a second HLL or a second effect authority.

The implementation reuses the mechanisms already present on
`nikodemklasik-code/Harmonia-Legal-Platform@develop`:

- `product/r25/src/harmonia_et_masterpiece/core/hll_truth_bridge.py`
  for the shared downstream truth-boundary pattern;
- `product/r25/src/hll_engine/*` for HLL ontology, RelationRegistry,
  epistemology, Brain decisions and canonical records;
- `core/hlp-vera/*` plus `composition/core_bridge_protocol.json`
  for capability, receipt, CAS, audit and effect authority;
- `composition/effect_execution_sequence.json` for consume-before-adapter
  material-effect execution.

The Corporation extension adds domain mapping and K1/K2 hardening. It does not
replace those authorities.

## Authority split

| Question | Authority | Corporation rule |
|---|---|---|
| What does this evidence mean? | Python HLL / Harmonia | Koordynator submits a candidate statement only |
| Is a proposition eligible for CONFIRMED? | HLL epistemology | no local boolean/confidence shortcut |
| May canonical CONFIRMED be written now? | HLL CanonicalWriter with K2 | eligibility is rechecked at commit |
| Which admitted Brain action is chosen? | Koordynator / Brain | only from HLL allowed actions |
| Does an actor have execution authority? | Rust VERA T0 | capability is actor/scope/right/object/policy/time bound |
| May this exact external/material effect execute? | Rust VERA T0 | single-use effect permit binds adapter/payload/target/policy |
| Did the downstream consumer receive canonical HLL truth? | shared truth boundary | exact decision + canonical record receipts are reverified |

Therefore:

```
HLL truth != Brain choice != VERA execution authority
```

## Identity model

A Corporation object and a proposition about that object are different things.

```
stable Corporation entity
    HLLNODE(class, corporate_id)

statement-specific proposition
    HLLPROP(statement_id)
        -> entity_ids[0] = stable Corporation entity
```

This allows two observations/updates about the same Task, Role or Project to
remain separate propositions while preserving one semantic referent. Statement
identity must never be used as object identity merely because hashes make that
mistake look respectable.

## Current semantic projections

All relation types below already exist in
`Harmonia-Legal-Platform@develop:product/r25/src/hll_engine/relations.py`.

| Corporation subject | Stable ID | Existing HLL relations used | Required semantic dependency |
|---|---|---|---|
| TASK | taskId | TASK PURSUES_GOAL GOAL; TASK BELONGS_TO PROJECT; PROJECT DECOMPOSES_TO TASK; PRODUCT CONTAINS_PROJECT PROJECT; PROJECT CONTRIBUTES_TO PRODUCT | explicit GOAL plus PRODUCT or PROJECT context |
| RECRUITMENT | recruitmentId | generic structured provenance; later RECRUITMENT LEADS_TO ROLE_CONTRACT | none beyond HLL grounding |
| ROLE_CONTRACT | roleId | DEPARTMENT OWNS_ROLE ROLE_CONTRACT; RECRUITMENT LEADS_TO ROLE_CONTRACT; ROLE_CONTRACT PERMITS_CAPABILITY CAPABILITY | referenced Recruitment must already be canonical CONFIRMED when recruitmentId is present |
| DELEGATION | planId, otherwise taskId-derived identity | DELEGATION ASSIGNS TASK; TASK DECOMPOSES_TO STAGE | referenced Task must already be canonical CONFIRMED |
| CAPABILITY_LEASE | leaseId | CAPABILITY_LEASE AUTHORIZES_STAGE STAGE; CAPABILITY_LEASE LEASES_CAPABILITY CAPABILITY | authority still comes from VERA, never from this semantic record |
| EXECUTION | executionId | STAGE EXECUTED_AS EXECUTION | execution permission remains VERA |
| EXECUTION_RESULT | resultId / executionReceiptId | EXECUTION PRODUCES_RESULT EXECUTION_RESULT | result is not verification |
| STAGE_TRACE | traceId / stageId | STAGE_TRACE EVIDENCES STAGE_COMMITMENT | trace is evidence, not truth |
| STAGE_FRAGMENT | fragmentId / stageId | STAGE_FRAGMENT DERIVED_FROM STAGE_TRACE | HLL COMPUTED grounding may bind confirmed dependencies |
| STAGE_VALIDATION | validationId / stageId | STAGE_VALIDATION VALIDATES STAGE_FRAGMENT | validation does not itself mint truth |

Other Corporation classes already admitted by the develop ontology use
SOURCE/EVIDENCE/VALUE structured grounding and the existing
`VALUE - DESCRIBES -> CLASS` relation. New cross-object semantics require an
existing RelationRegistry contract or an explicit HLL extension. The adapter
must not improvise a relation because a field name happens to look persuasive.

## HLL ingress and canonical write

The live path is:

```
Koordynator HllStatement
  -> stateful CorporationHllAuthority
  -> SOURCE / EVIDENCE / VALUE / stable Corporation entities
  -> existing RelationRegistry + ontology + grounding
  -> EpistemicAssessment
  -> HarmoniaDecision
  -> DecisionReceipt
  -> Brain chooses admitted RECORD/UPDATE_RECORD
  -> K2 re-assessment at CanonicalWriter
  -> private _confirm()
  -> CanonicalRecord
  -> HllRecordReceipt
```

K1 forbids public `add_proposition(CONFIRMED)` and
`replace_proposition(CONFIRMED)`.

K2 forbids a stale or forged earlier decision from becoming present canonical
truth after eligibility has changed.

The authority process is stateful. Assess and commit must hit the same authority
instance. Process loss is authority-state loss and fails closed.

## Downstream truth boundary

Corporation reuses the Platform pattern rather than trusting a persisted
`truthState: "CONFIRMED"` field.

`assertCanonicalHllFact()` verifies:

1. statement fingerprint;
2. Harmonia decision fingerprint and authority epoch;
3. canonical record receipt;
4. CONFIRMED state;
5. eligibility and absence of blockers.

Only then may a downstream Corporation gate treat the proposition as canonical
HLL truth.

Aggregate semantic provenance contains HLL version, decision hashes, canonical
record hashes, available semantic hashes, authority epochs and a deterministic
semantic-state hash.

## VERA material-effect path

The existing Platform VERA bridge is used as-is through a thin TypeScript
projection:

```
canonical HLL truth
  -> Brain action admitted by HLL
  -> exact owner/policy approval where required
  -> approval bound to exact VERA intent
  -> VERA effect.prepare
  -> single-use PermitId
  -> VERA effect.consume
  -> adapter.execute
  -> VERA effect.receipt
  -> audit
```

The approval binding includes the exact VERA intent, actor, capability,
policy, verified receipt IDs and requested TTL. Changing adapter, payload,
target or capability after approval therefore requires a new approval/permit
path.

A local `CapabilityLeaseReceipt` used for worktree/stage scoping is not a VERA
capability grant. A local `ActionDecisionReceipt` is not a VERA effect permit.

## Runtime clients

Koordynator production-facing clients:

- `src/corporation/hll-authority-adapter.ts`
- `src/corporation/hll-subprocess-transport.ts`
- `src/corporation/hll-truth-boundary.ts`
- `src/corporation/vera-authority.ts`
- `src/corporation/vera-subprocess-transport.ts`
- `src/corporation/runtime-authorities.ts`

Configuration:

- `CORPORATION_HLL_AUTHORITY_COMMAND_JSON`
- `CORPORATION_HLL_AUTHORITY_CWD` optional
- `CORPORATION_VERA_COMMAND_JSON`
- `CORPORATION_VERA_CWD` optional

No command is executed through a shell.

## Still deliberately blocked

This semantic/authority layer does not by itself enable autonomous external
effects. The following remain blocked until their own runtime gates are wired
and tested:

- real email/browser/deploy/payment/destructive adapters;
- hard OS/process/network sandbox for untrusted workers;
- trusted trace writer/attestation runtime;
- independent verifier runtime for HIGH/CRITICAL transitions;
- automatic next-stage capability issuance;
- protected merge/release executor;
- Corporation API/UI.

Green unit tests do not convert any of those absences into an implementation.
Software has tried this form of optimism before.
