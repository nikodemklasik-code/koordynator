import { randomUUID } from "node:crypto";
import type { CorporateRisk } from "./domain.js";
import type { VerificationReceipt } from "./receipts.js";
import { verifyVerificationReceipt } from "./receipts.js";
import { VerifierTrustRegistry } from "./verification-trust.js";

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
  externalDependency: boolean;
  metered: boolean;
  receipt: VerificationReceipt;
  detail?: string;
};

export type QualityGatePolicy = {
  gateId: string;
  name: string;
  gateRisk: CorporateRisk;
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
  gateRisk: "HIGH",
  minimumPassingPaths: 2,
  minimumIndependentGroups: 2,
  requireNonMeteredPassingPath: true,
  requireNonExternalPassingPath: true,
  requireDeterministicPassingPath: true,
  blockOnAnyCriticalFailure: true
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function deterministic(kind: VerificationPathKind): boolean {
  return ["DETERMINISTIC_TEST", "STATIC_ANALYSIS", "RULE_ENGINE", "REPLAY"].includes(kind);
}

function criticalFailure(path: VerificationPath): boolean {
  const receipt = path.receipt;
  return receipt.result === "FAIL"
    && receipt.severity === "CRITICAL"
    && receipt.failureClass !== undefined
    && ["CORRECTNESS", "SECURITY", "INTEGRITY", "PRIVACY", "COMPLIANCE"].includes(receipt.failureClass);
}

export function evaluateQualityGate(
  paths: VerificationPath[],
  trustRegistry: VerifierTrustRegistry,
  policy: QualityGatePolicy = DEFAULT_QC_POLICY
): QualityGateDecision {
  const reasons: string[] = [];
  const trusted: VerificationPath[] = [];

  for (const path of paths) {
    try {
      verifyVerificationReceipt(path.receipt);
      trustRegistry.assertReceiptLineage({
        trustRootId: path.receipt.trustRootId,
        verifierId: path.receipt.verifierId,
        independentGroupId: path.receipt.independentGroupId,
        providerLineageId: path.receipt.providerLineageId
      });
      trusted.push(path);
    } catch {
      reasons.push(`UNTRUSTED_VERIFICATION_PATH:${path.pathId}`);
    }
  }

  const passing = trusted.filter((path) => path.receipt.result === "PASS");
  const failing = trusted.filter((path) => path.receipt.result === "FAIL");
  const critical = trusted.filter(criticalFailure);

  if (critical.length && policy.blockOnAnyCriticalFailure) {
    reasons.push("CRITICAL_VERIFICATION_FAILURE_PRESENT");
  }

  if (passing.length < policy.minimumPassingPaths) reasons.push("INSUFFICIENT_PASSING_PATHS");

  const independentGroups = unique(passing.map((path) => path.receipt.independentGroupId));
  if (independentGroups.length < policy.minimumIndependentGroups) {
    reasons.push("INSUFFICIENT_VERIFICATION_INDEPENDENCE");
  }

  const independentLineages = unique(passing.map((path) => path.receipt.providerLineageId));
  if (independentLineages.length < Math.min(policy.minimumIndependentGroups, 2)) {
    reasons.push("INSUFFICIENT_PROVIDER_LINEAGE_DIVERSITY");
  }

  if (policy.requireNonMeteredPassingPath && !passing.some((path) => !path.metered)) {
    reasons.push("NO_NON_METERED_CLOSURE_PATH");
  }

  if (policy.requireNonExternalPassingPath && !passing.some((path) => !path.externalDependency)) {
    reasons.push("NO_SOVEREIGN_CLOSURE_PATH");
  }

  const deterministicRequired = policy.requireDeterministicPassingPath
    || policy.gateRisk === "HIGH"
    || policy.gateRisk === "CRITICAL";

  if (deterministicRequired && !passing.some((path) => deterministic(path.kind))) {
    reasons.push("NO_DETERMINISTIC_CLOSURE_PATH");
  }

  const status: QualityGateDecision["status"] = critical.length && policy.blockOnAnyCriticalFailure
    ? "FAIL"
    : reasons.length
      ? "INCONCLUSIVE"
      : "PASS";

  return {
    decisionId: `QC-${randomUUID().slice(0, 10).toUpperCase()}`,
    gateId: policy.gateId,
    status,
    passingPathIds: passing.map((path) => path.pathId),
    failingPathIds: failing.map((path) => path.pathId),
    reasons,
    evidenceRefs: unique(trusted.flatMap((path) => path.receipt.evidenceRefs)),
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
    path.receipt.result === "PASS"
    && path.metered
    && ["PAID_PROVIDER", "SUBSCRIPTION_PROVIDER"].includes(path.kind)
  );
  if (!passingPaid) return false;

  return !paths.some((path) =>
    path.receipt.result === "PASS"
    && (!path.metered || !path.externalDependency)
  );
}
