import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "./ids.js";

export type MandateState = "enabled" | "limited" | "suspended" | "revoked";

export type ConstitutionalMandate = {
  constitutionVersion: string;
  mandateId: string;
  mandateState: MandateState;
  allowedEffects: string[];
  forbiddenEffects: string[];
  riskClass: string;
  gateRequirements: string[];
  issuedAt: string;
  expiresAt?: string;
  governanceFingerprint: Digest;
};

const MANDATE_STATES = new Set<MandateState>(["enabled", "limited", "suspended", "revoked"]);
const ROOT_KEYS = [
  "constitutionVersion",
  "mandateId",
  "mandateState",
  "allowedEffects",
  "forbiddenEffects",
  "riskClass",
  "gateRequirements",
  "issuedAt",
  "expiresAt",
  "governanceFingerprint"
] as const;

const SELF_REFERENCE_SUBJECTS = new Set(["constitution_judge", "integrity_gate"]);

function assertPlainObject(value: unknown, code: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], code: string): void {
  const expected = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) continue;
    if (!expected.has(key)) throw new Error(`${code}:${key}`);
  }
}

function sortedUnique(values: unknown, code: string): string[] {
  if (!Array.isArray(values)) throw new Error(code);
  return [...new Set(values.map((value) => {
    if (typeof value !== "string" || !value.trim()) throw new Error(code);
    return value.trim();
  }))].sort();
}

function requireText(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

type MandateBody = Omit<ConstitutionalMandate, "governanceFingerprint">;

function mandateBody(input: MandateBody): MandateBody {
  return {
    constitutionVersion: input.constitutionVersion,
    mandateId: input.mandateId,
    mandateState: input.mandateState,
    allowedEffects: [...input.allowedEffects],
    forbiddenEffects: [...input.forbiddenEffects],
    riskClass: input.riskClass,
    gateRequirements: [...input.gateRequirements],
    issuedAt: input.issuedAt,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt })
  };
}

export function mandateGovernanceFingerprint(input: MandateBody): Digest {
  return canonicalDigest(mandateBody(input));
}

export function normalizeConstitutionalMandate(
  input: Omit<ConstitutionalMandate, "governanceFingerprint"> & { governanceFingerprint?: Digest }
): ConstitutionalMandate {
  assertPlainObject(input, "MANDATE_SCHEMA");
  assertAllowedKeys(input, ROOT_KEYS, "MANDATE_SCHEMA");
  const mandateState = input.mandateState;
  if (!MANDATE_STATES.has(mandateState)) throw new Error("MANDATE_STATE_INVALID");
  const body: MandateBody = {
    constitutionVersion: requireText(input.constitutionVersion, "MANDATE_VERSION_REQUIRED"),
    mandateId: requireText(input.mandateId, "MANDATE_ID_REQUIRED"),
    mandateState,
    allowedEffects: sortedUnique(input.allowedEffects, "MANDATE_EFFECTS_INVALID"),
    forbiddenEffects: sortedUnique(input.forbiddenEffects, "MANDATE_EFFECTS_INVALID"),
    riskClass: requireText(input.riskClass, "MANDATE_RISK_CLASS_REQUIRED"),
    gateRequirements: sortedUnique(input.gateRequirements, "MANDATE_GATES_INVALID"),
    issuedAt: requireText(input.issuedAt, "MANDATE_ISSUED_AT_REQUIRED"),
    ...(input.expiresAt === undefined ? {} : { expiresAt: requireText(input.expiresAt, "MANDATE_EXPIRES_AT_INVALID") })
  };
  const governanceFingerprint = mandateGovernanceFingerprint(body);
  if (input.governanceFingerprint !== undefined && input.governanceFingerprint !== governanceFingerprint) {
    throw new Error("MANDATE_FINGERPRINT_MISMATCH");
  }
  return { ...body, governanceFingerprint };
}

export function assertMandateAllowsEffect(mandate: ConstitutionalMandate, effect: string): void {
  const normalized = normalizeConstitutionalMandate(mandate);
  if (normalized.mandateState === "suspended" || normalized.mandateState === "revoked") {
    throw new Error("MANDATE_NOT_ENABLED");
  }
  if (normalized.forbiddenEffects.includes(effect)) throw new Error("MANDATE_EFFECT_FORBIDDEN");
  if (normalized.mandateState === "limited" && !normalized.allowedEffects.includes(effect)) {
    throw new Error("MANDATE_EFFECT_FORBIDDEN");
  }
  if (normalized.mandateState === "enabled" && normalized.allowedEffects.length > 0 && !normalized.allowedEffects.includes(effect)) {
    throw new Error("MANDATE_EFFECT_FORBIDDEN");
  }
}

export function assertMandateUnchanged(issued: ConstitutionalMandate, candidate: ConstitutionalMandate): void {
  const { governanceFingerprint: _l, ...issuedBody } = issued;
  const { governanceFingerprint: _r, ...candidateBody } = candidate;
  const left = normalizeConstitutionalMandate(issuedBody);
  const right = normalizeConstitutionalMandate(candidateBody);
  if (left.governanceFingerprint !== right.governanceFingerprint) {
    throw new Error("MANDATE_SELF_MUTATION_FORBIDDEN");
  }
}

export type GovernanceChangeRequest = {
  subject: string;
  evidenceRefs: string[];
  ownerOverride?: { decision: "admit" | "reject"; at: string };
};

export type GovernanceChangeResult = {
  selfReference: boolean;
  verdict: "advisory" | "allow" | "block";
  ownerApprovalRequired: boolean;
  priorVerdict?: "advisory";
};

export function evaluateGovernanceChange(request: GovernanceChangeRequest): GovernanceChangeResult {
  if (!Array.isArray(request.evidenceRefs) || request.evidenceRefs.filter((item) => item.trim()).length === 0) {
    throw new Error("GOVERNANCE_EVIDENCE_REQUIRED");
  }
  const selfReference = SELF_REFERENCE_SUBJECTS.has(request.subject);
  if (!selfReference) {
    return { selfReference: false, verdict: "allow", ownerApprovalRequired: false };
  }
  const base: GovernanceChangeResult = {
    selfReference: true,
    verdict: "advisory",
    ownerApprovalRequired: true
  };
  if (!request.ownerOverride) return base;
  return {
    ...base,
    verdict: request.ownerOverride.decision === "admit" ? "allow" : "block",
    priorVerdict: "advisory"
  };
}
