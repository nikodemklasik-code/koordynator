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
  observedAt: string;
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

function officialEvidence(profile: ModelProfile): ModelPropertyEvidence[] {
  return profile.evidence.filter((item) =>
    item.kind === "OFFICIAL_PROVIDER_DOCS"
    || item.kind === "OFFICIAL_MODEL_CARD"
    || item.kind === "OFFICIAL_API_METADATA"
  );
}

export function modelEligible(
  profile: ModelProfile,
  requirement: TaskModelRequirement
): boolean {
  const official = officialEvidence(profile);
  if (!official.length) return false;

  return includesAll(profile.supportedCapabilities, requirement.requiredCapabilities)
    && includesAll(profile.supportedToolsets, requirement.requiredToolsets)
    && (!requirement.requireStructuredOutput || profile.structuredOutput)
    && (!requirement.requireToolCalling || profile.toolCalling)
    && (!requirement.requireVision || profile.vision)
    && contextRank[profile.contextClass] >= contextRank[requirement.minimumContextClass];
}

export function selectModel(
  profiles: ModelProfile[],
  requirement: TaskModelRequirement
): ModelSelection {
  const eligible = profiles.filter((profile) => modelEligible(profile, requirement));
  if (!eligible.length) throw new Error("MODEL_SELECTION_NO_OFFICIALLY_ELIGIBLE_MODEL");

  const ranked = [...eligible].sort((a, b) => {
    const strengthA = requirement.preferredStrengths.filter((item) =>
      a.declaredStrengths.map((value) => value.toLowerCase()).includes(item.toLowerCase())
    ).length;
    const strengthB = requirement.preferredStrengths.filter((item) =>
      b.declaredStrengths.map((value) => value.toLowerCase()).includes(item.toLowerCase())
    ).length;
    if (strengthA !== strengthB) return strengthB - strengthA;

    const benchmarksA = a.evidence.filter((item) => item.kind === "VERIFIED_INTERNAL_BENCHMARK").length;
    const benchmarksB = b.evidence.filter((item) => item.kind === "VERIFIED_INTERNAL_BENCHMARK").length;
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
