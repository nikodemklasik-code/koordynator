import { randomUUID } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { HllDecision, HllProvenance, HllStatement } from "./domain.js";

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

export function hllAllows(decision: HllDecision, action: string): boolean {
  return decision.verdict === "ALLOW"
    && decision.truthState === "RATIFIED"
    && decision.allowedBrainActions.includes(action);
}

export function assertHllAllows(decision: HllDecision, action: string): void {
  if (decision.verdict === "BLOCK") throw new Error("HLL_ACTION_BLOCKED");
  if (decision.truthState !== "RATIFIED") throw new Error("HLL_TRUTH_NOT_RATIFIED");
  if (!decision.allowedBrainActions.includes(action)) throw new Error("HLL_BRAIN_ACTION_NOT_ALLOWED");
}
