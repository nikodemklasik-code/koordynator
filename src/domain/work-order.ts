import type { Digest, TaskId, WorkspaceId } from "./ids.js";
import type { GateName } from "../engine/impact-engine.js";

export type EvidenceKind =
  | "contract"
  | "security"
  | "performance"
  | "dependency"
  | "integration"
  | "resilience"
  | "migration";

export type WorkOrder = {
  taskId: TaskId;
  workspaceId: WorkspaceId;
  revision: number;
  objective: string;
  scope: { modules: string[]; allowedPaths: string[] };
  requiredInputs: Array<{ uri: string; digest: Digest }>;
  capabilities: string[];
  budget: { timeSec: number; costLimit: number; retries: number; maxDagDepth: number };
  requiredGates: GateName[];
  expectedEvidence: EvidenceKind[];
  acceptanceCriteria: string[];
  failureCriteria: string[];
  securityContractRef: Digest;
  performanceContractRef: Digest;
  rollbackRequirement: "NONE" | "REVERSIBLE" | "BACKUP_RESTORE_REQUIRED";
  humanApprovalPolicy: "AUTO_IF_POLICY_PASS" | "HUMAN_REQUIRED";
  policyRef: { policyId: string; bundleHash: Digest };
};

function assertPlainObject(value: unknown, code: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], code: string): void {
  const expected = new Set(allowed);
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new Error(`${code}:${key}`);
  for (const key of allowed) if (!(key in value)) throw new Error(`${code}:MISSING:${key}`);
}

const ROOT_KEYS = [
  "taskId", "workspaceId", "revision", "objective", "scope", "requiredInputs", "capabilities", "budget",
  "requiredGates", "expectedEvidence", "acceptanceCriteria", "failureCriteria", "securityContractRef",
  "performanceContractRef", "rollbackRequirement", "humanApprovalPolicy", "policyRef"
] as const;

export function validateWorkOrder(order: WorkOrder): void {
  assertPlainObject(order, "WORK_ORDER_SCHEMA_INVALID");
  assertExactKeys(order, ROOT_KEYS, "WORK_ORDER_SCHEMA_ADDITIONAL_OR_MISSING_PROPERTY");
  assertPlainObject(order.scope, "WORK_ORDER_SCOPE_INVALID");
  assertExactKeys(order.scope, ["modules", "allowedPaths"], "WORK_ORDER_SCOPE_SCHEMA_INVALID");
  assertPlainObject(order.budget, "WORK_ORDER_BUDGET_INVALID");
  assertExactKeys(order.budget, ["timeSec", "costLimit", "retries", "maxDagDepth"], "WORK_ORDER_BUDGET_SCHEMA_INVALID");
  assertPlainObject(order.policyRef, "WORK_ORDER_POLICY_INVALID");
  assertExactKeys(order.policyRef, ["policyId", "bundleHash"], "WORK_ORDER_POLICY_SCHEMA_INVALID");
  if (!Array.isArray(order.requiredInputs)) throw new Error("WORK_ORDER_INPUTS_INVALID");
  for (const input of order.requiredInputs) {
    assertPlainObject(input, "WORK_ORDER_INPUT_INVALID");
    assertExactKeys(input, ["uri", "digest"], "WORK_ORDER_INPUT_SCHEMA_INVALID");
  }
  if (!order.objective.trim()) throw new Error("WORK_ORDER_OBJECTIVE_REQUIRED");
  if (!Array.isArray(order.scope.allowedPaths) || order.scope.allowedPaths.length === 0) throw new Error("WORK_ORDER_SCOPE_REQUIRED");
  if (!Array.isArray(order.scope.modules) || !Array.isArray(order.capabilities) || !Array.isArray(order.requiredGates)) throw new Error("WORK_ORDER_ARRAY_FIELD_INVALID");
  if (!Number.isInteger(order.revision) || order.revision < 0) throw new Error("WORK_ORDER_REVISION_INVALID");
  if (order.budget.timeSec <= 0 || order.budget.costLimit < 0 || order.budget.retries < 0 || order.budget.maxDagDepth <= 0) {
    throw new Error("WORK_ORDER_BUDGET_INVALID");
  }
  const digestFields = [order.securityContractRef, order.performanceContractRef, order.policyRef.bundleHash, ...order.requiredInputs.map((input) => input.digest)];
  if (digestFields.some((value) => !/^sha256:[a-f0-9]{64}$/i.test(value))) throw new Error("WORK_ORDER_DIGEST_INVALID");
}
