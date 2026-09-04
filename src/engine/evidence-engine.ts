import type { EvidenceContext, EvidenceReceipt } from "../domain/evidence.js";

export function reusableEvidence(receipt: EvidenceReceipt, context: EvidenceContext, now: Date): boolean {
  if (receipt.status !== "PASS" || receipt.revoked || new Date(receipt.validUntil) <= now) return false;
  return receipt.componentFp === context.componentFp
    && receipt.dependencyFp === context.dependencyFp
    && receipt.configFp === context.configFp
    && receipt.toolchainFp === context.toolchainFp
    && receipt.policyFp === context.policyFp
    && receipt.testDefinitionFp === context.testDefinitionFp
    && receipt.fixtureFp === context.fixtureFp
    && receipt.validatorVersionFp === context.validatorVersionFp
    && receipt.scannerDbFp === context.scannerDbFp
    && receipt.environmentFp === context.environmentFp;
}
