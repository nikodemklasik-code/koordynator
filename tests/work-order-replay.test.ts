import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import { signWorkOrder } from "../src/security/work-order-signature.js";
import { FileSignedWorkOrderStore } from "../src/store/work-order-store.js";

const d = (value: unknown) => canonicalDigest(value);
const order: WorkOrder = {
  taskId: "TASK-REPLAY", workspaceId: "WS-REPLAY", revision: 0, objective: "Replay exactly signed order",
  scope: { modules: ["core"], allowedPaths: ["src/**"] }, requiredInputs: [], capabilities: ["repo.write"],
  budget: { timeSec: 60, costLimit: 1, retries: 1, maxDagDepth: 4 }, requiredGates: ["unit"], expectedEvidence: ["dependency"],
  acceptanceCriteria: ["replay verifies"], failureCriteria: ["tamper"], securityContractRef: d("s"), performanceContractRef: d("p"),
  rollbackRequirement: "REVERSIBLE", humanApprovalPolicy: "AUTO_IF_POLICY_PASS", policyRef: { policyId: "p", bundleHash: d("policy") }
};

describe("durable signed work order replay", () => {
  it("persists immutable envelope and re-verifies it on replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "orch-wo-"));
    try {
      const keys = generateKeyPairSync("ed25519");
      const signed = signWorkOrder(order, "owner", keys.privateKey);
      const store = new FileSignedWorkOrderStore(root);
      await store.put(signed);
      await store.put(signed);
      const replay = await store.replay(order.taskId, 0, () => keys.publicKey);
      expect(replay.receipt.orderFp).toBe(signed.orderFp);
      const different = signWorkOrder({ ...order, objective: "different" }, "owner", keys.privateKey);
      await expect(store.put(different)).rejects.toThrow("SIGNED_WORK_ORDER_REVISION_IMMUTABLE");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
