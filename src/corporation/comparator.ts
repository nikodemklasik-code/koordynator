import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { SolutionCandidate, SolutionMetrics } from "./domain.js";
import type { VerificationReceipt } from "./receipts.js";
import { verifyVerificationReceipt } from "./receipts.js";
import { VerifierTrustRegistry } from "./verification-trust.js";

export type VerifiedSolutionCandidate = Omit<SolutionCandidate, "verified"> & {
  artifactFingerprint: string;
  verificationReceipt: VerificationReceipt;
};

export type CandidatePolicy = {
  minimumCorrectness: number;
  minimumSecurity: number;
  requireVerified: boolean;
};

export type CandidateComparison = {
  eligible: VerifiedSolutionCandidate[];
  rejected: Array<{ candidate: VerifiedSolutionCandidate; reasons: string[] }>;
  paretoFront: VerifiedSolutionCandidate[];
  selected?: VerifiedSolutionCandidate;
};

const DEFAULT_POLICY: CandidatePolicy = {
  minimumCorrectness: 0.8,
  minimumSecurity: 0.8,
  requireVerified: true
};

function bounded(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function benefit(metrics: SolutionMetrics): number {
  return (
    bounded(metrics.correctness) * 0.25
    + bounded(metrics.security) * 0.20
    + bounded(metrics.maintainability) * 0.12
    + bounded(metrics.reversibility) * 0.10
    + bounded(metrics.architectureFit) * 0.13
    + bounded(metrics.productValue) * 0.10
    - bounded(metrics.regressionRisk) * 0.05
    - bounded(metrics.complexity) * 0.02
    - bounded(metrics.moneyCost) * 0.01
    - bounded(metrics.tokenCost) * 0.01
    - bounded(metrics.latency) * 0.01
  );
}

function dominates(left: VerifiedSolutionCandidate, right: VerifiedSolutionCandidate): boolean {
  const l = left.metrics;
  const r = right.metrics;
  const benefits: Array<keyof SolutionMetrics> = [
    "correctness",
    "security",
    "maintainability",
    "reversibility",
    "architectureFit",
    "productValue"
  ];
  const costs: Array<keyof SolutionMetrics> = [
    "regressionRisk",
    "complexity",
    "moneyCost",
    "tokenCost",
    "latency"
  ];

  const noWorse = benefits.every((key) => l[key] >= r[key])
    && costs.every((key) => l[key] <= r[key]);
  const strictlyBetter = benefits.some((key) => l[key] > r[key])
    || costs.some((key) => l[key] < r[key]);

  return noWorse && strictlyBetter;
}

export function compareCandidates(
  candidates: VerifiedSolutionCandidate[],
  trustRegistry: VerifierTrustRegistry,
  policy: CandidatePolicy = DEFAULT_POLICY
): CandidateComparison {
  const eligible: VerifiedSolutionCandidate[] = [];
  const rejected: CandidateComparison["rejected"] = [];

  for (const candidate of candidates) {
    const reasons: string[] = [];
    const receipt = candidate.verificationReceipt;

    try {
      verifyVerificationReceipt(receipt);
      trustRegistry.assertReceiptLineage({
        trustRootId: receipt.trustRootId,
        verifierId: receipt.verifierId,
        independentGroupId: receipt.independentGroupId,
        providerLineageId: receipt.providerLineageId
      });
    } catch {
      reasons.push("VERIFICATION_RECEIPT_UNTRUSTED");
    }

    if (receipt.artifactFingerprint !== candidate.artifactFingerprint) {
      reasons.push("VERIFICATION_ARTIFACT_MISMATCH");
    }
    if (receipt.metricsFingerprint !== canonicalDigest(candidate.metrics)) {
      reasons.push("VERIFICATION_METRICS_MISMATCH");
    }
    if (policy.requireVerified && receipt.result !== "PASS") reasons.push("NOT_VERIFIED");
    if (candidate.metrics.correctness < policy.minimumCorrectness) reasons.push("CORRECTNESS_BELOW_MINIMUM");
    if (candidate.metrics.security < policy.minimumSecurity) reasons.push("SECURITY_BELOW_MINIMUM");
    if (
      receipt.result === "FAIL"
      && receipt.severity === "CRITICAL"
      && receipt.failureClass !== undefined
      && ["CORRECTNESS", "SECURITY", "INTEGRITY", "PRIVACY", "COMPLIANCE"].includes(receipt.failureClass)
    ) {
      reasons.push("CRITICAL_VERIFICATION_FAILURE");
    }

    if (reasons.length) rejected.push({ candidate, reasons });
    else eligible.push(candidate);
  }

  const paretoFront = eligible.filter((candidate) =>
    !eligible.some((other) => other.candidateId !== candidate.candidateId && dominates(other, candidate))
  );

  const selected = [...paretoFront].sort((a, b) => {
    const byScore = benefit(b.metrics) - benefit(a.metrics);
    if (byScore !== 0) return byScore;
    return a.candidateId.localeCompare(b.candidateId);
  })[0];

  return {
    eligible,
    rejected,
    paretoFront,
    ...(selected === undefined ? {} : { selected })
  };
}
