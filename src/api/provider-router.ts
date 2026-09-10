import type { BillingPolicy, CapabilityRequest } from "./capability-api.js";
import type { ProviderAdapter, ProviderAccessMode } from "./provider-contract.js";
import { ProviderRegistry } from "./provider-registry.js";

export type ProviderProfile =
  | { mode: "MONO"; providerId: string }
  | { mode: "MULTI"; strategy: "PRIMARY" | "POLICY" | "FAILOVER" | "LOWEST_LATENCY" | "LOWEST_COST" | "QUALITY" | "ROLE_PINNED" | "DIVERSE_REVIEW"; providerOrder?: string[] };

export const DEFAULT_AI_PROVIDER_PROFILE: ProviderProfile = {
  mode: "MULTI",
  strategy: "PRIMARY",
  providerOrder: ["omniroute", "openai-codex-sub", "claude-code-sub", "gemini-cli-sub", "github-copilot-sub"]
};

function billingRank(accessMode: ProviderAccessMode, policy: BillingPolicy | undefined): number {
  if (policy === "SUBSCRIPTION_FIRST") return accessMode === "SUBSCRIPTION" ? 0 : accessMode === "API" ? 1 : 2;
  if (policy === "API_FIRST") return accessMode === "API" ? 0 : accessMode === "SUBSCRIPTION" ? 1 : 2;
  if (policy === "LOCAL_ONLY") return accessMode === "LOCAL" ? 0 : 9;
  return 0;
}

function byOrder(a: ProviderAdapter, b: ProviderAdapter, order: string[]): number {
  const rank = new Map(order.map((id, index) => [id, index]));
  const ra = rank.get(a.descriptor.providerId) ?? Number.MAX_SAFE_INTEGER;
  const rb = rank.get(b.descriptor.providerId) ?? Number.MAX_SAFE_INTEGER;
  if (ra !== rb) return ra - rb;
  if (a.descriptor.priority !== b.descriptor.priority) return a.descriptor.priority - b.descriptor.priority;
  return a.descriptor.providerId.localeCompare(b.descriptor.providerId);
}

function metric(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}

export class ProviderRouter {
  constructor(private readonly registry: ProviderRegistry, readonly profile: ProviderProfile = DEFAULT_AI_PROVIDER_PROFILE) {}

  private compare(a: ProviderAdapter, b: ProviderAdapter, request: CapabilityRequest): number {
    if (this.profile.mode === "MONO") return 0;
    const order = this.profile.providerOrder ?? [];
    const policy = request.requirements.billingPolicy;

    if (this.profile.strategy === "LOWEST_LATENCY") {
      const delta = metric(a.descriptor.typicalLatencyMs, Number.MAX_SAFE_INTEGER) - metric(b.descriptor.typicalLatencyMs, Number.MAX_SAFE_INTEGER);
      return delta !== 0 ? delta : byOrder(a, b, order);
    }

    if (this.profile.strategy === "LOWEST_COST") {
      const delta = metric(a.descriptor.estimatedCostScore, Number.MAX_SAFE_INTEGER) - metric(b.descriptor.estimatedCostScore, Number.MAX_SAFE_INTEGER);
      if (delta !== 0) return delta;
      const billing = billingRank(a.descriptor.accessMode, policy) - billingRank(b.descriptor.accessMode, policy);
      return billing !== 0 ? billing : byOrder(a, b, order);
    }

    if (this.profile.strategy === "QUALITY") {
      const delta = metric(b.descriptor.qualityScore, 0) - metric(a.descriptor.qualityScore, 0);
      return delta !== 0 ? delta : byOrder(a, b, order);
    }

    if (this.profile.strategy === "ROLE_PINNED") {
      const aRole = a.descriptor.roleAffinity?.[request.role] ?? 0;
      const bRole = b.descriptor.roleAffinity?.[request.role] ?? 0;
      if (aRole !== bRole) return bRole - aRole;
      const quality = metric(b.descriptor.qualityScore, 0) - metric(a.descriptor.qualityScore, 0);
      return quality !== 0 ? quality : byOrder(a, b, order);
    }

    if (this.profile.strategy === "DIVERSE_REVIEW" && request.requirements.diversityAgainstProviderId !== undefined) {
      const against = this.registry.has(request.requirements.diversityAgainstProviderId)
        ? this.registry.get(request.requirements.diversityAgainstProviderId)
        : undefined;
      const family = against?.descriptor.modelFamily;
      const aPenalty = a.descriptor.providerId === request.requirements.diversityAgainstProviderId || (family !== undefined && a.descriptor.modelFamily === family) ? 1 : 0;
      const bPenalty = b.descriptor.providerId === request.requirements.diversityAgainstProviderId || (family !== undefined && b.descriptor.modelFamily === family) ? 1 : 0;
      if (aPenalty !== bPenalty) return aPenalty - bPenalty;
    }

    const billing = billingRank(a.descriptor.accessMode, policy) - billingRank(b.descriptor.accessMode, policy);
    if (billing !== 0) return billing;
    return byOrder(a, b, order);
  }

