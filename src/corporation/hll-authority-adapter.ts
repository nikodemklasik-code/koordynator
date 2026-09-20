import type {
  HllActionPermission,
  HllDecision,
  HllStatement,
  HllTruthState
} from "./domain.js";
import type { HllAssessment, HllCommitment, HllPort } from "./ports.js";
import {
  createDecisionReceipt,
  createHllRecordReceipt,
  type AuthorityEpoch
} from "./receipts.js";

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
  semanticHash?: string;
  authority: {
    authorityId: string;
    epoch: string;
    conformance: string[];
  };
};

export type HllAuthorityCommitRequest = {
  schema: "corporation-hll-authority-commit-request/1";
  statement: HllStatement;
  decisionHash: string;
  action: import("./domain.js").HllBrainAction;
  rationale: string;
  targetLedger?: string;
  orderingKey?: string;
  externalAuthorisationId?: string;
};

export type HllAuthorityCommitResponse = {
  schema: "corporation-hll-authority-commit-response/1";
  statementId: string;
  statementFingerprint: string;
  decisionHash: string;
  brainDecisionHash: string;
  canonicalRecordHash: string;
  truthState: HllTruthState;
  hllVersion: string;
  authority: {
    authorityId: string;
    epoch: string;
    conformance: string[];
  };
};

export interface HllAuthorityTransport {
  assess(request: HllAuthorityRequest): Promise<HllAuthorityResponse>;
  commit(request: HllAuthorityCommitRequest): Promise<HllAuthorityCommitResponse>;
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

  async commit(input: {
    statement: HllStatement;
    assessment: HllAssessment;
    action: import("./domain.js").HllBrainAction;
    rationale: string;
    targetLedger?: string;
    orderingKey?: string;
    externalAuthorisationId?: string;
  }): Promise<HllCommitment> {
    const response = await this.transport.commit({
      schema: "corporation-hll-authority-commit-request/1",
      statement: structuredClone(input.statement),
      decisionHash: input.assessment.decision.decisionId,
      action: input.action,
      rationale: input.rationale,
      ...(input.targetLedger === undefined ? {} : { targetLedger: input.targetLedger }),
      ...(input.orderingKey === undefined ? {} : { orderingKey: input.orderingKey }),
      ...(input.externalAuthorisationId === undefined
        ? {}
        : { externalAuthorisationId: input.externalAuthorisationId })
    });

    if (response.schema !== "corporation-hll-authority-commit-response/1") {
      throw new Error("HLL_AUTHORITY_COMMIT_SCHEMA_UNSUPPORTED");
    }
    if (response.statementId !== input.statement.statementId) {
      throw new Error("HLL_AUTHORITY_COMMIT_STATEMENT_ID_MISMATCH");
    }
    if (response.statementFingerprint !== input.statement.fingerprint) {
      throw new Error("HLL_AUTHORITY_COMMIT_STATEMENT_FINGERPRINT_MISMATCH");
    }
    if (response.decisionHash !== input.assessment.decision.decisionId) {
      throw new Error("HLL_AUTHORITY_COMMIT_DECISION_MISMATCH");
    }
    if (response.truthState !== input.assessment.decision.truthState) {
      throw new Error("HLL_AUTHORITY_COMMIT_TRUTH_STATE_MISMATCH");
    }
    if (response.hllVersion !== input.assessment.decision.hllVersion) {
      throw new Error("HLL_AUTHORITY_COMMIT_VERSION_MISMATCH");
    }
    if (!response.brainDecisionHash.trim() || !response.canonicalRecordHash.trim()) {
      throw new Error("HLL_AUTHORITY_COMMIT_BINDING_MISSING");
    }

    const conformance = new Set(response.authority.conformance);
    for (const requirement of REQUIRED_HLL_CONFORMANCE) {
      if (!conformance.has(requirement)) {
        throw new Error(`HLL_AUTHORITY_CONFORMANCE_MISSING:${requirement}`);
      }
    }

    const authority: AuthorityEpoch = {
      authorityId: response.authority.authorityId,
      epoch: response.authority.epoch
    };

    return {
      brainDecisionHash: response.brainDecisionHash,
      canonicalRecordHash: response.canonicalRecordHash,
      receipt: createHllRecordReceipt({
        statement: input.statement,
        decision: input.assessment.decision,
        brainDecisionHash: response.brainDecisionHash,
        canonicalRecordHash: response.canonicalRecordHash,
        authority
      })
    };
  }
}
