import { randomUUID } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { HllBrainAction, HllDecision, HllStatement } from "./domain.js";
import type {
  ApprovalReceipt,
  AuthorityEpoch,
  DecisionReceipt,
  HllRecordReceipt
} from "./receipts.js";
import {
  verifyApprovalReceipt,
  verifyDecisionReceipt,
  verifyHllRecordReceipt
} from "./receipts.js";
import type {
  VeraEffectAuthorityPort,
  VeraPrepareEffectInput
} from "./vera-authority.js";

export type ActionDecisionReceipt = {
  actionDecisionId: string;
  brainAction: HllBrainAction;
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
  brainAction: HllBrainAction;
  subjectId: string;
  payload: unknown;
  scope: unknown;
  requiredAuthorisations: string[];
  approvals: ApprovalReceipt[];
  authorities: Record<string, AuthorityEpoch>;
  now?: Date;
}): ActionDecisionReceipt {
  verifyDecisionReceipt({
    statement: input.statement,
    decision: input.decision,
    receipt: input.decisionReceipt,
    ...(input.now === undefined ? {} : { now: input.now })
  });

  if (!input.decision.allowedBrainActions.some((permission) =>
    permission.action === input.brainAction
  )) {
    throw new Error("HLL_BRAIN_ACTION_NOT_ALLOWED");
  }

  const used: ApprovalReceipt[] = [];

  for (const requirement of [...new Set(input.requiredAuthorisations)]) {
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


export type VeraEffectDecision = {
  actionDecision: ActionDecisionReceipt;
  permitId: string;
};

/**
 * Material/external execution path.
 *
 * HLL proves semantic admissibility and the canonical record proves that the
 * proposition actually crossed the HLL write barrier. Corporation/Brain then
 * chooses an allowed action. VERA remains the final execution authority and
 * alone may issue the single-use effect permit.
 *
 * No local boolean, ActionDecisionReceipt or HLL CONFIRMED state is an effect
 * permit.
 */
export async function authoriseVeraEffect(input: {
  statement: HllStatement;
  decision: HllDecision;
  decisionReceipt: DecisionReceipt;
  hllRecordReceipt: HllRecordReceipt;
  brainAction: HllBrainAction;
  subjectId: string;
  payload: unknown;
  scope: unknown;
  requiredAuthorisations: string[];
  approvals: ApprovalReceipt[];
  authorities: Record<string, AuthorityEpoch>;
  vera: VeraEffectAuthorityPort;
  effect: VeraPrepareEffectInput;
  now?: Date;
}): Promise<VeraEffectDecision> {
  verifyHllRecordReceipt({
    statement: input.statement,
    decision: input.decision,
    receipt: input.hllRecordReceipt,
    expectedAuthority: {
      authorityId: input.decisionReceipt.authorityId,
      epoch: input.decisionReceipt.authorityEpoch
    }
  });

  const actionDecision = authoriseAction({
    statement: input.statement,
    decision: input.decision,
    decisionReceipt: input.decisionReceipt,
    brainAction: input.brainAction,
    subjectId: input.subjectId,
    payload: input.payload,
    scope: input.scope,
    requiredAuthorisations: input.requiredAuthorisations,
    approvals: input.approvals,
    authorities: input.authorities,
    ...(input.now === undefined ? {} : { now: input.now })
  });

  const permit = await input.vera.prepareEffect(input.effect);

  return {
    actionDecision,
    permitId: permit.permitId
  };
}