  async candidates(request: CapabilityRequest): Promise<ProviderAdapter[]> {
    if (this.profile.mode === "MONO") {
      const provider = this.registry.get(this.profile.providerId);
      await this.assertAllowed(provider, request);
      return [provider];
    }

    const providers = this.registry.all().sort((a, b) => this.compare(a, b, request));
    const allowed: ProviderAdapter[] = [];
    for (const provider of providers) {
      try {
        await this.assertAllowed(provider, request);
        allowed.push(provider);
      } catch {
        // Niedostępny wykonawca jest izolowany. Brak jednego klucza lub limit nie blokuje pozostałych tras.
      }
    }
    if (allowed.length === 0) throw new Error("NO_ALLOWED_PROVIDER");
    return allowed;
  }

  async select(request: CapabilityRequest): Promise<ProviderAdapter> {
    return (await this.candidates(request))[0]!;
  }

  private assertBillingAllowed(provider: ProviderAdapter, request: CapabilityRequest): void {
    const mode = provider.descriptor.accessMode;
    const policy = request.requirements.billingPolicy;
    if (policy === "SUBSCRIPTION_ONLY" && mode !== "SUBSCRIPTION") throw new Error("BILLING_POLICY_DENIED");
    if (policy === "API_ONLY" && mode !== "API") throw new Error("BILLING_POLICY_DENIED");
    if (policy === "LOCAL_ONLY" && mode !== "LOCAL") throw new Error("BILLING_POLICY_DENIED");
    if (policy === "SUBSCRIPTION_FIRST" && mode === "API") {
      const budget = request.requirements.maxCost ?? 0;
      if (request.requirements.allowPaidApiFallback !== true || budget <= 0) throw new Error("PAID_API_FALLBACK_NOT_AUTHORIZED");
    }
  }

  private async assertAllowed(provider: ProviderAdapter, request: CapabilityRequest): Promise<void> {
    const d = provider.descriptor;
    if (!d.enabled) throw new Error("PROVIDER_DISABLED");
    if (!d.capabilities.includes(request.capability)) throw new Error("CAPABILITY_UNSUPPORTED");
    if (!d.allowedSecurityClasses.includes(request.securityClass)) throw new Error("SECURITY_CLASS_DENIED");
    if (d.external && !request.requirements.externalProviderAllowed) throw new Error("EXTERNAL_PROVIDER_DENIED");
    if (request.requirements.providerDiversityRequired === true
      && request.requirements.diversityAgainstProviderId !== undefined) {
      if (d.providerId === request.requirements.diversityAgainstProviderId) throw new Error("PROVIDER_DIVERSITY_REQUIRED");
      if (this.registry.has(request.requirements.diversityAgainstProviderId)) {
        const against = this.registry.get(request.requirements.diversityAgainstProviderId);
        if (against.descriptor.modelFamily !== undefined && d.modelFamily === against.descriptor.modelFamily) {
          throw new Error("PROVIDER_FAMILY_DIVERSITY_REQUIRED");
        }
      }
    }
    this.assertBillingAllowed(provider, request);
    const health = await provider.health();
    if (["UNAVAILABLE", "AUTH_REQUIRED", "RATE_LIMITED", "BLOCKED", "QUARANTINED"].includes(health)) {
      throw new Error(`PROVIDER_${health}`);
    }
    if (!(await provider.canExecute(request))) throw new Error("PROVIDER_POLICY_DENIED");
  }
}
