import { randomUUID } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { HllDecision, HllStatement, SolutionMetrics } from "./domain.js";

export type AuthorityEpoch = {
  authorityId: string;
  epoch: string;
};

export type DecisionReceipt = {
  receiptId: string;
  statementId: string;
  statementFingerprint: string;
  decisionId: string;
  decisionFingerprint: string;
  authorityId: string;
  authorityEpoch: string;
  subjectId: string;
  truthState: HllDecision["truthState"];
  eligibleForFact: boolean;
  blockers: string[];
  allowedBrainActions: HllDecision["allowedBrainActions"];
  provenanceIds: string[];
  hllVersion: string;
  canonicalRecordHash?: string;
  semanticHash?: string;
  issuedAt: string;
  validUntil?: string;
  receiptFingerprint: string;
};

export type ApprovalReceipt = {
  receiptId: string;
  authorityId: string;
  authorityEpoch: string;
  action: string;
  subjectId: string;
  payloadFingerprint: string;
  scopeFingerprint: string;
  issuedAt: string;
  validUntil: string;
  receiptFingerprint: string;
};

export type CapabilityLeaseReceipt = {
  leaseId: string;
  taskId: string;
  stageId: string;
  candidateId: string;
  roleId: string;
  executorId: string;
  allowedCapabilities: string[];
  allowedEffects: string[];
  allowedTools: string[];
  issuedAt: string;
  expiresAt: string;
  receiptFingerprint: string;
};

export type ExecutionReceipt = {
  executionReceiptId: string;
  actionDecisionId?: string;
  capabilityLeaseId: string;
  taskId: string;
  stageId: string;
  candidateId: string;
  executorId: string;
  worktreeId?: string;
  artifactFingerprint: string;
  changedPaths: string[];
  exitStatus: number;
  stdoutDigest?: string;
  stderrDigest?: string;
  evidenceRefs: string[];
  startedAt: string;
  completedAt: string;
  receiptFingerprint: string;
};

export type VerificationFailureClass =
  | "CORRECTNESS"
  | "SECURITY"
  | "INTEGRITY"
  | "PRIVACY"
  | "COMPLIANCE"
  | "PERFORMANCE"
  | "RELIABILITY"
  | "OTHER";

export type VerificationSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type VerificationReceipt = {
  receiptId: string;
  artifactFingerprint: string;
  verifierId: string;
  trustRootId: string;
  independentGroupId: string;
  providerLineageId: string;
  result: "PASS" | "FAIL" | "INCONCLUSIVE";
  failureClass?: VerificationFailureClass;
  severity?: VerificationSeverity;
  metrics: SolutionMetrics;
  metricsFingerprint: string;
  evidenceRefs: string[];
  issuedAt: string;
  receiptFingerprint: string;
};

function decisionDigest(decision: HllDecision): string {
  return canonicalDigest({
    decisionId: decision.decisionId,
    statementId: decision.statementId,
    subjectId: decision.subjectId,
    truthState: decision.truthState,
    eligibleForFact: decision.eligibleForFact,
    blockers: [...decision.blockers].sort(),
    allowedBrainActions: [...decision.allowedBrainActions]
      .map((item) => ({ action: item.action, scope: item.scope }))
      .sort((a, b) => a.scope.localeCompare(b.scope) || a.action.localeCompare(b.action)),
    provenanceIds: [...decision.provenanceIds].sort(),
    hllVersion: decision.hllVersion,
    canonicalRecordHash: decision.canonicalRecordHash ?? null,
    semanticHash: decision.semanticHash ?? null
  });
}

export function createDecisionReceipt(input: {
  statement: HllStatement;
  decision: HllDecision;
  authority: AuthorityEpoch;
  validUntil?: string;
}): DecisionReceipt {
  if (input.decision.statementId !== input.statement.statementId) {
    throw new Error("HLL_DECISION_STATEMENT_ID_MISMATCH");
  }
  const decisionFingerprint = decisionDigest(input.decision);
  const base = {
    receiptId: `DREC-${randomUUID().slice(0, 10).toUpperCase()}`,
    statementId: input.statement.statementId,
    statementFingerprint: input.statement.fingerprint,
    decisionId: input.decision.decisionId,
    decisionFingerprint,
    authorityId: input.authority.authorityId,
    authorityEpoch: input.authority.epoch,
    subjectId: input.decision.subjectId,
    truthState: input.decision.truthState,
    eligibleForFact: input.decision.eligibleForFact,
    blockers: [...input.decision.blockers].sort(),
    allowedBrainActions: [...input.decision.allowedBrainActions]
      .map((item) => ({ action: item.action, scope: item.scope }))
      .sort((a, b) => a.scope.localeCompare(b.scope) || a.action.localeCompare(b.action)),
    provenanceIds: [...input.decision.provenanceIds].sort(),
    hllVersion: input.decision.hllVersion,
    ...(input.decision.canonicalRecordHash === undefined
      ? {}
      : { canonicalRecordHash: input.decision.canonicalRecordHash }),
    ...(input.decision.semanticHash === undefined
      ? {}
      : { semanticHash: input.decision.semanticHash }),
    issuedAt: new Date().toISOString(),
    ...(input.validUntil === undefined ? {} : { validUntil: input.validUntil })
  };
  return {
    ...base,
    receiptFingerprint: canonicalDigest(base)
  };
}

