import type { CorporateRisk } from "./domain.js";

export type ProviderCostClass =
  | "LOCAL"
  | "FREE"
  | "INCLUDED_CREDITS"
  | "SUBSCRIPTION"
  | "PAID_API";

export type ProviderCapability = {
  providerId: string;
  modelId: string;
  family: string;
  providerLineageId: string;
  trustRootId: string;
  capabilities: string[];
  toolsets: string[];
  skills: string[];
  supportsToolCalling: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  supportsLongContext: boolean;
  supportsBackgroundWork: boolean;
  costClass: ProviderCostClass;
  healthy: boolean;
  rateLimited: boolean;
  externalDependency: boolean;
  risk: CorporateRisk;
};

export type ProviderStrategyKind =
  | "SINGLE"
  | "FALLBACK_CHAIN"
  | "ENSEMBLE"
  | "ROLE_SPLIT"
  | "CROSS_CHECK";

export type ProviderStrategy = {
  strategyId: string;
  kind: ProviderStrategyKind;
  members: ProviderCapability[];
  requiredCapabilities: string[];
  requiredToolsets: string[];
  requiredSkills: string[];
  rationale: string[];
  hasNonPaidPath: boolean;
  hasNonExternalPath: boolean;
  providerFamilies: string[];
  providerLineages: string[];
};

export type ProviderFabricPolicy = {
  preferNonPaid: boolean;
  preferLocalOrFree: boolean;
  requireFallbackForMeteredPrimary: boolean;
  requireFamilyDiversityForCrossCheck: boolean;
  maxMembers: number;
};

export const DEFAULT_PROVIDER_FABRIC_POLICY: ProviderFabricPolicy = {
  preferNonPaid: true,
  preferLocalOrFree: true,
  requireFallbackForMeteredPrimary: true,
  requireFamilyDiversityForCrossCheck: true,
  maxMembers: 4
};

function includesAll(haystack: string[], needles: string[]): boolean {
  const lower = new Set(haystack.map((item) => item.toLowerCase()));
  return needles.every((item) => lower.has(item.toLowerCase()));
}

function costRank(cost: ProviderCostClass): number {
  return {
    LOCAL: 0,
    FREE: 1,
    INCLUDED_CREDITS: 2,
    SUBSCRIPTION: 3,
    PAID_API: 4
  }[cost];
}

function compatible(
  provider: ProviderCapability,
  requiredCapabilities: string[],
  requiredToolsets: string[],
  requiredSkills: string[]
): boolean {
  return provider.healthy
    && !provider.rateLimited
    && includesAll(provider.capabilities, requiredCapabilities)
    && includesAll(provider.toolsets, requiredToolsets)
    && includesAll(provider.skills, requiredSkills);
}

export class ProviderFabric {
  constructor(
    private readonly providers: ProviderCapability[],
    private readonly policy: ProviderFabricPolicy = DEFAULT_PROVIDER_FABRIC_POLICY
  ) {}

  eligible(input: {
    requiredCapabilities: string[];
    requiredToolsets?: string[];
    requiredSkills?: string[];
  }): ProviderCapability[] {
    const toolsets = input.requiredToolsets ?? [];
    const skills = input.requiredSkills ?? [];

    return this.providers
      .filter((provider) => compatible(
        provider,
        input.requiredCapabilities,
        toolsets,
        skills
      ))
      .sort((a, b) => {
        if (this.policy.preferLocalOrFree) {
          const byCost = costRank(a.costClass) - costRank(b.costClass);
          if (byCost !== 0) return byCost;
        }
        if (a.externalDependency !== b.externalDependency) {
          return Number(a.externalDependency) - Number(b.externalDependency);
        }
        return a.providerId.localeCompare(b.providerId) || a.modelId.localeCompare(b.modelId);
      });
  }

  buildStrategies(input: {
    requiredCapabilities: string[];
    requiredToolsets?: string[];
    requiredSkills?: string[];
    verification?: boolean;
  }): ProviderStrategy[] {
    const eligible = this.eligible(input);
    if (!eligible.length) return [];

    const strategies: ProviderStrategy[] = [];
    const make = (
      kind: ProviderStrategyKind,
      members: ProviderCapability[],
      rationale: string[]
    ): ProviderStrategy => ({
      strategyId: `${kind}-${members.map((item) => `${item.providerId}:${item.modelId}`).join("+")}`,
      kind,
      members,
      requiredCapabilities: [...input.requiredCapabilities],
      requiredToolsets: [...(input.requiredToolsets ?? [])],
      requiredSkills: [...(input.requiredSkills ?? [])],
      rationale,
      hasNonPaidPath: members.some((member) => ["LOCAL", "FREE", "INCLUDED_CREDITS"].includes(member.costClass)),
      hasNonExternalPath: members.some((member) => !member.externalDependency),
      providerFamilies: [...new Set(members.map((member) => member.family))],
      providerLineages: [...new Set(members.map((member) => member.providerLineageId))]
    });

    const primary = eligible[0]!;
    const metered = ["SUBSCRIPTION", "PAID_API"].includes(primary.costClass);

    if (!metered || !this.policy.requireFallbackForMeteredPrimary) {
      strategies.push(make("SINGLE", [primary], ["best-ranked compatible provider"]));
    }

    const fallbackMembers = eligible.slice(0, Math.max(2, this.policy.maxMembers));
    if (fallbackMembers.length >= 2) {
      if (!metered || fallbackMembers.some((member) => ["LOCAL", "FREE", "INCLUDED_CREDITS"].includes(member.costClass))) {
        strategies.push(make(
          "FALLBACK_CHAIN",
          fallbackMembers,
          ["preserves execution when the primary provider is unavailable or expensive"]
        ));
      }
    }

    const diverse = eligible.filter((provider, index, all) =>
      provider.trustRootId.trim().length > 0
      && provider.providerLineageId.trim().length > 0
      && all.findIndex((other) => other.providerLineageId === provider.providerLineageId) === index
    ).slice(0, this.policy.maxMembers);

    if (diverse.length >= 2) {
      strategies.push(make(
        input.verification ? "CROSS_CHECK" : "ENSEMBLE",
        diverse,
        input.verification
          ? ["independent provider-family cross-check"]
          : ["combine independent model families where diversity improves quality"]
      ));
    }

    const toolSpecialists = eligible
      .filter((provider) => provider.supportsToolCalling || provider.skills.length > 0)
      .slice(0, this.policy.maxMembers);
    if (toolSpecialists.length >= 2) {
      strategies.push(make(
        "ROLE_SPLIT",
        toolSpecialists,
        ["assign different subtasks to the providers best equipped for their toolsets and skills"]
      ));
    }

    return strategies.filter((strategy) => {
      if (
        strategy.kind === "CROSS_CHECK"
        && this.policy.requireFamilyDiversityForCrossCheck
        && strategy.providerLineages.length < 2
      ) return false;

      if (
        this.policy.requireFallbackForMeteredPrimary
        && strategy.members.some((member) => member.costClass === "PAID_API")
        && !strategy.hasNonPaidPath
      ) return false;

      return true;
    });
  }
}
