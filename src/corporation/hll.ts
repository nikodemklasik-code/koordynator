import { randomUUID } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type {
  HllBrainAction,
  HllDecision,
  HllProvenance,
  HllStatement
} from "./domain.js";
import type { AuthorityEpoch, DecisionReceipt } from "./receipts.js";
import { verifyDecisionReceipt } from "./receipts.js";

export function makeHllStatement(input: {
  subject: HllStatement["subject"];
  proposition: string;
  payload: Record<string, unknown>;
  provenance: HllProvenance;
  requestedBrainActions: HllBrainAction[];
}): HllStatement {
  const statementId = `HLL-${input.subject}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const fingerprint = canonicalDigest({
    statementId,
    subject: input.subject,
    proposition: input.proposition,
    payload: input.payload,
    provenance: input.provenance,
    requestedBrainActions: [...input.requestedBrainActions].sort()
  });

  return {
    statementId,
    subject: input.subject,
    proposition: input.proposition,
    payload: input.payload,
    provenance: {
      ...input.provenance,
      evidenceRefs: [...input.provenance.evidenceRefs]
    },
    requestedBrainActions: [...input.requestedBrainActions],
    fingerprint
  };
}

export function hllAllows(input: {
  statement: HllStatement;
  decision: HllDecision;
  receipt: DecisionReceipt;
  action: HllBrainAction;
  expectedAuthority?: AuthorityEpoch;
}): boolean {
  try {
    assertHllAllows(input);
    return true;
  } catch {
    return false;
  }
}

export function assertHllAllows(input: {
  statement: HllStatement;
  decision: HllDecision;
  receipt: DecisionReceipt;
  action: HllBrainAction;
  expectedAuthority?: AuthorityEpoch;
}): void {
  verifyDecisionReceipt({
    statement: input.statement,
    decision: input.decision,
    receipt: input.receipt,
    ...(input.expectedAuthority === undefined
      ? {}
      : { expectedAuthority: input.expectedAuthority })
  });

  if (!input.decision.allowedBrainActions.some((permission) =>
    permission.action === input.action
  )) {
    throw new Error("HLL_BRAIN_ACTION_NOT_ALLOWED");
  }
}

export function hllDecisionBlocksProgress(decision: HllDecision): boolean {
  return ["FALSE", "CONTRADICTED", "ERROR", "EXPIRED"].includes(decision.truthState);
}

export function hllDecisionMayBeRecorded(decision: HllDecision): boolean {
  return decision.allowedBrainActions.some((permission) =>
    permission.scope === "INTERNAL"
    && ["RECORD", "REGISTER_UNRESOLVED", "UPDATE_RECORD"].includes(permission.action)
  );
}