export function verifyDecisionReceipt(input: {
  statement: HllStatement;
  decision: HllDecision;
  receipt: DecisionReceipt;
  expectedAuthority?: AuthorityEpoch;
  now?: Date;
}): void {
  const { statement, decision, receipt } = input;
  if (decision.statementId !== statement.statementId) throw new Error("HLL_DECISION_STATEMENT_ID_MISMATCH");
  if (receipt.statementId !== statement.statementId) throw new Error("HLL_RECEIPT_STATEMENT_ID_MISMATCH");
  if (receipt.statementFingerprint !== statement.fingerprint) throw new Error("HLL_RECEIPT_STATEMENT_FINGERPRINT_MISMATCH");
  if (receipt.decisionId !== decision.decisionId) throw new Error("HLL_RECEIPT_DECISION_ID_MISMATCH");
  if (receipt.decisionFingerprint !== decisionDigest(decision)) throw new Error("HLL_RECEIPT_DECISION_FINGERPRINT_MISMATCH");
  if (receipt.subjectId !== decision.subjectId) throw new Error("HLL_RECEIPT_SUBJECT_MISMATCH");
  if (receipt.truthState !== decision.truthState || receipt.eligibleForFact !== decision.eligibleForFact) {
    throw new Error("HLL_RECEIPT_DECISION_CONTENT_MISMATCH");
  }
  if (receipt.hllVersion !== decision.hllVersion) throw new Error("HLL_RECEIPT_VERSION_MISMATCH");
  if (canonicalDigest(receipt.blockers) !== canonicalDigest([...decision.blockers].sort())) {
    throw new Error("HLL_RECEIPT_BLOCKERS_MISMATCH");
  }
  if (canonicalDigest(receipt.allowedBrainActions) !== canonicalDigest(
    [...decision.allowedBrainActions]
      .map((item) => ({ action: item.action, scope: item.scope }))
      .sort((a, b) => a.scope.localeCompare(b.scope) || a.action.localeCompare(b.action))
  )) {
    throw new Error("HLL_RECEIPT_ACTIONS_MISMATCH");
  }
  if (canonicalDigest(receipt.provenanceIds) !== canonicalDigest([...decision.provenanceIds].sort())) {
    throw new Error("HLL_RECEIPT_PROVENANCE_MISMATCH");
  }

  if (input.expectedAuthority) {
    if (receipt.authorityId !== input.expectedAuthority.authorityId) throw new Error("HLL_AUTHORITY_ID_MISMATCH");
    if (receipt.authorityEpoch !== input.expectedAuthority.epoch) throw new Error("HLL_AUTHORITY_EPOCH_MISMATCH");
  }
  const now = input.now ?? new Date();
  if (receipt.validUntil && Date.parse(receipt.validUntil) <= now.getTime()) {
    throw new Error("HLL_DECISION_RECEIPT_EXPIRED");
  }

  const { receiptFingerprint, ...base } = receipt;
  if (receiptFingerprint !== canonicalDigest(base)) throw new Error("HLL_DECISION_RECEIPT_TAMPERED");
}

export function createApprovalReceipt(input: {
  authority: AuthorityEpoch;
  action: string;
  subjectId: string;
  payload: unknown;
  scope: unknown;
  validUntil: string;
}): ApprovalReceipt {
  const base = {
    receiptId: `AREC-${randomUUID().slice(0, 10).toUpperCase()}`,
    authorityId: input.authority.authorityId,
    authorityEpoch: input.authority.epoch,
    action: input.action,
    subjectId: input.subjectId,
    payloadFingerprint: canonicalDigest(input.payload),
    scopeFingerprint: canonicalDigest(input.scope),
    issuedAt: new Date().toISOString(),
    validUntil: input.validUntil
  };
  return { ...base, receiptFingerprint: canonicalDigest(base) };
}

