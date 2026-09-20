import type {
  HllActionPermission,
  HllDecision,
  HllStatement,
  HllTruthState
} from "./domain.js";
import type { HllAssessment, HllPort } from "./ports.js";
import { createDecisionReceipt, type AuthorityEpoch } from "./receipts.js";

export const REQUIRED_HLL_CONFORMANCE = [
  "HLL/1.0",
  "K1_PUBLIC_RATIFIED_INGRESS_BLOCKED",
  "K2_COMMIT_TIME_REVALIDATION",
  "CORPORATION_EXTENSION_V1"
] as const;

export type HllAuthorityRequest = {
  schema: "corporation-hll-authority-request/1";
  statement: HllStatement;
};

export type HllAuthorityResponse = {
  schema: "corporation-hll-authority-response/1";
  statementId: string;
  statementFingerprint: string;
  subjectId: string;
  truthState: HllTruthState;
  eligibleForFact: boolean;
  blockers: string[];
  allowedBrainActions: HllActionPermission[];
  provenanceIds: string[];
  hllVersion: string;
  decisionHash: string;
  canonicalRecordHash?: string;
  semanticHash?: string;
  authority: {
    authorityId: string;
    epoch: string;
    conformance: string[];
  };
};

export interface HllAuthorityTransport {
  assess(request: HllAuthorityRequest): Promise<HllAuthorityResponse>;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function validateResponse(statement: HllStatement, response: HllAuthorityResponse): void {
  if (response.schema !== "corporation-hll-authority-response/1") {
    throw new Error("HLL_AUTHORITY_SCHEMA_UNSUPPORTED");
  }
  if (response.statementId !== statement.statementId) {
    throw new Error("HLL_AUTHORITY_STATEMENT_ID_MISMATCH");
  }
  if (response.statementFingerprint !== statement.fingerprint) {
    throw new Error("HLL_AUTHORITY_STATEMENT_FINGERPRINT_MISMATCH");
  }
  if (!response.subjectId.trim()) throw new Error("HLL_AUTHORITY_SUBJECT_ID_MISSING");
  if (!response.decisionHash.trim()) throw new Error("HLL_AUTHORITY_DECISION_HASH_MISSING");
  if (!response.hllVersion.trim()) throw new Error("HLL_AUTHORITY_VERSION_MISSING");
  if (!response.authority.authorityId.trim() || !response.authority.epoch.trim()) {
    throw new Error("HLL_AUTHORITY_IDENTITY_MISSING");
  }

  const conformance = new Set(response.authority.conformance);
  for (const requirement of REQUIRED_HLL_CONFORMANCE) {
    if (!conformance.has(requirement)) {
      throw new Error(`HLL_AUTHORITY_CONFORMANCE_MISSING:${requirement}`);
    }
  }

  const permissionKeys = response.allowedBrainActions.map((item) => `${item.scope}:${item.action}`);
  if (new Set(permissionKeys).size !== permissionKeys.length) {
    throw new Error("HLL_AUTHORITY_DUPLICATE_ACTION_PERMISSION");
  }

  if (response.truthState === "CONFIRMED" && !response.eligibleForFact) {
    throw new Error("HLL_AUTHORITY_CONFIRMED_WITHOUT_ELIGIBILITY");
  }
  if (response.truthState === "CONFIRMED" && !response.canonicalRecordHash) {
    throw new Error("HLL_AUTHORITY_CONFIRMED_WITHOUT_CANONICAL_RECORD");
  }
}

export class AuthoritativeHllPort implements HllPort {
  constructor(private readonly transport: HllAuthorityTransport) {}

  async assess(statement: HllStatement): Promise<HllAssessment> {
    const response = await this.transport.assess({
      schema: "corporation-hll-authority-request/1",
      statement: structuredClone(statement)
    });
    validateResponse(statement, response);

    const decision: HllDecision = {
      decisionId: response.decisionHash,
      statementId: statement.statementId,
      subjectId: response.subjectId,
      truthState: response.truthState,
      eligibleForFact: response.eligibleForFact,
      blockers: uniqueSorted(response.blockers),
      allowedBrainActions: [...response.allowedBrainActions]
        .map((item) => ({ action: item.action, scope: item.scope }))
        .sort((a, b) => a.scope.localeCompare(b.scope) || a.action.localeCompare(b.action)),
      provenanceIds: uniqueSorted(response.provenanceIds),
      hllVersion: response.hllVersion,
      ...(response.canonicalRecordHash === undefined
        ? {}
        : { canonicalRecordHash: response.canonicalRecordHash }),
      ...(response.semanticHash === undefined
        ? {}
        : { semanticHash: response.semanticHash })
    };

    const authority: AuthorityEpoch = {
      authorityId: response.authority.authorityId,
      epoch: response.authority.epoch
    };

    return {
      decision,
      receipt: createDecisionReceipt({
        statement,
        decision,
        authority
      })
    };
  }
}
