import type { KeyObject } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import { validateWorkOrder, type WorkOrder } from "../domain/work-order.js";
import { verifySignedWorkOrder, type SignedWorkOrder } from "./work-order-signature.js";

export type PublicKeyResolver = (keyId: string) => KeyObject;

export type WorkOrderExecutionReceipt = {
  taskId: string;
  workspaceId: string;
  revision: number;
  orderFp: Digest;
  keyId: string;
  receiptFp: Digest;
};

export type AcceptedWorkOrderExecution = {
  envelope: SignedWorkOrder;
  receipt: WorkOrderExecutionReceipt;
};

const ENVELOPE_KEYS = ["order", "orderFp", "keyId", "signatureBase64"] as const;
const ORDER_KEYS = [
  "taskId", "workspaceId", "revision", "objective", "scope", "requiredInputs", "capabilities", "budget",
  "requiredGates", "expectedEvidence", "acceptanceCriteria", "failureCriteria", "securityContractRef",
  "performanceContractRef", "rollbackRequirement", "humanApprovalPolicy", "policyRef"
] as const;
const SCOPE_KEYS = ["modules", "allowedPaths"] as const;
const BUDGET_KEYS = ["timeSec", "costLimit", "retries", "maxDagDepth"] as const;
const POLICY_REF_KEYS = ["policyId", "bundleHash"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, code: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(code);
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], code: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key)).sort();
  if (unknown.length > 0) throw new Error(`${code}:${unknown.join(",")}`);
}

function assertSignedEnvelopeShape(input: unknown): asserts input is SignedWorkOrder {
  assertRecord(input, "EXECUTION_REQUIRES_SIGNED_WORK_ORDER");
  assertExactKeys(input, ENVELOPE_KEYS, "SIGNED_WORK_ORDER_UNKNOWN_FIELD");

  if (typeof input.orderFp !== "string" || typeof input.keyId !== "string" || typeof input.signatureBase64 !== "string") {
    throw new Error("SIGNED_WORK_ORDER_ENVELOPE_INVALID");
  }

  assertRecord(input.order, "SIGNED_WORK_ORDER_ORDER_INVALID");
  assertExactKeys(input.order, ORDER_KEYS, "WORK_ORDER_UNKNOWN_FIELD");

  assertRecord(input.order.scope, "WORK_ORDER_SCOPE_INVALID");
  assertExactKeys(input.order.scope, SCOPE_KEYS, "WORK_ORDER_SCOPE_UNKNOWN_FIELD");

  assertRecord(input.order.budget, "WORK_ORDER_BUDGET_INVALID");
  assertExactKeys(input.order.budget, BUDGET_KEYS, "WORK_ORDER_BUDGET_UNKNOWN_FIELD");

  assertRecord(input.order.policyRef, "WORK_ORDER_POLICY_REF_INVALID");
  assertExactKeys(input.order.policyRef, POLICY_REF_KEYS, "WORK_ORDER_POLICY_REF_UNKNOWN_FIELD");

  const order = input.order as unknown as WorkOrder;
  if (typeof order.taskId !== "string" || typeof order.workspaceId !== "string" || !Number.isInteger(order.revision)) {
    throw new Error("WORK_ORDER_IDENTITY_INVALID");
  }
  if (!Array.isArray(order.scope.modules) || !Array.isArray(order.scope.allowedPaths)
    || !Array.isArray(order.requiredInputs) || !Array.isArray(order.capabilities)
    || !Array.isArray(order.requiredGates) || !Array.isArray(order.expectedEvidence)
    || !Array.isArray(order.acceptanceCriteria) || !Array.isArray(order.failureCriteria)) {
    throw new Error("WORK_ORDER_COLLECTION_INVALID");
  }
}

export function acceptSignedWorkOrderExecution(
  input: unknown,
  resolvePublicKey: PublicKeyResolver
): AcceptedWorkOrderExecution {
  assertSignedEnvelopeShape(input);
  validateWorkOrder(input.order);

  const publicKey = resolvePublicKey(input.keyId);
  if (!verifySignedWorkOrder(input, publicKey)) throw new Error("WORK_ORDER_SIGNATURE_INVALID");

  const base = {
    taskId: input.order.taskId,
    workspaceId: input.order.workspaceId,
    revision: input.order.revision,
    orderFp: input.orderFp,
    keyId: input.keyId
  };

  return {
    envelope: input,
    receipt: { ...base, receiptFp: canonicalDigest(base) }
  };
}
