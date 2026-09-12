import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";

export type MandateStatus = "enabled" | "limited" | "suspended" | "revoked";
export type Role = "research" | "code" | "browser" | "audit" | "deploy";
export type DataClass = "public" | "internal" | "confidential";

export type ConstitutionalMandate = {
  mandateId: string;
  status: MandateStatus;
  allowedRoles: Role[];
  maxDataClass: DataClass;
  autoDeploy: boolean;
  multiWorker: boolean;
  issuedAt: string;
  expiresAt: string;
};

export type FingerprintedMandate = ConstitutionalMandate & {
  fingerprint: Digest;
};

const DATA_CLASS_RANK: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  confidential: 2
};

export function fingerprintMandate(mandate: ConstitutionalMandate): Digest {
  return canonicalDigest({
    kind: "constitutional-mandate-v1",
    mandateId: mandate.mandateId,
    status: mandate.status,
    allowedRoles: [...mandate.allowedRoles].sort(),
    maxDataClass: mandate.maxDataClass,
    autoDeploy: mandate.autoDeploy,
    multiWorker: mandate.multiWorker,
    issuedAt: mandate.issuedAt,
    expiresAt: mandate.expiresAt
  });
}

export function sealMandate(mandate: ConstitutionalMandate): FingerprintedMandate {
  return { ...mandate, fingerprint: fingerprintMandate(mandate) };
}

export function assertMandateFresh(mandate: FingerprintedMandate, now = new Date()): void {
  if (mandate.fingerprint !== fingerprintMandate(mandate)) {
    throw new Error("MANDATE_FINGERPRINT_MISMATCH");
  }
  if (Date.parse(mandate.expiresAt) <= now.getTime()) {
    throw new Error("MANDATE_EXPIRED");
  }
  if (mandate.status === "revoked") throw new Error("MANDATE_REVOKED");
  if (mandate.status === "suspended") throw new Error("MANDATE_SUSPENDED");
}

export function roleAllowed(mandate: FingerprintedMandate, role: Role): boolean {
  return mandate.allowedRoles.includes(role);
}

export function dataClassAllowed(mandate: FingerprintedMandate, dataClass: DataClass): boolean {
  return DATA_CLASS_RANK[dataClass] <= DATA_CLASS_RANK[mandate.maxDataClass];
}
