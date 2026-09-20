import { describe, expect, it } from "vitest";
import { makeHllStatement } from "../src/corporation/hll.js";
import {
  AuthoritativeHllPort,
  REQUIRED_HLL_CONFORMANCE,
  type HllAuthorityCommitRequest,
  type HllAuthorityCommitResponse,
  type HllAuthorityRequest,
  type HllAuthorityResponse,
  type HllAuthorityTransport
} from "../src/corporation/hll-authority-adapter.js";

function statement() {
  return makeHllStatement({
    subject: "TASK",
    proposition: "A task request exists with the captured structured payload.",
    payload: {
      taskId: "CORP-1",
      objective: "Implement the bounded improvement"
    },
    provenance: {
      sourceType: "OWNER",
      sourceId: "owner",
      evidenceRefs: ["owner-request:1"],
      observedAt: new Date().toISOString(),
      sourceLocator: "owner://request/1",
      contentHash: "a".repeat(64),
      verified: true
    },
    requestedBrainActions: ["RECORD", "DEFER"]
  });
}

function responseFor(request: HllAuthorityRequest): HllAuthorityResponse {
  return {
    schema: "corporation-hll-authority-response/1",
    statementId: request.statement.statementId,
    statementFingerprint: request.statement.fingerprint,
    subjectId: "HLLCORP:" + request.statement.statementId,
    truthState: "CONFIRMED",
    eligibleForFact: true,
    blockers: [],
    allowedBrainActions: [
      { action: "RECORD", scope: "INTERNAL" },
      { action: "DEFER", scope: "INTERNAL" }
    ],
    provenanceIds: ["PROV:" + request.statement.statementId],
    hllVersion: "HLL/1.0",
    decisionHash: "d".repeat(64),
    semanticHash: "s".repeat(64),
    authority: {
      authorityId: "harmonia-hll",
      epoch: "hll-1.0-corp-v1",
      conformance: [...REQUIRED_HLL_CONFORMANCE]
    }
  };
}

function commitResponseFor(request: HllAuthorityCommitRequest): HllAuthorityCommitResponse {
  return {
    schema: "corporation-hll-authority-commit-response/1",
    statementId: request.statement.statementId,
    statementFingerprint: request.statement.fingerprint,
    decisionHash: request.decisionHash,
    brainDecisionHash: "b".repeat(64),
    canonicalRecordHash: "r".repeat(64),
    truthState: "CONFIRMED",
    hllVersion: "HLL/1.0",
    authority: {
      authorityId: "harmonia-hll",
      epoch: "hll-1.0-corp-v1",
      conformance: [...REQUIRED_HLL_CONFORMANCE]
    }
  };
}

function transport(overrides: Partial<HllAuthorityTransport> = {}): HllAuthorityTransport {
  return {
    assess: async (request) => responseFor(request),
    commit: async (request) => commitResponseFor(request),
    ...overrides
  };
}

describe("AuthoritativeHllPort", () => {
  it("accepts only a conformance-complete authoritative assessment", async () => {
    const port = new AuthoritativeHllPort(transport());
    const input = statement();

    const assessment = await port.assess(input);

    expect(assessment.decision.truthState).toBe("CONFIRMED");
    expect(assessment.decision.decisionId).toBe("d".repeat(64));
    expect(assessment.decision.allowedBrainActions).toContainEqual({
      action: "RECORD",
      scope: "INTERNAL"
    });
    expect(assessment.receipt.statementFingerprint).toBe(input.fingerprint);
    expect(assessment.receipt.authorityId).toBe("harmonia-hll");
  });

  it("fails closed if the authority omits K1/K2 conformance", async () => {
    const port = new AuthoritativeHllPort(transport({
      assess: async (request) => {
        const response = responseFor(request);
        response.authority.conformance = ["HLL/1.0", "CORPORATION_EXTENSION_V1"];
        return response;
      }
    }));

    await expect(port.assess(statement()))
      .rejects.toThrow("HLL_AUTHORITY_CONFORMANCE_MISSING:K1_PUBLIC_RATIFIED_INGRESS_BLOCKED");
  });

  it("separates assessment from canonical commit and binds the write receipt", async () => {
    const port = new AuthoritativeHllPort(transport());
    const input = statement();
    const assessment = await port.assess(input);

    const committed = await port.commit({
      statement: input,
      assessment,
      action: "RECORD",
      rationale: "record confirmed proposition",
      targetLedger: "CORPORATION_TASKS"
    });

    expect(committed.brainDecisionHash).toBe("b".repeat(64));
    expect(committed.canonicalRecordHash).toBe("r".repeat(64));
    expect(committed.receipt.statementFingerprint).toBe(input.fingerprint);
    expect(committed.receipt.decisionId).toBe(assessment.decision.decisionId);
  });

  it("rejects a commit that is rebound to another Harmonia decision", async () => {
    const port = new AuthoritativeHllPort(transport({
      commit: async (request) => ({
        ...commitResponseFor(request),
        decisionHash: "wrong"
      })
    }));
    const input = statement();
    const assessment = await port.assess(input);

    await expect(port.commit({
      statement: input,
      assessment,
      action: "RECORD",
      rationale: "record"
    })).rejects.toThrow("HLL_AUTHORITY_COMMIT_DECISION_MISMATCH");
  });

  it("rejects a response bound to another statement fingerprint", async () => {
    const port = new AuthoritativeHllPort(transport({
      assess: async (request) => ({
        ...responseFor(request),
        statementFingerprint: "tampered"
      })
    }));

    await expect(port.assess(statement()))
      .rejects.toThrow("HLL_AUTHORITY_STATEMENT_FINGERPRINT_MISMATCH");
  });
});
