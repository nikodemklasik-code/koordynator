import { randomUUID } from "node:crypto";

export type VerificationPathKind =
  | "DETERMINISTIC_TEST"
  | "STATIC_ANALYSIS"
  | "RULE_ENGINE"
  | "LOCAL_MODEL"
  | "FREE_PROVIDER"
  | "SUBSCRIPTION_PROVIDER"
  | "PAID_PROVIDER"
  | "HUMAN_REVIEW"
  | "CROSS_PROVIDER"
  | "REPLAY"
  | "CANARY";

export type VerificationPath = {
  pathId: string;
  kind: VerificationPathKind;
  executorId: string;
  providerFamily?: string;
  independentGroup: string;
  externalDependency: boolean;
  metered: boolean;
  result: "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_RUN";
  evidenceRefs: string[];
  detail?: string;
};

export type QualityGatePolicy = {
  gateId: string;
  name: string;
  minimumPassingPaths: number;
  minimumIndependentGroups: number;
  requireNonMeteredPassingPath: boolean;
  requireNonExternalPassingPath: boolean;
  requireDeterministicPassingPath: boolean;
  blockOnAnyCriticalFailure: boolean;
};

export type QualityGateDecision = {
  decisionId: string;
  gateId: string;
  status: "PASS" | "FAIL" | "INCONCLUSIVE";
  passingPathIds: string[];
  failingPathIds: string[];
  reasons: string[];
  evidenceRefs: string[];
  decidedAt: string;
};

export const DEFAULT_QC_POLICY: QualityGatePolicy = {
  gateId: "QC-MATERIAL-STAGE",
  name: "Material Stage Quality Gate",
  minimumPassingPaths: 2,
  minimumIndependentGroups: 2,
  requireNonMeteredPassingPath: true,
  requireNonExternalPassingPath: true,
  requireDeterministicPassingPath: false,
  blockOnAnyCriticalFailure: false
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function evaluateQualityGate(
  paths: VerificationPath[],
  policy: QualityGatePolicy = DEFAULT_QC_POLICY
): QualityGateDecision {
  const passing = paths.filter((path) => path.result === "PASS");
  const failing = paths.filter((path) => path.result === "FAIL");
  const reasons: string[] = [];

  if (passing.length < policy.minimumPassingPaths) reasons.push("INSUFFICIENT_PASSING_PATHS");

  const independentGroups = unique(passing.map((path) => path.independentGroup));
  if (independentGroups.length < policy.minimumIndependentGroups) {
    reasons.push("INSUFFICIENT_VERIFICATION_INDEPENDENCE");
  }

  if (policy.requireNonMeteredPassingPath && !passing.some((path) => !path.metered)) {
    reasons.push("NO_NON_METERED_CLOSURE_PATH");
  }

  if (policy.requireNonExternalPassingPath && !passing.some((path) => !path.externalDependency)) {
    reasons.push("NO_SOVEREIGN_CLOSURE_PATH");
  }

  if (
    policy.requireDeterministicPassingPath
    && !passing.some((path) =>
      ["DETERMINISTIC_TEST", "STATIC_ANALYSIS", "RULE_ENGINE", "REPLAY"].includes(path.kind)
    )
  ) {
    reasons.push("NO_DETERMINISTIC_CLOSURE_PATH");
  }

  if (policy.blockOnAnyCriticalFailure && failing.length) {
    reasons.push("VERIFICATION_FAILURE_PRESENT");
  }

  const status: QualityGateDecision["status"] = reasons.length
    ? failing.length && policy.blockOnAnyCriticalFailure
      ? "FAIL"
      : "INCONCLUSIVE"
    : "PASS";

  return {
    decisionId: `QC-${randomUUID().slice(0, 10).toUpperCase()}`,
    gateId: policy.gateId,
    status,
    passingPathIds: passing.map((path) => path.pathId),
    failingPathIds: failing.map((path) => path.pathId),
    reasons,
    evidenceRefs: unique(paths.flatMap((path) => path.evidenceRefs)),
    decidedAt: new Date().toISOString()
  };
}

export function assertQualityGatePassed(decision: QualityGateDecision): void {
  if (decision.status !== "PASS") {
    throw new Error(`QUALITY_GATE_${decision.status}:${decision.reasons.join(",")}`);
  }
}

export function paidVerificationNeedsFallback(paths: VerificationPath[]): boolean {
  const passingPaid = paths.some((path) =>
    path.result === "PASS"
    && path.metered
    && ["PAID_PROVIDER", "SUBSCRIPTION_PROVIDER"].includes(path.kind)
  );
  if (!passingPaid) return false;

  return !paths.some((path) =>
    path.result === "PASS"
    && (!path.metered || !path.externalDependency)
  );
}
