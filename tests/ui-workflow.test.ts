import { describe, expect, it } from "vitest";
import {
  assertUiTransition,
  evaluateUiAcceptance,
  nextUiRepair,
  type UiAcceptanceInput
} from "../src/domain/ui-workflow.js";

const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const fp = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function reports(overrides: Partial<UiAcceptanceInput> = {}): UiAcceptanceInput {
  return {
    design: {
      taskId: "TASK-40",
      revision: 1,
      contractFp: fp,
      routes: ["/chat"],
      components: ["composer"],
      userFlows: ["send"],
      interactionStates: ["idle"],
      breakpoints: ["1280"],
      accessibilityRequirements: ["labels"],
      visualReferences: [],
      acceptanceCriteria: ["composer visible"]
    },
    build: {
      taskId: "TASK-40",
      revision: 1,
      contractFp: fp,
      baseSha: sha,
      subjectSha: sha,
      treeSha: sha,
      changedFiles: ["web/control/chat.html"],
      commands: ["npm test"],
      tests: [{ command: "vitest", exitCode: 0, status: "PASS" }],
      writeLeaseId: "LEASE-1"
    },
    review: {
      taskId: "TASK-40",
      revision: 1,
      contractFp: fp,
      subjectSha: sha,
      reviewer: "CODEX",
      verdict: "PASS",
      findings: []
    },
    browser: {
      taskId: "TASK-40",
      revision: 1,
      contractFp: fp,
      subjectSha: sha,
      previewBuildFp: fp,
      verdict: "PASS",
      testedRoutes: ["/chat"],
      testedViewports: ["1280x800"],
      interactions: ["type"],
      screenshots: ["chat.png"],
      consoleErrors: [],
      networkErrors: [],
      accessibilityResults: []
    },
    validation: {
      taskId: "TASK-40",
      revision: 1,
      contractFp: fp,
      subjectSha: sha,
      verdict: "PASS",
      responsive: true,
      accessible: true,
      visualConsistency: true,
      interactionConsistency: true,
      findings: []
    },
    securityScan: "PASS",
    accessibilityGate: "PASS",
    activeWriteLease: false,
    repairAttempts: 0,
    ...overrides
  };
}

describe("UI workflow graph", () => {
  it("forbids UI_BUILD before an accepted DesignSpec", () => {
    expect(() => assertUiTransition("UI_REQUIREMENTS", "UI_BUILD"))
      .toThrow(/UI_TRANSITION_INVALID/);
    expect(() => assertUiTransition("UI_DESIGN", "UI_BUILD", { designAccepted: false }))
      .toThrow(/UI_DESIGN_REQUIRED/);
    expect(() => assertUiTransition("UI_DESIGN", "UI_BUILD", { designAccepted: true }))
      .not.toThrow();
  });

  it("allows CODE_REVIEW and BROWSER_TEST in parallel only after UI_BUILD completed", () => {
    expect(() => assertUiTransition("UI_DESIGN", "CODE_REVIEW")).toThrow(/UI_TRANSITION_INVALID/);
    expect(() => assertUiTransition("UI_BUILD", "CODE_REVIEW", { buildCompleted: true })).not.toThrow();
    expect(() => assertUiTransition("UI_BUILD", "BROWSER_TEST", { buildCompleted: true })).not.toThrow();
  });

  it("does not let a worker set UI_ACCEPTED", () => {
    expect(() => assertUiTransition("UI_VALIDATION", "UI_ACCEPTED"))
      .toThrow(/UI_ACCEPT_COORDINATOR_ONLY/);
  });
});

describe("UI acceptance gate", () => {
  it("accepts only when every mandatory report is PASS on the exact subjectSha and contractFp", () => {
    expect(evaluateUiAcceptance(reports())).toEqual({ status: "UI_ACCEPTED" });
  });

  it("blocks when a mandatory report is missing or is SEE_AGENT_REPORT / NOT_TESTED", () => {
    expect(evaluateUiAcceptance(reports({ review: null })).status).toBe("BLOCKED");
    expect(evaluateUiAcceptance(reports({ securityScan: "SEE_AGENT_REPORT" })).status).toBe("BLOCKED");
    expect(evaluateUiAcceptance(reports({ securityScan: "NOT_TESTED" })).status).toBe("BLOCKED");
    expect(evaluateUiAcceptance(reports({ securityScan: "PROCESS_COMPLETED" })).status).toBe("BLOCKED");
  });

  it("rejects a report for a different SHA or fingerprint as STALE", () => {
    const stale = reports({
      review: { ...reports().review!, subjectSha: "cccccccccccccccccccccccccccccccccccccccc" }
    });
    expect(evaluateUiAcceptance(stale)).toMatchObject({ status: "STALE" });
  });

  it("fails a blocking finding and freezes a CorrectionPack on a new revision", () => {
    const failed = reports({
      review: {
        ...reports().review!,
        verdict: "FAIL",
        findings: [{
          findingId: "F1",
          severity: "BLOCKER",
          category: "CODE",
          evidence: ["chat.js:10"],
          expected: "composer visible",
          actual: "composer clipped",
          proposedCorrection: "fix grid rows"
        }]
      }
    });
    const result = evaluateUiAcceptance(failed);
    expect(result.status).toBe("FAIL");
    const repair = nextUiRepair(failed, result);
    expect(repair.revision).toBe(2);
    expect(repair.stage).toBe("UI_REPAIR");
    expect(repair.correctionPack.frozen).toBe(true);
    expect(repair.objective).toBe(failed.design?.acceptanceCriteria[0]);
  });

  it("makes a third automatic repair impossible", () => {
    const failed = reports({
      repairAttempts: 2,
      review: { ...reports().review!, verdict: "FAIL", findings: [{
        findingId: "F2",
        severity: "HIGH",
        category: "FUNCTIONAL",
        evidence: ["x"],
        expected: "ok",
        actual: "broken",
        proposedCorrection: "fix"
      }] }
    });
    const result = evaluateUiAcceptance(failed);
    expect(result.status).toBe("FAIL");
    expect(() => nextUiRepair(failed, result)).toThrow(/BLOCKED_OWNER_DECISION/);
  });

  it("blocks acceptance while a write lease is still held", () => {
    expect(evaluateUiAcceptance(reports({ activeWriteLease: true })).status).toBe("BLOCKED");
  });
});
