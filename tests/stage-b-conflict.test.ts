import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { Digest } from "../src/domain/ids.js";
import type { IssueIdentity } from "../src/engine/autonomous-recovery.js";
import { decideStageBRecovery } from "../src/engine/stage-b-conflict.js";
import {
  B1StageAssembler,
  Qc2StageComparator,
  StageOpposingComparator,
  type AcceptedStageElement,
  type B1AssemblyReceipt,
  type StageTemplate
} from "../src/engine/stage-assembly.js";

const d = (value: unknown): Digest => canonicalDigest(value);
const NOW = "2026-09-10T10:00:00.000Z";

function issue(kind = "assembly-path", actual = "wrong"): IssueIdentity {
  return {
    element: "STAGE-B",
    location: "B1",
    kind,
    expected: "exact-template-path",
    actual,
    detectedBy: "Zespół przeciwny"
  };
}

function template(): StageTemplate {
  return {
    stageId: "STAGE-B",
    elements: [
      { elementId: "B1", expectedArtifactFp: d("a1"), expectedContractFp: d("c1"), requiredCoverage: ["one"] },
      { elementId: "B2", expectedArtifactFp: d("a2"), expectedContractFp: d("c2"), requiredCoverage: ["two"] }
    ]
  };
}

function elements(): AcceptedStageElement[] {
  return [
    { elementId: "B1", artifactFp: d("a1"), contractFp: d("c1"), coverage: ["one"], validUntil: "2026-09-11T10:00:00.000Z", qc1: 1, opposing: 1 },
    { elementId: "B2", artifactFp: d("a2"), contractFp: d("c2"), coverage: ["two"], validUntil: "2026-09-11T10:00:00.000Z", qc1: 1, opposing: 1 }
  ];
}

describe("Stage B conflict boundary", () => {
  it("never sends the first conflict to Rewident", () => {
    const current = issue();
    const decision = decideStageBRecovery({ approach: 1, opposing: 0, qc2: 1, issue: current });
    expect(decision.action).toBe("do agenta");
  });

  it("sends only the second same conflict to Rewident", () => {
    const current = issue();
    const fp = canonicalDigest({ element: current.element, location: current.location, kind: current.kind, expected: current.expected, actual: current.actual });
    const decision = decideStageBRecovery({ approach: 2, opposing: 0, qc2: 1, issue: current, previousIssueFp: fp });
    expect(decision.action).toBe("Rewident");
  });

  it("keeps a new second-attempt issue with Agent instead of Rewident", () => {
    const first = issue("assembly-path", "wrong");
    const firstFp = canonicalDigest({ element: first.element, location: first.location, kind: first.kind, expected: first.expected, actual: first.actual });
    const second = issue("assembly-input", "different");
    const decision = decideStageBRecovery({ approach: 2, opposing: 0, qc2: 1, issue: second, previousIssueFp: firstFp });
    expect(decision.action).toBe("do agenta");
  });

  it("does not use Rewident for repeated 0/0 and changes conditions only after the configured N rounds", () => {
    const current = issue();
    const fp = canonicalDigest({ element: current.element, location: current.location, kind: current.kind, expected: current.expected, actual: current.actual });
    expect(decideStageBRecovery({ approach: 2, opposing: 0, qc2: 0, issue: current, previousIssueFp: fp, repeatedNonConflictCount: 1, maxRepeatedNonConflictBeforeConditionChange: 2 }).action).toBe("do agenta");
    expect(decideStageBRecovery({ approach: 2, opposing: 0, qc2: 0, issue: current, previousIssueFp: fp, repeatedNonConflictCount: 2, maxRepeatedNonConflictBeforeConditionChange: 2 }).action).toBe("zmień warunki wykonania");
  });

  it("B1 receipt lets the opposing team confirm the exact assembly path", () => {
    const assembled = new B1StageAssembler().assemble(template(), elements(), NOW);
    expect(assembled.status).toBe("GOTOWE");
    if (assembled.status !== "GOTOWE") return;

    const opposing = new StageOpposingComparator().compare(template(), assembled.stage, assembled.receipt);
    const qc2 = new Qc2StageComparator().compare(template(), assembled.stage, NOW);
    expect(opposing.value).toBe(1);
    expect(qc2.value).toBe(1);
  });

  it("a tampered B1 process receipt creates a real 0/1 stage conflict while QC2 still sees a correct block", () => {
    const assembled = new B1StageAssembler().assemble(template(), elements(), NOW);
    expect(assembled.status).toBe("GOTOWE");
    if (assembled.status !== "GOTOWE") return;

    const tampered: B1AssemblyReceipt = { ...assembled.receipt, outputAssemblyFp: d("other-stage") };
    const opposing = new StageOpposingComparator().compare(template(), assembled.stage, tampered);
    const qc2 = new Qc2StageComparator().compare(template(), assembled.stage, NOW);
    expect(opposing.value).toBe(0);
    expect(qc2.value).toBe(1);
    if (opposing.value === 0) {
      expect(opposing.issue.detectedBy).toBe("Zespół przeciwny");
      expect(opposing.proposedSolution.length).toBeGreaterThan(0);
    }
  });
});
