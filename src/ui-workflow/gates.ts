import type { Digest } from "../domain/ids.js";

export type GateStatus = "PASS" | "FAIL" | "UNEXECUTED" | "STALE" | "EXPIRED" | "BLOCKED";

export type UiEvidence = {
  contractFp: Digest;
  subjectSha: Digest;
  designValid: boolean;
  buildValid: boolean;
  codeReview: GateStatus;
  browserTest: GateStatus;
  uiValidation: GateStatus;
  accessibility: GateStatus;
  securityScan: GateStatus;
  activeWriteLease: boolean;
  reportedContractFp: Digest;
  reportedSubjectSha: Digest;
};

export type UiGate = {
  status: "UI_ACCEPTED" | "BLOCKED" | "FAIL";
  reasons: string[];
};

function requirePass(name: string, status: GateStatus, reasons: string[]): void {
  if (status === "PASS") return;
  reasons.push(`${name}:${status}`);
}

export function evaluateUiGate(evidence: UiEvidence): UiGate {
  const reasons: string[] = [];

  if (!evidence.designValid) reasons.push("DESIGN_CONTRACT_INVALID");
  if (!evidence.buildValid) reasons.push("BUILD_RECEIPT_INVALID");
  if (evidence.contractFp !== evidence.reportedContractFp) reasons.push("CONTRACT_FP_STALE");
  if (evidence.subjectSha !== evidence.reportedSubjectSha) reasons.push("SUBJECT_SHA_STALE");
  if (evidence.activeWriteLease) reasons.push("WRITE_LEASE_ACTIVE");

  requirePass("CODE_REVIEW", evidence.codeReview, reasons);
  requirePass("BROWSER_TEST", evidence.browserTest, reasons);
  requirePass("UI_VALIDATION", evidence.uiValidation, reasons);
  requirePass("ACCESSIBILITY", evidence.accessibility, reasons);
  requirePass("SECURITY_SCAN", evidence.securityScan, reasons);

  if (reasons.some((reason) => reason.endsWith(":FAIL"))) {
    return { status: "FAIL", reasons };
  }
  if (reasons.length > 0) return { status: "BLOCKED", reasons };
  return { status: "UI_ACCEPTED", reasons: [] };
}
