import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import { fingerprintMandate, type FingerprintedMandate, type MandateStatus } from "./mandate.js";

export type VerdictKind =
  | "ADMIT"
  | "BLOCK"
  | "SUSPEND"
  | "REVOKE"
  | "OVERRIDE"
  | "SELF_REFERENCE";

export type ConstitutionalVerdict = {
  verdictId: string;
  kind: VerdictKind;
  mandateFp: Digest;
  evidenceRefs: string[];
  actor: "harmonia" | "owner";
  selfReference: boolean;
  createdAt: string;
  note: string;
  previousMandateFp?: Digest;
  nextStatus?: MandateStatus;
};

export type SealedVerdict = ConstitutionalVerdict & {
  verdictFp: Digest;
};

export function sealVerdict(verdict: ConstitutionalVerdict): SealedVerdict {
  if (verdict.selfReference && verdict.actor !== "owner") {
    throw new Error("SELF_REFERENCE_REQUIRES_OWNER");
  }
  return {
    ...verdict,
    verdictFp: canonicalDigest({ kind: "harmonia-verdict-v1", ...verdict })
  };
}

export function applyVerdict(
  current: FingerprintedMandate,
  verdict: ConstitutionalVerdict
): FingerprintedMandate {
  if (verdict.mandateFp !== current.fingerprint) throw new Error("VERDICT_STALE_MANDATE");
  if (verdict.selfReference && verdict.actor !== "owner") {
    throw new Error("SELF_REFERENCE_REQUIRES_OWNER");
  }
  if (verdict.nextStatus === undefined) return current;
  const next = { ...current, status: verdict.nextStatus };
  return { ...next, fingerprint: fingerprintMandate(next) };
}
