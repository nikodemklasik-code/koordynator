import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";

/**
 * CORPORATION ↔ HLL boundary.
 *
 * HLL is NOT implemented here. The authoritative HLL engine belongs to Harmonia Legal.
 * Koordynator consumes HLL as the Corporation's internal language for truth, provenance,
 * ratification and allowed executive action.
 */

export type CorporateHllSubject =
  | "TASK"
  | "DEPARTMENT"
  | "ROLE_CONTRACT"
  | "RECRUITMENT"
  | "DELEGATION"
  | "EXECUTION_RESULT"
  | "SECURITY_FINDING"
  | "SELF_IMPROVEMENT"
  | "PRODUCT_DECISION";

export type CorporateHllTruthState =
  | "PROPOSED"
  | "SUPPORTED"
  | "CONTESTED"
  | "RATIFIED"
  | "REJECTED"
  | "UNKNOWN";

export type CorporateHllVerdict = "ALLOW" | "REVISE" | "BLOCK";

export type CorporateHllProvenance = {
  sourceType: "OWNER" | "SYSTEM" | "DEPARTMENT" | "ROLE" | "TOOL" | "EXTERNAL";
  sourceId: string;
  evidenceRefs: string[];
  observedAt: string;
};

export type CorporateHllStatement = {
  statementId: string;
  subject: CorporateHllSubject;
  proposition: string;
  payload: Record<string, unknown>;
  provenance: CorporateHllProvenance;
  requestedBrainActions: string[];
  fingerprint: Digest;
};

export type CorporateHllDecision = {
  decisionId: string;
  statementId: string;
  truthState: CorporateHllTruthState;
  verdict: CorporateHllVerdict;
  reasons: string[];
  allowedBrainActions: string[];
  requiredAuthorisations: string[];
  canonicalRecord?: string;
  canonicalFingerprint?: Digest;
  decidedAt: string;
};

export interface CorporateHllPort {
  /**
   * Submit a corporate proposition to the authoritative HLL/Harmonia layer.
   *
   * Koordynator MUST NOT treat an unratified proposition as canonical truth.
   */
  assess(statement: CorporateHllStatement): Promise<CorporateHllDecision>;
}

export function corporateHllStatement(input: Omit<CorporateHllStatement, "fingerprint">): CorporateHllStatement {
  return {
    ...input,
    fingerprint: canonicalDigest({
      statementId: input.statementId,
      subject: input.subject,
      proposition: input.proposition,
      payload: input.payload,
      provenance: input.provenance,
      requestedBrainActions: [...input.requestedBrainActions].sort()
    })
  };
}

export function assertHllAllows(
  decision: CorporateHllDecision,
  action: string
): void {
  if (decision.verdict === "BLOCK") throw new Error("HLL_ACTION_BLOCKED");
  if (decision.truthState !== "RATIFIED") throw new Error("HLL_TRUTH_NOT_RATIFIED");
  if (!decision.allowedBrainActions.includes(action)) throw new Error("HLL_BRAIN_ACTION_NOT_ALLOWED");
}

/**
 * Test/dev adapter only. Production must inject the real HLL/Harmonia engine.
 * It deliberately does not infer truth. The caller must provide decisions.
 */
export class ExplicitCorporateHllAdapter implements CorporateHllPort {
  constructor(private readonly decide: (statement: CorporateHllStatement) => Promise<CorporateHllDecision>) {}

  assess(statement: CorporateHllStatement): Promise<CorporateHllDecision> {
    return this.decide(statement);
  }
}
