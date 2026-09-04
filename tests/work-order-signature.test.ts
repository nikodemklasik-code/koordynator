import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import { signWorkOrder, verifySignedWorkOrder } from "../src/security/work-order-signature.js";

const d = (value: string) => canonicalDigest(value);

const order: WorkOrder = {
  taskId: "TASK-1", workspaceId: "WS-1", revision: 0, objective: "Build deterministic core",
  scope: { modules: ["core"], allowedPaths: ["src/**"] }, requiredInputs: [], capabilities: ["repo.write"],
  budget: { timeSec: 600, costLimit: 10, retries: 2, maxDagDepth: 8 }, requiredGates: ["unit", "security"],
  expectedEvidence: ["security"], acceptanceCriteria: ["tests pass"], failureCriteria: ["gate fails"],
  securityContractRef: d("security"), performanceContractRef: d("performance"), rollbackRequirement: "REVERSIBLE",
  humanApprovalPolicy: "AUTO_IF_POLICY_PASS", policyRef: { policyId: "p1", bundleHash: d("policy") }
};

describe("signed WorkOrder", () => {
  it("verifies an untampered order and rejects tampering", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signed = signWorkOrder(order, "test-key", privateKey);
    expect(verifySignedWorkOrder(signed, publicKey)).toBe(true);
    const tampered = { ...signed, order: { ...signed.order, objective: "tampered" } };
    expect(verifySignedWorkOrder(tampered, publicKey)).toBe(false);
  });
});
