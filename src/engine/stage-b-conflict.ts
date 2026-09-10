import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import type { BinaryCheck, IssueIdentity } from "./autonomous-recovery.js";
import { issueFingerprint } from "./autonomous-recovery.js";

export type StageBRecoveryAction = "dalej" | "do agenta" | "zmień warunki wykonania" | "Rewident";

export type StageBRecoveryInput = {
  approach: 1 | 2;
  opposing: BinaryCheck;
  qc2: BinaryCheck;
  issue?: IssueIdentity;
  previousIssueFp?: Digest;
  repeatedNonConflictCount?: number;
  maxRepeatedNonConflictBeforeConditionChange?: number;
};

export type StageBRecoveryDecision = {
  action: StageBRecoveryAction;
  reason: string;
  issueFp?: Digest;
};

export function decideStageBRecovery(input: StageBRecoveryInput): StageBRecoveryDecision {
  if (input.opposing === 1 && input.qc2 === 1) {
    return { action: "dalej", reason: "Obaj strażnicy stopnia B potwierdzili zgodność z szablonem etapu." };
  }

  if (!input.issue) throw new Error("STAGE_B_ISSUE_IDENTITY_REQUIRED");
  const currentIssueFp = issueFingerprint(input.issue);
  const sameIssue = input.previousIssueFp !== undefined && input.previousIssueFp === currentIssueFp;
  const conflict = input.opposing !== input.qc2;

  if (input.approach === 2 && sameIssue && conflict) {
    return {
      action: "Rewident",
      reason: "Rewident wchodzi dopiero przy drugim podejściu, gdy powtórzył się ten sam błąd i strażnicy stopnia B są w konflikcie.",
      issueFp: currentIssueFp
    };
  }

  const repeatedNonConflictCount = input.repeatedNonConflictCount ?? 0;
  const maxRepeated = input.maxRepeatedNonConflictBeforeConditionChange ?? 2;
  if (!conflict && sameIssue && repeatedNonConflictCount >= maxRepeated) {
    return {
      action: "zmień warunki wykonania",
      reason: "Ten sam niekonfliktowy błąd etapu wraca mimo kolejnych korekt agenta; Mózg zmienia warunki wykonania zgodnie z drabiną N rund.",
      issueFp: currentIssueFp
    };
  }

  return {
    action: "do agenta",
    reason: input.approach === 1
      ? "Pierwsza niezgodność stopnia B wraca do agenta z dokładnym powodem i proponowaną korektą."
      : "Błąd jest nowy albo nie spełnia warunku powtórzonego konfliktu; naprawa pozostaje po stronie agenta.",
    issueFp: currentIssueFp
  };
}

export type StageBConflictTrace = {
  approach: 1 | 2;
  opposing: BinaryCheck;
  qc2: BinaryCheck;
  issueFp?: Digest;
  action: StageBRecoveryAction;
};

export function stageBTraceFingerprint(trace: readonly StageBConflictTrace[]): Digest {
  return canonicalDigest({ kind: "stage-b-conflict-trace-v1", trace });
}
