import { randomUUID } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { HllDecision, HllStatement } from "./domain.js";
import type {
  ApprovalReceipt,
  AuthorityEpoch,
  DecisionReceipt
} from "./receipts.js";
import {
  verifyApprovalReceipt,
  verifyDecisionReceipt
} from "./receipts.js";

export type ActionDecisionReceipt = {
  actionDecisionId: string;
  brainAction: string;
  subjectId: string;
  payloadFingerprint: string;
  scopeFingerprint: string;
  hllDecisionReceiptId: string;
  approvalReceiptIds: string[];
  authorisedAt: string;
  receiptFingerprint: string;
};

export function authoriseAction(input: {
  statement: HllStatement;
  decision: HllDecision;
  decisionReceipt: DecisionReceipt;
  brainAction: string;
  subjectId: string;
  payload: unknown;
  scope: unknown;
  approvals: ApprovalReceipt[];
  authorities: Record<string, AuthorityEpoch>;
  now?: Date;
}): ActionDecisionReceipt {
  verifyDecisionReceipt({
    statement: input.statement,
    decision: input.decision,
    receipt: input.decisionReceipt,
    action: input.brainAction,
    ...(input.now === undefined ? {} : { now: input.now })
  });

  const used: ApprovalReceipt[] = [];

  for (const requirement of input.decision.requiredAuthorisations) {
    const authority = input.authorities[requirement];
    if (!authority) throw new Error(`ACTION_AUTHORITY_NOT_REGISTERED:${requirement}`);

    const receipt = input.approvals.find((candidate) =>
      candidate.action === requirement
      && candidate.subjectId === input.subjectId
    );
    if (!receipt) throw new Error(`ACTION_APPROVAL_MISSING:${requirement}`);

    verifyApprovalReceipt({
      receipt,
      authority,
      action: requirement,
      subjectId: input.subjectId,
      payload: input.payload,
      scope: input.scope,
      ...(input.now === undefined ? {} : { now: input.now })
    });
    used.push(receipt);
  }

  const base = {
    actionDecisionId: `ACT-${randomUUID().slice(0, 10).toUpperCase()}`,
    brainAction: input.brainAction,
    subjectId: input.subjectId,
    payloadFingerprint: canonicalDigest(input.payload),
    scopeFingerprint: canonicalDigest(input.scope),
    hllDecisionReceiptId: input.decisionReceipt.receiptId,
    approvalReceiptIds: used.map((receipt) => receipt.receiptId).sort(),
    authorisedAt: (input.now ?? new Date()).toISOString()
  };

  return {
    ...base,
    receiptFingerprint: canonicalDigest(base)
  };
}
