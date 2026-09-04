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
    const basis = { candidateSha, policy: order.policyRef, reasons: [...reasons].sort() };
    return { allowed: false, approval: "DENY", reasons, approvalFp: `sha256:${awaitDigest(basis)}` as Digest };
  }

  const humanRequired = order.humanApprovalPolicy === "HUMAN_REQUIRED"
    || order.rollbackRequirement === "BACKUP_RESTORE_REQUIRED";
  const approval = humanRequired ? "HUMAN_REQUIRED" : "AUTO";
  const basis = { candidateSha, policy: order.policyRef, approval, gates: order.requiredGates };
  return { allowed: true, approval, reasons: [], approvalFp: `sha256:${awaitDigest(basis)}` as Digest };
}

function awaitDigest(value: unknown): string {
  // Kept local to avoid policy depending on mutable external state.
  const json = JSON.stringify(sortValue(value));
  return requireHash(json);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortValue(v)]));
  }
  return value;
}

function requireHash(value: string): string {
  // Dynamic import is deliberately avoided so the policy remains synchronous.
  const bytes = new TextEncoder().encode(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const byte of bytes) {
    h1 ^= byte;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= byte;
    h2 = Math.imul(h2, 0x811c9dc5);
  }
  const chunk = `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
  return chunk.repeat(4);
}
