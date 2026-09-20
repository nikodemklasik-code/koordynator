import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import {
  createBlindStageProtocol,
  createTraceEvent,
  issueNextStageLease,
  validateBlindStage,
  verifyTrace
} from "../src/corporation/hll-stage-protocol.js";
import { createCapabilityLeaseReceipt } from "../src/corporation/receipts.js";

function baseLease() {
  return createCapabilityLeaseReceipt({
    taskId: "CORP-BLIND-1",
    stageId: "STAGE-K",
    candidateId: "CANDIDATE-A",
    roleId: "ROLE-BUILDER",
    executorId: "executor-code",
    allowedCapabilities: ["code"],
    allowedEffects: ["fs.write"],
    allowedTools: ["fs.read", "fs.write"]
  });
}

function protocol() {
  return createBlindStageProtocol({
    taskId: "CORP-BLIND-1",
    stageId: "STAGE-K",
    executorId: "executor-code",
    capabilityLease: baseLease(),
    elements: [
      {
        elementId: "E1",
        order: 1,
        operationId: "normalize-input",
        instruction: "Normalize the supplied object using the frozen canonicalization rule.",
        input: { b: 2, a: 1 },
        expectedOutput: { a: 1, b: 2 },
        expectedEffects: [{ kind: "memory.write", target: "candidate-buffer" }],
        expectedEvidence: [{ kind: "canonicalization", rule: "v1" }]
      },
      {
        elementId: "E2",
        order: 2,
        operationId: "emit-artifact",
        instruction: "Write the normalized object to the isolated candidate artifact.",
        input: { a: 1, b: 2 },
        expectedOutput: "artifact:sha256:expected",
        expectedEffects: [{ kind: "fs.write", path: "candidate/result.json" }],
        expectedEvidence: [{ kind: "artifact-digest", value: "sha256:expected" }]
      }
    ]
  });
}

function goodTrace() {
  const { blindAssignment } = protocol();
  const first = createTraceEvent({
    sequence: 1,
    taskId: blindAssignment.taskId,
    stageId: blindAssignment.stageId,
    elementId: blindAssignment.elements[0]!.elementId,
    operationId: blindAssignment.elements[0]!.operationId,
    executorId: blindAssignment.executorId,
    capabilityLeaseId: blindAssignment.capabilityLeaseId,
    instructionFingerprint: blindAssignment.elements[0]!.instructionFingerprint,
    inputFingerprint: blindAssignment.elements[0]!.inputFingerprint,
    outputFingerprint: canonicalDigest({ a: 1, b: 2 }),
    effectFingerprints: [canonicalDigest({ kind: "memory.write", target: "candidate-buffer" })],
    evidenceFingerprints: [canonicalDigest({ kind: "canonicalization", rule: "v1" })],
    previousEventFingerprint: null,
    observedAt: new Date().toISOString()
  });
  const second = createTraceEvent({
    sequence: 2,
    taskId: blindAssignment.taskId,
    stageId: blindAssignment.stageId,
    elementId: blindAssignment.elements[1]!.elementId,
    operationId: blindAssignment.elements[1]!.operationId,
    executorId: blindAssignment.executorId,
    capabilityLeaseId: blindAssignment.capabilityLeaseId,
    instructionFingerprint: blindAssignment.elements[1]!.instructionFingerprint,
    inputFingerprint: blindAssignment.elements[1]!.inputFingerprint,
    outputFingerprint: canonicalDigest("artifact:sha256:expected"),
    effectFingerprints: [canonicalDigest({ kind: "fs.write", path: "candidate/result.json" })],
    evidenceFingerprints: [canonicalDigest({ kind: "artifact-digest", value: "sha256:expected" })],
    previousEventFingerprint: first.eventFingerprint,
    observedAt: new Date().toISOString()
  });

  return { blindAssignment, trace: [first, second] };
}

