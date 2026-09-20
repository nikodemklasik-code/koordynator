# Corporation Self-Audit: Local HLL Truth Engine Error

Date: 2026-09-20  
Status: CORRECTED IN BRANCH / PREVENTION RULE ADDED

## Incident

During Corporation Kernel v2 hardening, Koordynator implemented
`src/corporation/hll-stage-protocol.ts` as a local TypeScript protocol that:

- precomputed an `expectedFragment`;
- synthesized a local `HLL_computed` from trace;
- compared expected/computed digests;
- treated exact match as a local PASS;
- allowed that PASS to mint the next stage capability lease.

The implementation was internally tested and CI was green.

The architecture was nevertheless wrong.

## Why this is the exact class of error the product exists to prevent

The system is being built to prevent an actor from:

1. acting on an incomplete understanding of the authoritative semantic state;
2. converting its own interpretation into canonical truth;
3. bypassing provenance/genealogy of a decision;
4. confusing a locally consistent result with an authoritative result;
5. creating authority from its own output.

That is precisely what happened at architecture level.

The implementation was created before the full existing HLL Engine contract,
production truth bridge, K1/K2 write-barrier hardening and VERA negative invariants
had been mapped into one authoritative model.

The local implementation therefore duplicated semantic authority instead of
remaining a consumer of HLL.

## Violated design invariants

The change violated these intended invariants:

```
one HLL authority / protocol
many consumers
zero local truth shortcuts
```

```
worker declaration != execution truth
```

```
truth != permission_to_act
```

and, most importantly:

```
Koordynator may reason and choose inside Harmonia/HLL,
but it may not manufacture the semantic space in which its own choice is judged.
```

## Root cause

The proximate cause was incorrect sequencing:

```
user architectural clarification
  -> local interpretation
  -> implementation
  -> tests
```

instead of:

```
user architectural clarification
  -> retrieve authoritative source
  -> map existing semantics
  -> identify actual gap
  -> conformance specification
  -> implementation
  -> adversarial tests
```

The deeper cause was confusing:

- Blind Execution transport;
- deterministic execution verification;
- HLL semantic interpretation;
- Harmonia ratification;
- VERA effect authority.

Those are separate constitutional responsibilities.

## Correction applied

The following files were removed:

```
src/corporation/hll-stage-protocol.ts
tests/corporation-hll-blind-stage.test.ts
```

They were replaced by:

```
src/corporation/blind-stage-execution.ts
tests/corporation-blind-stage-execution.test.ts
```

The replacement module:

- restricts executor knowledge;
- binds task/stage/executor/capability lease;
- records deterministic ordered trace evidence;
- produces an ExecutionEvidenceBundle;
- detects trace tampering;
- does NOT synthesize HLL truth;
- does NOT decide PASS/FAIL semantic status;
- does NOT ratify;
- does NOT mint the next-stage lease.

The next-stage lease must come from the authoritative HLL/VERA boundary after
semantic interpretation and authority checks.

## Correct constitutional boundary

```
Product / Project Purpose
        ↓
GOAL
        ↓
Harmonia / HLL defines admissible semantic space
        ↓
Koordynator / Brain chooses inside that space
        ↓
Blind Stage receives minimum necessary knowledge
        ↓
Execution
        ↓
Trace + Artifacts + Effects + Evidence
        ↓
ExecutionEvidenceBundle
        ↓
AUTHORITATIVE HLL ENGINE
        ↓
ontology / relations / grounding / provenance / temporality /
contradiction / computed facts / K1 / K2
        ↓
Harmonia decision
        ↓
VERA capability/effect authority
        ↓
next-stage lease or BLOCK
```

## Prevention rule

Before any future change that touches:

- HLL semantics;
- truth state;
- ratification;
- admissibility;
- canonical write;
- capability authority;
- effect permission;
- verification semantics;
- learning promotion;
- project/product GOAL semantics;

the implementation sequence is mandatory:

1. inspect the authoritative HLL/VERA source;
2. cite the exact existing primitive/invariant;
3. state whether the requested feature is already present, partially present or absent;
4. create a semantic mapping/conformance requirement;
5. implement only the missing adapter/extension;
6. test against adversarial negative cases;
7. forbid local substitutes for an existing authority.

A green local test suite is not evidence that the architecture is constitutionally
correct.

## Learning Memory classification

Failure class:

```
ARCHITECTURAL_AUTHORITY_DUPLICATION
```

Fingerprint:

```
local-component-reimplements-authoritative-semantic-layer
```

Do not repeat:

- do not infer missing HLL semantics from a user description when authoritative HLL source exists;
- do not let Koordynator mint semantic PASS for its own execution protocol;
- do not equate digest equality with HLL truth;
- do not issue future authority from a local execution module;
- do not treat green CI as semantic conformance.

Verified correction criterion:

```
Blind execution layer emits evidence only.
Authoritative HLL/VERA remains the sole path to semantic ratification and new authority.
```
