import { describe, expect, it } from "vitest";
import { validateWorkOrder, type WorkOrder } from "../src/domain/work-order.js";

const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function valid(): WorkOrder {
  return {
    taskId: "TASK-1",
    workspaceId: "WS-1",
    revision: 0,
    objective: "Build deterministic core",
    scope: { modules: ["core"], allowedPaths: ["src/**"] },
    requiredInputs: [],
    capabilities: ["repo.write"],
    budget: { timeSec: 60, costLimit: 1, retries: 0, maxDagDepth: 2 },
    requiredGates: ["unit", "security"],
    expectedEvidence: ["security"],
    acceptanceCriteria: ["gates pass"],
    failureCriteria: ["gate fails"],
    securityContractRef: digest,
    performanceContractRef: digest,
    rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "release-v1", bundleHash: digest }
  };
}

describe("WorkOrder identity validation", () => {
  it("accepts a canonical TASK-/WS- order", () => {
    expect(() => validateWorkOrder(valid())).not.toThrow();
  });

  it("rejects taskId that does not match TASK-*", () => {
    expect(() => validateWorkOrder({ ...valid(), taskId: "nope" as WorkOrder["taskId"] })).toThrow(/WORK_ORDER_TASK_ID_INVALID/);
  });

  it("rejects workspaceId that does not match WS-*", () => {
    expect(() => validateWorkOrder({ ...valid(), workspaceId: "bad" as WorkOrder["workspaceId"] })).toThrow(/WORK_ORDER_WORKSPACE_ID_INVALID/);
  });

  it("rejects duplicate required gates", () => {
    expect(() => validateWorkOrder({ ...valid(), requiredGates: ["unit", "unit"] })).toThrow(/WORK_ORDER_REQUIRED_GATES_NOT_UNIQUE/);
  });

  it("rejects unknown evidence kinds", () => {
    expect(() => validateWorkOrder({ ...valid(), expectedEvidence: ["security", "nope" as WorkOrder["expectedEvidence"][number]] })).toThrow(/WORK_ORDER_EVIDENCE_KIND_INVALID/);
  });
});
