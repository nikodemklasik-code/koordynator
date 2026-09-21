import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { SolutionCandidate } from "./domain.js";
import {
  admissibilityReasons,
  costDominates,
  reviewCostProportionality,
  type RouteEconomics,
  type SolutionAdmissibility
} from "./cost-proportionality.js";
import type { VerificationReceipt } from "./receipts.js";
import { verifyVerificationReceipt } from "./receipts.js";
import { VerifierTrustRegistry } from "./verification-trust.js";

export type VerifiedSolutionCandidate = Omit<SolutionCandidate, "verified"> & {
  artifactFingerprint: string;
  verificationReceipt: VerificationReceipt;
  admissibility: SolutionAdmissibility;
  economics: RouteEconomics;
};

export type CandidatePolicy = {
  minimumCorrectness: number;
  minimumSecurity: number;
  requireVerified: boolean;
};

export type CandidateComparison = {
  admissible: VerifiedSolutionCandidate[];
  costRevision: Array<{ candidate: VerifiedSolutionCandidate; reasons: string[] }>;
  rejected: Array<{ candidate: VerifiedSolutionCandidate; reasons: string[] }>;
  paretoFront: VerifiedSolutionCandidate[];
  selected?: VerifiedSolutionCandidate;
  selectionState:
    | "NO_ADMISSIBLE_CANDIDATE"
    | "COST_REVISION_REQUIRED"
    | "UNIQUE_PARETO"
    | "BRAIN_DECISION_REQUIRED";
};

const DEFAULT_POLICY: CandidatePolicy = {
  minimumCorrectness: 0.8,
  minimumSecurity: 0.8,
  requireVerified: true
};

export function compareCandidates(
  candidates: VerifiedSolutionCandidate[],
  trustRegistry: VerifierTrustRegistry,
  policy: CandidatePolicy = DEFAULT_POLICY
): CandidateComparison {
  const semanticallyAdmissible: VerifiedSolutionCandidate[] = [];
  const costRevision: CandidateComparison["costRevision"] = [];
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

    reasons.push(...admissibilityReasons(candidate.admissibility));

    if (reasons.length) {
      rejected.push({ candidate, reasons });
      continue;
    }

    const costReview = reviewCostProportionality(candidate.economics);
    if (!costReview.proportional) {
      costRevision.push({ candidate, reasons: costReview.reasons });
      continue;
    }

    semanticallyAdmissible.push(candidate);
  }

  const paretoFront = semanticallyAdmissible.filter((candidate) =>
    !semanticallyAdmissible.some((other) =>
      other.candidateId !== candidate.candidateId
      && costDominates(other.economics.cost, candidate.economics.cost)
    )
  );

  const selected = paretoFront.length === 1 ? paretoFront[0] : undefined;
  const selectionState: CandidateComparison["selectionState"] =
    semanticallyAdmissible.length === 0
      ? costRevision.length
        ? "COST_REVISION_REQUIRED"
        : "NO_ADMISSIBLE_CANDIDATE"
      : paretoFront.length === 1
        ? "UNIQUE_PARETO"
        : "BRAIN_DECISION_REQUIRED";

  return {
    admissible: semanticallyAdmissible,
    costRevision,
    rejected,
    paretoFront,
    ...(selected === undefined ? {} : { selected }),
    selectionState
  };
}