export function verifyApprovalReceipt(input: {
  receipt: ApprovalReceipt;
  authority: AuthorityEpoch;
  action: string;
  subjectId: string;
  payload: unknown;
  scope: unknown;
  now?: Date;
}): void {
  const r = input.receipt;
  if (r.authorityId !== input.authority.authorityId) throw new Error("APPROVAL_AUTHORITY_ID_MISMATCH");
  if (r.authorityEpoch !== input.authority.epoch) throw new Error("APPROVAL_AUTHORITY_EPOCH_MISMATCH");
  if (r.action !== input.action) throw new Error("APPROVAL_ACTION_MISMATCH");
  if (r.subjectId !== input.subjectId) throw new Error("APPROVAL_SUBJECT_MISMATCH");
  if (r.payloadFingerprint !== canonicalDigest(input.payload)) throw new Error("APPROVAL_PAYLOAD_MISMATCH");
  if (r.scopeFingerprint !== canonicalDigest(input.scope)) throw new Error("APPROVAL_SCOPE_MISMATCH");
  if (Date.parse(r.validUntil) <= (input.now ?? new Date()).getTime()) throw new Error("APPROVAL_EXPIRED");
  const { receiptFingerprint, ...base } = r;
  if (receiptFingerprint !== canonicalDigest(base)) throw new Error("APPROVAL_RECEIPT_TAMPERED");
}

export function createCapabilityLeaseReceipt(input: {
  taskId: string;
  stageId: string;
  candidateId: string;
  roleId: string;
  executorId: string;
  allowedCapabilities: string[];
  allowedEffects: string[];
  allowedTools: string[];
  ttlMs?: number;
}): CapabilityLeaseReceipt {
  const ttlMs = Math.max(1_000, Math.min(input.ttlMs ?? 30 * 60_000, 4 * 60 * 60_000));
  const issuedAt = new Date();
  const base = {
    leaseId: `LEASE-${randomUUID().slice(0, 10).toUpperCase()}`,
    taskId: input.taskId,
    stageId: input.stageId,
    candidateId: input.candidateId,
    roleId: input.roleId,
    executorId: input.executorId,
    allowedCapabilities: [...new Set(input.allowedCapabilities)].sort(),
    allowedEffects: [...new Set(input.allowedEffects)].sort(),
    allowedTools: [...new Set(input.allowedTools)].sort(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString()
  };
  return { ...base, receiptFingerprint: canonicalDigest(base) };
}

export function verifyCapabilityLeaseReceipt(
  lease: CapabilityLeaseReceipt,
  now = new Date()
): void {
  const { receiptFingerprint, ...base } = lease;
  if (receiptFingerprint !== canonicalDigest(base)) throw new Error("CAPABILITY_LEASE_TAMPERED");
  if (Date.parse(lease.expiresAt) <= now.getTime()) throw new Error("CAPABILITY_LEASE_EXPIRED");
}

export function createExecutionReceipt(input: Omit<ExecutionReceipt, "executionReceiptId" | "receiptFingerprint">): ExecutionReceipt {
  const base = {
    ...input,
    executionReceiptId: `EXEC-${randomUUID().slice(0, 10).toUpperCase()}`,
    changedPaths: [...new Set(input.changedPaths)].sort(),
    evidenceRefs: [...new Set(input.evidenceRefs)].sort()
  };
  return { ...base, receiptFingerprint: canonicalDigest(base) };
}

export function verifyExecutionReceipt(receipt: ExecutionReceipt): void {
  const { receiptFingerprint, ...base } = receipt;
  if (receiptFingerprint !== canonicalDigest(base)) throw new Error("EXECUTION_RECEIPT_TAMPERED");
  if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) throw new Error("EXECUTION_RECEIPT_TIME_INVALID");
}

export function createVerificationReceipt(input: Omit<VerificationReceipt, "receiptId" | "metricsFingerprint" | "issuedAt" | "receiptFingerprint">): VerificationReceipt {
  const base = {
    ...input,
    receiptId: `VREC-${randomUUID().slice(0, 10).toUpperCase()}`,
    metricsFingerprint: canonicalDigest(input.metrics),
    evidenceRefs: [...new Set(input.evidenceRefs)],
    issuedAt: new Date().toISOString()
  };
  return { ...base, receiptFingerprint: canonicalDigest(base) };
}

export function verifyVerificationReceipt(receipt: VerificationReceipt): void {
  if (receipt.metricsFingerprint !== canonicalDigest(receipt.metrics)) throw new Error("VERIFICATION_METRICS_TAMPERED");
  const { receiptFingerprint, ...base } = receipt;
  if (receiptFingerprint !== canonicalDigest(base)) throw new Error("VERIFICATION_RECEIPT_TAMPERED");
}
