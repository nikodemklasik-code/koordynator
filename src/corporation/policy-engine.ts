import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { CorporateMessageKind, CommunicationDependencyKind, CorporateMessagePriority } from "./communication.js";

export type DestinationClass = "INTERNAL" | "EXTERNAL_PARTNER" | "EXTERNAL_PUBLIC" | "EXTERNAL_RECIPIENT";

export type CommunicationPolicyInput = {
  kind: CorporateMessageKind;
  priority: CorporateMessagePriority;
  dependencyKind: CommunicationDependencyKind;
  effects: string[];
  dataClasses: string[];
  destinationClass: DestinationClass;
  monetaryValue?: number;
};

export type PolicyClassification = {
  material: boolean;
  highRisk: boolean;
  externalEffect: boolean;
  reasons: string[];
  fingerprint: string;
};

const materialKinds = new Set<CorporateMessageKind>([
  "DECISION",
  "HANDOFF",
  "APPROVAL_REQUEST",
  "QUALITY_GATE",
  "LEGAL_REVIEW",
  "SECURITY_REVIEW",
  "FINANCE_REVIEW",
  "VENDOR_REVIEW",
  "RISK_ALERT",
  "INCIDENT",
  "ESCALATION",
  "OUTREACH_PLAN",
  "FALSIFICATION_RESULT",
  "EXPERIMENT_RESULT",
  "PRODUCT_IDEA"
]);

const highRiskKinds = new Set<CorporateMessageKind>([
  "SECURITY_REVIEW",
  "RISK_ALERT",
  "INCIDENT",
  "ESCALATION",
  "VENDOR_REVIEW",
  "OUTREACH_PLAN"
]);

export function classifyCommunication(input: CommunicationPolicyInput): PolicyClassification {
  const normalized = {
    ...input,
    effects: [...new Set(input.effects.map((item) => item.trim().toLowerCase()).filter(Boolean))].sort(),
    dataClasses: [...new Set(input.dataClasses.map((item) => item.trim().toLowerCase()).filter(Boolean))].sort(),
    monetaryValue: input.monetaryValue ?? 0
  };

  const reasons: string[] = [];
  const externalEffect = input.destinationClass !== "INTERNAL"
    || normalized.effects.some((effect) => /^external\.|send|publish|post|email|message|payment|contract/.test(effect));

  const material = ["BLOCKING", "CONTROL"].includes(input.dependencyKind)
    || materialKinds.has(input.kind)
    || externalEffect
    || normalized.monetaryValue > 0;

  const highRisk = input.priority === "P0"
    || highRiskKinds.has(input.kind)
    || normalized.effects.some((effect) => /secret|credential|payment|deploy|production|delete|destructive|external\.send/.test(effect))
    || normalized.dataClasses.some((value) => /special-category|health|financial|credential|secret|personal-data/.test(value))
    || normalized.monetaryValue >= 1000;

  if (["BLOCKING", "CONTROL"].includes(input.dependencyKind)) reasons.push("CONTROL_OR_BLOCKING_DEPENDENCY");
  if (materialKinds.has(input.kind)) reasons.push("MATERIAL_MESSAGE_KIND");
  if (externalEffect) reasons.push("EXTERNAL_EFFECT_DERIVED");
  if (normalized.monetaryValue > 0) reasons.push("MONETARY_EFFECT");
  if (highRiskKinds.has(input.kind)) reasons.push("HIGH_RISK_MESSAGE_KIND");
  if (input.priority === "P0") reasons.push("P0_PRIORITY");
  if (highRisk && !reasons.includes("HIGH_RISK_MESSAGE_KIND") && input.priority !== "P0") reasons.push("HIGH_RISK_EFFECT_OR_DATA");

  const base = {
    material,
    highRisk,
    externalEffect,
    reasons,
    normalized
  };

  return {
    material,
    highRisk,
    externalEffect,
    reasons,
    fingerprint: canonicalDigest(base)
  };
}
