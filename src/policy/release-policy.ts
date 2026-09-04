import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { EvidenceReceipt } from "../domain/evidence.js";
import type { Digest } from "../domain/ids.js";
import type { WorkOrder } from "../domain/work-order.js";

export type ReleasePolicyDecision = {
  allowed: boolean;
  approval: "AUTO" | "HUMAN_REQUIRED" | "DENY";
  reasons: string[];
  approvalFp: Digest;
};

export function evaluateReleasePolicy(
  order: WorkOrder,
  candidateSha: Digest,
  receipts: EvidenceReceipt[],
  now: Date
): ReleasePolicyDecision {
  const reasons: string[] = [];
  const byGate = new Map(receipts.map((receipt) => [receipt.gate, receipt]));

  for (const gate of order.requiredGates) {
    const receipt = byGate.get(gate);
    if (!receipt) {
      reasons.push(`MISSING:${gate}`);
      continue;
    }
    if (receipt.candidateSha !== candidateSha) reasons.push(`CANDIDATE_MISMATCH:${gate}`);
    if (receipt.status !== "PASS") reasons.push(`${receipt.status}:${gate}`);
    if (receipt.revoked) reasons.push(`REVOKED:${gate}`);
    if (new Date(receipt.validUntil).getTime() <= now.getTime()) reasons.push(`EXPIRED:${gate}`);
    if (receipt.policyFp !== order.policyRef.bundleHash) reasons.push(`STALE_POLICY:${gate}`);
  }

  if (reasons.length > 0) {
    return {
      allowed: false,
      approval: "DENY",
      reasons,
      approvalFp: canonicalDigest({ candidateSha, policy: order.policyRef, reasons: [...reasons].sort() })
    };
  }

  const humanRequired = order.humanApprovalPolicy === "HUMAN_REQUIRED"
    || order.rollbackRequirement === "BACKUP_RESTORE_REQUIRED";
  const approval = humanRequired ? "HUMAN_REQUIRED" : "AUTO";
  return {
    allowed: true,
    approval,
    reasons: [],
    approvalFp: canonicalDigest({ candidateSha, policy: order.policyRef, approval, gates: order.requiredGates })
  };
}