describe("Blind Execution & Dynamic HLL Synthesis", () => {
  it("does not expose the expected HLL fragment or commitment nonce to the executor", () => {
    const { blindAssignment, privateCommitment } = protocol();
    const visible = JSON.stringify(blindAssignment);

    expect(visible).not.toContain("expectedFragment");
    expect(visible).not.toContain("commitmentNonce");
    expect(visible).not.toContain(JSON.stringify(privateCommitment.expectedFragment));
    expect(blindAssignment.commitmentFingerprint).toBe(privateCommitment.commitmentFingerprint);
  });

  it("synthesizes local HLL from the deterministic execution trace and passes only on exact semantic match", () => {
    const fixture = protocol();
    const e1 = fixture.blindAssignment.elements[0]!;
    const e2 = fixture.blindAssignment.elements[1]!;
    const first = createTraceEvent({
      sequence: 1,
      taskId: fixture.blindAssignment.taskId,
      stageId: fixture.blindAssignment.stageId,
      elementId: e1.elementId,
      operationId: e1.operationId,
      executorId: fixture.blindAssignment.executorId,
      capabilityLeaseId: fixture.blindAssignment.capabilityLeaseId,
      instructionFingerprint: e1.instructionFingerprint,
      inputFingerprint: e1.inputFingerprint,
      outputFingerprint: canonicalDigest({ a: 1, b: 2 }),
      effectFingerprints: [canonicalDigest({ kind: "memory.write", target: "candidate-buffer" })],
      evidenceFingerprints: [canonicalDigest({ kind: "canonicalization", rule: "v1" })],
      previousEventFingerprint: null,
      observedAt: new Date().toISOString()
    });
    const second = createTraceEvent({
      sequence: 2,
      taskId: fixture.blindAssignment.taskId,
      stageId: fixture.blindAssignment.stageId,
      elementId: e2.elementId,
      operationId: e2.operationId,
      executorId: fixture.blindAssignment.executorId,
      capabilityLeaseId: fixture.blindAssignment.capabilityLeaseId,
      instructionFingerprint: e2.instructionFingerprint,
      inputFingerprint: e2.inputFingerprint,
      outputFingerprint: canonicalDigest("artifact:sha256:expected"),
      effectFingerprints: [canonicalDigest({ kind: "fs.write", path: "candidate/result.json" })],
      evidenceFingerprints: [canonicalDigest({ kind: "artifact-digest", value: "sha256:expected" })],
      previousEventFingerprint: first.eventFingerprint,
      observedAt: new Date().toISOString()
    });

    const validated = validateBlindStage({
      assignment: fixture.blindAssignment,
      privateCommitment: fixture.privateCommitment,
      trace: [first, second]
    });

    expect(validated.receipt.status).toBe("PASS");
    expect(validated.receipt.reasons).toEqual([]);
    expect(validated.computedFragment.elements).toHaveLength(2);
    expect(validated.computedFragment.traceRoot).toBe(second.eventFingerprint);
  });

  it("fails closed when the executor output differs from the hidden expected HLL fragment", () => {
    const fixture = protocol();
    const e1 = fixture.blindAssignment.elements[0]!;
    const e2 = fixture.blindAssignment.elements[1]!;
    const first = createTraceEvent({
      sequence: 1,
      taskId: fixture.blindAssignment.taskId,
      stageId: fixture.blindAssignment.stageId,
      elementId: e1.elementId,
      operationId: e1.operationId,
      executorId: fixture.blindAssignment.executorId,
      capabilityLeaseId: fixture.blindAssignment.capabilityLeaseId,
      instructionFingerprint: e1.instructionFingerprint,
      inputFingerprint: e1.inputFingerprint,
      outputFingerprint: canonicalDigest({ a: 1, b: 2 }),
      effectFingerprints: [canonicalDigest({ kind: "memory.write", target: "candidate-buffer" })],
      evidenceFingerprints: [canonicalDigest({ kind: "canonicalization", rule: "v1" })],
      previousEventFingerprint: null,
      observedAt: new Date().toISOString()
    });
    const second = createTraceEvent({
      sequence: 2,
      taskId: fixture.blindAssignment.taskId,
      stageId: fixture.blindAssignment.stageId,
      elementId: e2.elementId,
      operationId: e2.operationId,
      executorId: fixture.blindAssignment.executorId,
      capabilityLeaseId: fixture.blindAssignment.capabilityLeaseId,
      instructionFingerprint: e2.instructionFingerprint,
      inputFingerprint: e2.inputFingerprint,
      outputFingerprint: canonicalDigest("artifact:sha256:wrong"),
      effectFingerprints: [canonicalDigest({ kind: "fs.write", path: "candidate/result.json" })],
      evidenceFingerprints: [canonicalDigest({ kind: "artifact-digest", value: "sha256:wrong" })],
      previousEventFingerprint: first.eventFingerprint,
      observedAt: new Date().toISOString()
    });

    const validated = validateBlindStage({
      assignment: fixture.blindAssignment,
      privateCommitment: fixture.privateCommitment,
      trace: [first, second]
    });

    expect(validated.receipt.status).toBe("FAIL");
    expect(validated.receipt.reasons).toContain("HLL_LOCAL_FRAGMENT_MISMATCH");

    expect(() => issueNextStageLease({
      validationReceipt: validated.receipt,
      taskId: fixture.blindAssignment.taskId,
      stageId: "STAGE-K+1",
      candidateId: "CANDIDATE-A",
      roleId: "ROLE-VERIFIER",
      executorId: "executor-verifier",
      allowedCapabilities: ["verify"],
      allowedEffects: [],
      allowedTools: ["fs.read"]
    })).toThrow("HLL_STAGE_NOT_RATIFIED");
  });

  it("rejects missing, reordered or tampered trace events before HLL synthesis", () => {
    const fixture = protocol();
    const e1 = fixture.blindAssignment.elements[0]!;
    const first = createTraceEvent({
      sequence: 1,
      taskId: fixture.blindAssignment.taskId,
      stageId: fixture.blindAssignment.stageId,
      elementId: e1.elementId,
      operationId: e1.operationId,
      executorId: fixture.blindAssignment.executorId,
      capabilityLeaseId: fixture.blindAssignment.capabilityLeaseId,
      instructionFingerprint: e1.instructionFingerprint,
      inputFingerprint: e1.inputFingerprint,
      outputFingerprint: canonicalDigest({ a: 1, b: 2 }),
      effectFingerprints: [],
      evidenceFingerprints: [],
      previousEventFingerprint: null,
      observedAt: new Date().toISOString()
    });

    expect(() => verifyTrace(fixture.blindAssignment, [first]))
      .toThrow("HLL_TRACE_CARDINALITY_MISMATCH");

    const tampered = { ...first, outputFingerprint: canonicalDigest("tampered") };
    expect(() => verifyTrace(fixture.blindAssignment, [tampered, tampered]))
      .toThrow();
  });

  it("issues the next capability lease only from a valid PASS validation receipt", () => {
    const fixture = protocol();
    const e1 = fixture.blindAssignment.elements[0]!;
    const e2 = fixture.blindAssignment.elements[1]!;
    const first = createTraceEvent({
      sequence: 1,
      taskId: fixture.blindAssignment.taskId,
      stageId: fixture.blindAssignment.stageId,
      elementId: e1.elementId,
      operationId: e1.operationId,
      executorId: fixture.blindAssignment.executorId,
      capabilityLeaseId: fixture.blindAssignment.capabilityLeaseId,
      instructionFingerprint: e1.instructionFingerprint,
      inputFingerprint: e1.inputFingerprint,
      outputFingerprint: canonicalDigest({ a: 1, b: 2 }),
      effectFingerprints: [canonicalDigest({ kind: "memory.write", target: "candidate-buffer" })],
      evidenceFingerprints: [canonicalDigest({ kind: "canonicalization", rule: "v1" })],
      previousEventFingerprint: null,
      observedAt: new Date().toISOString()
    });
    const second = createTraceEvent({
      sequence: 2,
      taskId: fixture.blindAssignment.taskId,
      stageId: fixture.blindAssignment.stageId,
      elementId: e2.elementId,
      operationId: e2.operationId,
      executorId: fixture.blindAssignment.executorId,
      capabilityLeaseId: fixture.blindAssignment.capabilityLeaseId,
      instructionFingerprint: e2.instructionFingerprint,
      inputFingerprint: e2.inputFingerprint,
      outputFingerprint: canonicalDigest("artifact:sha256:expected"),
      effectFingerprints: [canonicalDigest({ kind: "fs.write", path: "candidate/result.json" })],
      evidenceFingerprints: [canonicalDigest({ kind: "artifact-digest", value: "sha256:expected" })],
      previousEventFingerprint: first.eventFingerprint,
      observedAt: new Date().toISOString()
    });
    const validated = validateBlindStage({
      assignment: fixture.blindAssignment,
      privateCommitment: fixture.privateCommitment,
      trace: [first, second]
    });

    const next = issueNextStageLease({
      validationReceipt: validated.receipt,
      taskId: fixture.blindAssignment.taskId,
      stageId: "STAGE-K+1",
      candidateId: "CANDIDATE-A",
      roleId: "ROLE-VERIFIER",
      executorId: "executor-verifier",
      allowedCapabilities: ["verify"],
      allowedEffects: [],
      allowedTools: ["fs.read"]
    });

    expect(next.stageId).toBe("STAGE-K+1");
    expect(next.taskId).toBe("CORP-BLIND-1");
  });
});
