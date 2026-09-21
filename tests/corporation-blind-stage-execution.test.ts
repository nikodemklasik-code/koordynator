import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import {
  buildExecutionEvidenceBundle,
  createBlindStageAssignment,
  createBlindTraceEvent,
  verifyBlindTrace
} from "../src/corporation/blind-stage-execution.js";
import { createCapabilityLeaseReceipt } from "../src/corporation/receipts.js";

function lease() {
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

function assignment() {
  return createBlindStageAssignment({
    taskId: "CORP-BLIND-1",
    stageId: "STAGE-K",
    executorId: "executor-code",
    capabilityLease: lease(),
    stageContractRef: "hll:stage-contract:K",
    stageContractFingerprint: "sha256:authoritative-stage-contract",
    elements: [
      {
        elementId: "E1",
        order: 1,
        operationId: "normalize-input",
        instruction: "Normalize the supplied object using the assigned operation.",
        input: { b: 2, a: 1 }
      },
      {
        elementId: "E2",
        order: 2,
        operationId: "emit-artifact",
        instruction: "Write the produced artifact to the isolated candidate path.",
        input: { a: 1, b: 2 }
      }
    ]
  });
}

describe("blind stage execution transport", () => {
  it("does not expose expected HLL truth or ratification fields to the executor", () => {
    const visible = JSON.stringify(assignment());

    expect(visible).not.toContain("expectedFragment");
    expect(visible).not.toContain("HLL_computed");
    expect(visible).not.toContain("truthState");
    expect(visible).not.toContain("allowedBrainActions");
    expect(visible).not.toContain("PASS");
    expect(visible).not.toContain("FAIL");
  });

  it("produces only tamper-evident execution evidence", () => {
    const a = assignment();
    const firstElement = a.elements[0]!;
    const secondElement = a.elements[1]!;

    const first = createBlindTraceEvent({
      sequence: 1,
      taskId: a.taskId,
      stageId: a.stageId,
      elementId: firstElement.elementId,
      operationId: firstElement.operationId,
      executorId: a.executorId,
      capabilityLeaseId: a.capabilityLeaseId,
      instructionFingerprint: firstElement.instructionFingerprint,
      inputFingerprint: firstElement.inputFingerprint,
      outputFingerprint: canonicalDigest({ a: 1, b: 2 }),
      effectFingerprints: [canonicalDigest({ kind: "memory.write", target: "candidate-buffer" })],
      evidenceFingerprints: [canonicalDigest({ kind: "normalization", rule: "assigned" })],
      previousEventFingerprint: null,
      observedAt: new Date().toISOString()
    });

    const second = createBlindTraceEvent({
      sequence: 2,
      taskId: a.taskId,
      stageId: a.stageId,
      elementId: secondElement.elementId,
      operationId: secondElement.operationId,
      executorId: a.executorId,
      capabilityLeaseId: a.capabilityLeaseId,
      instructionFingerprint: secondElement.instructionFingerprint,
      inputFingerprint: secondElement.inputFingerprint,
      outputFingerprint: canonicalDigest("artifact:sha256:actual"),
      effectFingerprints: [canonicalDigest({ kind: "fs.write", path: "candidate/result.json" })],
      evidenceFingerprints: [canonicalDigest({ kind: "artifact-digest", value: "sha256:actual" })],
      previousEventFingerprint: first.eventFingerprint,
      observedAt: new Date().toISOString()
    });

    const bundle = buildExecutionEvidenceBundle(a, [first, second]);

    expect(bundle.traceRoot).toBe(second.eventFingerprint);
    expect(bundle.outputFingerprints).toHaveLength(2);
    expect(bundle.effectFingerprints).toHaveLength(2);
    expect(bundle.evidenceFingerprints).toHaveLength(2);

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('"status"');
    expect(serialized).not.toContain("RATIFIED");
    expect(serialized).not.toContain("CapabilityLeaseReceipt");
  });

  it("rejects missing, reordered and tampered trace evidence", () => {
    const a = assignment();
    const firstElement = a.elements[0]!;

    const first = createBlindTraceEvent({
      sequence: 1,
      taskId: a.taskId,
      stageId: a.stageId,
      elementId: firstElement.elementId,
      operationId: firstElement.operationId,
      executorId: a.executorId,
      capabilityLeaseId: a.capabilityLeaseId,
      instructionFingerprint: firstElement.instructionFingerprint,
      inputFingerprint: firstElement.inputFingerprint,
      outputFingerprint: canonicalDigest("out"),
      effectFingerprints: [],
      evidenceFingerprints: [],
      previousEventFingerprint: null,
      observedAt: new Date().toISOString()
    });

    expect(() => verifyBlindTrace(a, [first]))
      .toThrow("BLIND_TRACE_CARDINALITY_MISMATCH");

    const tampered = { ...first, outputFingerprint: canonicalDigest("changed") };
    expect(() => verifyBlindTrace(a, [tampered, tampered]))
      .toThrow();
  });
});
