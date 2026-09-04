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

export function validateWorkOrder(order: WorkOrder): void {
  if (!order.objective.trim()) throw new Error("WORK_ORDER_OBJECTIVE_REQUIRED");
  if (order.scope.allowedPaths.length === 0) throw new Error("WORK_ORDER_SCOPE_REQUIRED");
  if (order.budget.timeSec <= 0 || order.budget.retries < 0 || order.budget.maxDagDepth <= 0) {
    throw new Error("WORK_ORDER_BUDGET_INVALID");
  }
}
