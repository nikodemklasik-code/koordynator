import { randomUUID } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { HllDecision, HllProvenance, HllStatement } from "./domain.js";
import type { AuthorityEpoch, DecisionReceipt } from "./receipts.js";
import { verifyDecisionReceipt } from "./receipts.js";

export function makeHllStatement(input: {
  subject: HllStatement["subject"];
  proposition: string;
  payload: Record<string, unknown>;
  provenance: HllProvenance;
  requestedBrainActions: string[];
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
  action: string;
  expectedAuthority?: AuthorityEpoch;
}): boolean {
  try {
    verifyDecisionReceipt(input);
    return true;
  } catch {
    return false;
  }
}

export function assertHllAllows(input: {
  statement: HllStatement;
  decision: HllDecision;
  receipt: DecisionReceipt;
  action: string;
  expectedAuthority?: AuthorityEpoch;
}): void {
  verifyDecisionReceipt(input);
}
