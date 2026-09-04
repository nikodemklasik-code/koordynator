import type { EvidenceContext, EvidenceReceipt } from "../domain/evidence.js";
import type { TaskRef } from "../domain/ids.js";
import { reusableEvidence } from "./evidence-engine.js";
import { planGates, type ChangeImpact, type GateName } from "./impact-engine.js";

export type FailureKind =
  | "CODE" | "CONFIG" | "SECURITY" | "CONTRACT" | "ENV" | "INFRA"
  | "DEPENDENCY" | "FLAKY" | "PERFORMANCE";

export type TargetedReturnPlan = {
  failedGate: GateName;
  failure: FailureKind;
  returnTo: "BUILD" | "SECURITY_FIX" | "CONTRACT_FIX" | "ENV_RETRY" | "DEPENDENCY_FIX" | "QUARANTINE" | "PERFORMANCE_FIX";
  nextRevision: number;
  requiredRetests: GateName[];
  preservedEvidence: EvidenceReceipt[];
};

export function targetedReturn(
  ref: TaskRef,
  failedGate: GateName,
  failure: FailureKind,
  impact: ChangeImpact,
  receipts: EvidenceReceipt[],
  evidenceContext: EvidenceContext,
  now: Date
): TargetedReturnPlan {
  const returnTo = failure === "FLAKY" ? "QUARANTINE"
    : failure === "ENV" || failure === "INFRA" ? "ENV_RETRY"
    : failure === "SECURITY" ? "SECURITY_FIX"
    : failure === "CONTRACT" ? "CONTRACT_FIX"
    : failure === "DEPENDENCY" ? "DEPENDENCY_FIX"
    : failure === "PERFORMANCE" ? "PERFORMANCE_FIX"
    : "BUILD";

  return {
    failedGate,
    failure,
    returnTo,
    nextRevision: ref.revision + 1,
    requiredRetests: planGates(impact),
    preservedEvidence: receipts.filter((receipt) =>
      !impact.affectedGates.includes(receipt.gate) && reusableEvidence(receipt, evidenceContext, now)
    )
  };
}
