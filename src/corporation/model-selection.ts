import { randomUUID } from "node:crypto";
import type { CorporateRisk } from "./domain.js";

export type ModelPropertySourceKind =
  | "OFFICIAL_PROVIDER_DOCS"
  | "OFFICIAL_MODEL_CARD"
  | "OFFICIAL_API_METADATA"
  | "VERIFIED_INTERNAL_BENCHMARK";

export type ModelPropertyEvidence = {
  sourceId: string;
  kind: ModelPropertySourceKind;
  reference: string;
  providerId: string;
  modelId: string;
  modelVersion?: string;
  documentDigest: string;
  observedAt: string;
  validUntil?: string;
  claims: string[];
};

export type ModelProfile = {
  profileId: string;
  providerId: string;
  modelId: string;
  family: string;
  declaredStrengths: string[];
  supportedCapabilities: string[];
  supportedToolsets: string[];
  constraints: string[];
  contextClass: "SHORT" | "MEDIUM" | "LONG" | "VERY_LONG";
  structuredOutput: boolean;
  toolCalling: boolean;
  vision: boolean;
  backgroundWork: boolean;
  risk: CorporateRisk;
  evidence: ModelPropertyEvidence[];
};

export type TaskModelRequirement = {
  taskId: string;
  requiredCapabilities: string[];
  preferredStrengths: string[];
  requiredToolsets: string[];
  requireStructuredOutput: boolean;
  requireToolCalling: boolean;
  requireVision: boolean;
  minimumContextClass: ModelProfile["contextClass"];
};

export type ModelSelection = {
  selectionId: string;
  taskId: string;
  profile: ModelProfile;
  officialEligibilityEvidence: string[];
  benchmarkEvidence: string[];
  rationale: string[];
};

const contextRank: Record<ModelProfile["contextClass"], number> = {
  SHORT: 0,
  MEDIUM: 1,
  LONG: 2,
  VERY_LONG: 3
};

function includesAll(haystack: string[], needles: string[]): boolean {
  const set = new Set(haystack.map((item) => item.toLowerCase()));
  return needles.every((item) => set.has(item.toLowerCase()));
}

function officialEvidence(profile: ModelProfile, now = new Date()): ModelPropertyEvidence[] {
  return profile.evidence.filter((item) =>
    (item.kind === "OFFICIAL_PROVIDER_DOCS"
      || item.kind === "OFFICIAL_MODEL_CARD"
      || item.kind === "OFFICIAL_API_METADATA")
    && item.providerId === profile.providerId
    && item.modelId === profile.modelId
    && item.documentDigest.trim().length > 0
    && (!item.validUntil || Date.parse(item.validUntil) > now.getTime())
  );
}

function officialClaims(profile: ModelProfile): Set<string> {
  return new Set(
    officialEvidence(profile)
      .flatMap((item) => item.claims)
      .map((item) => item.trim().toLowerCase())
  );
}

function hasClaim(claims: Set<string>, prefix: string, value: string): boolean {
  return claims.has(`${prefix}:${value.toLowerCase()}`);
}

export function modelEligible(
  profile: ModelProfile,
  requirement: TaskModelRequirement
): boolean {
  const official = officialEvidence(profile);
  if (!official.length) return false;
  const claims = officialClaims(profile);

  const capabilitiesBound = requirement.requiredCapabilities.every((capability) =>
    hasClaim(claims, "capability", capability)
  );
  const toolsBound = requirement.requiredToolsets.every((tool) =>
    hasClaim(claims, "tool", tool)
  );
  const structuredBound = !requirement.requireStructuredOutput
    || (profile.structuredOutput && claims.has("feature:structured-output"));
  const toolCallingBound = !requirement.requireToolCalling
    || (profile.toolCalling && claims.has("feature:tool-calling"));
  const visionBound = !requirement.requireVision
    || (profile.vision && claims.has("feature:vision"));
  const contextBound = contextRank[profile.contextClass] >= contextRank[requirement.minimumContextClass]
    && claims.has(`context:${profile.contextClass.toLowerCase()}`);

  return capabilitiesBound
    && toolsBound
    && structuredBound
    && toolCallingBound
    && visionBound
    && contextBound;
}

export function selectModel(
  profiles: ModelProfile[],
  requirement: TaskModelRequirement
): ModelSelection {
  const eligible = profiles.filter((profile) => modelEligible(profile, requirement));
  if (!eligible.length) throw new Error("MODEL_SELECTION_NO_OFFICIALLY_ELIGIBLE_MODEL");

  const ranked = [...eligible].sort((a, b) => {
    const claimsA = officialClaims(a);
    const claimsB = officialClaims(b);
    const strengthA = requirement.preferredStrengths.filter((item) =>
      a.declaredStrengths.map((value) => value.toLowerCase()).includes(item.toLowerCase())
      && hasClaim(claimsA, "strength", item)
    ).length;
    const strengthB = requirement.preferredStrengths.filter((item) =>
      b.declaredStrengths.map((value) => value.toLowerCase()).includes(item.toLowerCase())
      && hasClaim(claimsB, "strength", item)
    ).length;
    if (strengthA !== strengthB) return strengthB - strengthA;

    const benchmarksA = a.evidence.filter((item) =>
      item.kind === "VERIFIED_INTERNAL_BENCHMARK"
      && item.providerId === a.providerId
      && item.modelId === a.modelId
      && item.documentDigest.trim().length > 0
    ).length;
    const benchmarksB = b.evidence.filter((item) =>
      item.kind === "VERIFIED_INTERNAL_BENCHMARK"
      && item.providerId === b.providerId
      && item.modelId === b.modelId
      && item.documentDigest.trim().length > 0
    ).length;
    if (benchmarksA !== benchmarksB) return benchmarksB - benchmarksA;

    return a.providerId.localeCompare(b.providerId) || a.modelId.localeCompare(b.modelId);
  });

  const profile = ranked[0]!;
  const official = officialEvidence(profile);
  const benchmarks = profile.evidence.filter((item) => item.kind === "VERIFIED_INTERNAL_BENCHMARK");

  return {
    selectionId: `MODELSEL-${randomUUID().slice(0, 10).toUpperCase()}`,
    taskId: requirement.taskId,
    profile,
    officialEligibilityEvidence: official.map((item) => item.sourceId),
    benchmarkEvidence: benchmarks.map((item) => item.sourceId),
    rationale: [
      "eligibility is based on officially described model/provider capabilities",
      "preferred strengths are matched after eligibility",
      "verified internal benchmarks may rank eligible models but cannot invent unsupported capabilities"
    ]
  };
}
