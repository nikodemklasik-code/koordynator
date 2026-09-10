import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest, TaskId } from "../domain/ids.js";

export type BinaryCheck = 0 | 1;

export type IssueIdentity = {
  element: string;
  location: string;
  kind: string;
  expected: string;
  actual: string;
  detectedBy: "Zespół przeciwny" | "QC1" | "QC2";
};

export type MaterializationOrder = {
  taskId: TaskId;
  instructions: string;
  allowedPaths: string[];
  suppliedMaterialFp: Digest;
  expectedResult: string;
  correction?: string;
  initiative: "brak";
};

export type RecoveryDecision = {
  action: "dalej" | "do agenta" | "zmień warunki wykonania" | "Rewident";
  reason: string;
  issueFp?: Digest;
};

export type RecoveryInput = {
  approach: 1 | 2;
  opposing: BinaryCheck;
  qc1: BinaryCheck;
  issue?: IssueIdentity;
  previousIssueFp?: Digest;
};

export function issueFingerprint(issue: IssueIdentity): Digest {
  return canonicalDigest({
    element: issue.element,
    location: issue.location,
    kind: issue.kind,
    expected: issue.expected,
    actual: issue.actual,
    detectedBy: issue.detectedBy
  });
}

export function validateMaterializationOrder(order: MaterializationOrder): void {
  if (order.initiative !== "brak") throw new Error("AGENT_INITIATIVE_FORBIDDEN");
  if (!order.instructions.trim()) throw new Error("AGENT_INSTRUCTIONS_REQUIRED");
  if (order.allowedPaths.length === 0) throw new Error("AGENT_ALLOWED_PATHS_REQUIRED");
  if (!order.expectedResult.trim()) throw new Error("AGENT_EXPECTED_RESULT_REQUIRED");
}

export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  if (input.opposing === 1 && input.qc1 === 1) {
    return { action: "dalej", reason: "Obaj strażnicy potwierdzili zgodność." };
  }

  if (!input.issue) throw new Error("ISSUE_IDENTITY_REQUIRED");
  const currentIssueFp = issueFingerprint(input.issue);

  if (input.approach === 1) {
    return {
      action: "do agenta",
      reason: "Pierwsza niezgodność wraca do agenta z konkretną korektą.",
      issueFp: currentIssueFp
    };
  }

  const sameIssue = input.previousIssueFp !== undefined && input.previousIssueFp === currentIssueFp;
  const guardiansConflict = input.opposing !== input.qc1;

  if (guardiansConflict && sameIssue) {
    return {
      action: "Rewident",
      reason: "W drugim podejściu strażnicy są w konflikcie i powtórzył się ten sam błąd.",
      issueFp: currentIssueFp
    };
  }

  if (input.opposing === 0 && input.qc1 === 0 && sameIssue) {
    return {
      action: "zmień warunki wykonania",
      reason: "Ten sam błąd wykonania powtórzył się mimo korekty; Mózg zmienia skład, AI lub sposób materializacji.",
      issueFp: currentIssueFp
    };
  }

  return {
    action: "do agenta",
    reason: "Błąd jest nowy albo nie spełnia warunku konfliktu drugiego podejścia; agent dostaje dokładną korektę.",
    issueFp: currentIssueFp
  };
}
