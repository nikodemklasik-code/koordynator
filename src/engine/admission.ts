import { assertEnvelopeIntact, type SealedTaskEnvelope } from "../domain/task-envelope.js";
import type { Digest } from "../domain/ids.js";
import {
  assertMandateFresh,
  dataClassAllowed,
  roleAllowed,
  type FingerprintedMandate
} from "../harmonia/mandate.js";

export type AdmissionDecision =
  | { status: "ADMITTED"; mandateFp: Digest; contractFp: Digest }
  | { status: "BLOCKED"; reason: string };

export function admitExecution(
  mandate: FingerprintedMandate,
  envelope: SealedTaskEnvelope,
  vaultReachable: boolean
): AdmissionDecision {
  try {
    assertMandateFresh(mandate);
    assertEnvelopeIntact(envelope);
  } catch (error) {
    return { status: "BLOCKED", reason: error instanceof Error ? error.message : "ADMISSION_INVALID" };
  }

  if (!vaultReachable) return { status: "BLOCKED", reason: "VAULT_UNAVAILABLE" };
  if (!roleAllowed(mandate, envelope.role)) return { status: "BLOCKED", reason: "ROLE_OUTSIDE_MANDATE" };
  if (!dataClassAllowed(mandate, envelope.dataClass)) {
    return { status: "BLOCKED", reason: "DATA_CLASS_OUTSIDE_MANDATE" };
  }
  if (envelope.role === "deploy" && mandate.autoDeploy !== true) {
    return { status: "BLOCKED", reason: "AUTO_DEPLOY_BLOCKED" };
  }

  return {
    status: "ADMITTED",
    mandateFp: mandate.fingerprint,
    contractFp: envelope.contractFp
  };
}
