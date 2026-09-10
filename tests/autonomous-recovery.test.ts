import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import {
  decideRecovery,
  issueFingerprint,
  validateMaterializationOrder,
  type IssueIdentity,
  type MaterializationOrder
} from "../src/engine/autonomous-recovery.js";

const issue: IssueIdentity = {
  element: "Rejestr wykonawców",
  location: "src/api/provider-registry.ts",
  kind: "niewłaściwa droga wykonania",
  expected: "OmniRoute",
  actual: "Harmonia",
  detectedBy: "QC1"
};

function order(): MaterializationOrder {
  return {
    taskId: "TASK-AUTONOMY",
    instructions: "Zainstaluj dokładnie dostarczony element bez zmiany architektury.",
    allowedPaths: ["src/**"],
    suppliedMaterialFp: canonicalDigest("material"),
    expectedResult: "Element zgodny z instrukcją i testami.",
    initiative: "brak"
  };
}

describe("autonomous recovery", () => {
  it("passes only when both guardians return one", () => {
    expect(decideRecovery({ approach: 1, opposing: 1, qc1: 1 })).toEqual({
      action: "dalej",
      reason: "Obaj strażnicy potwierdzili zgodność."
    });
  });

  it("returns every first failure to the agent without Rewident", () => {
    const decision = decideRecovery({ approach: 1, opposing: 0, qc1: 1, issue });
    expect(decision.action).toBe("do agenta");
    expect(decision.issueFp).toBe(issueFingerprint(issue));
  });

  it("invokes Rewident only on second approach, guardian conflict and the same issue", () => {
    const fp = issueFingerprint(issue);
    expect(decideRecovery({ approach: 2, opposing: 0, qc1: 1, issue, previousIssueFp: fp }).action).toBe("Rewident");
    expect(decideRecovery({ approach: 2, opposing: 1, qc1: 0, issue, previousIssueFp: fp }).action).toBe("Rewident");
  });

  it("does not invoke Rewident for a new issue in the second approach", () => {
    const different = { ...issue, actual: "inny błąd" };
    const decision = decideRecovery({
      approach: 2,
      opposing: 0,
      qc1: 1,
      issue: different,
      previousIssueFp: issueFingerprint(issue)
    });
    expect(decision.action).toBe("do agenta");
  });

  it("changes execution conditions when both guardians see the same repeated failure", () => {
    const fp = issueFingerprint(issue);
    const decision = decideRecovery({ approach: 2, opposing: 0, qc1: 0, issue, previousIssueFp: fp });
    expect(decision.action).toBe("zmień warunki wykonania");
  });

  it("forbids agent initiative and requires exact materialization boundaries", () => {
    expect(() => validateMaterializationOrder(order())).not.toThrow();
    const invalid = { ...order(), initiative: "dowolna" as "brak" };
    expect(() => validateMaterializationOrder(invalid)).toThrow("AGENT_INITIATIVE_FORBIDDEN");
  });
});
